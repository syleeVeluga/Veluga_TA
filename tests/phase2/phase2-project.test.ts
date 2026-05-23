import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mergePolicies, type MergePolicyInput } from '../../packages/policy-service/src/merge.js';
import { PolicyContextStore } from '../../packages/shared-types/src/index.js';
import { AuditLogger } from '../../packages/veluga-main/src/audit-logger.js';
import { verifyProjectCitations } from '../../packages/veluga-main/src/citation-verifier.js';
import { renderVelugaDocx } from '../../packages/veluga-main/src/docx-adapter.js';
import { IntentRouter } from '../../packages/veluga-main/src/agents/intent-router.js';
import { initializeProject } from '../../packages/veluga-main/src/project-initializer.js';
import { openProject } from '../../packages/veluga-main/src/project-reentry.js';
import { extractStyleCard } from '../../packages/veluga-main/src/style-card.js';
import { updateLastSessionSummary } from '../../packages/veluga-main/src/session-summary.js';
import { ProjectReentryBanner } from '../../packages/veluga-renderer/src/ProjectReentryBanner.js';

function baseInput(project: MergePolicyInput['project'] = null): MergePolicyInput {
  return {
    identity: {
      user_id: 'analyst@veluga.io',
      dept: 'strategy',
      roles: ['analyst'],
      clearance: 'internal'
    },
    institution: {
      external_apis: 'allow',
      audit_log: 'required',
      default_veluga_mode: true,
      policy_guard_mode: 'dry-run',
      hitl_mode: 'normal'
    },
    org: {
      org_id: 'strategy',
      default_skills: ['system-self-help', 'docx'],
      kb_scopes: ['policy:internal']
    },
    project,
    user: {
      extra_skills: ['style-card', 'citation-verifier']
    },
    session: {}
  };
}

function policy(project: MergePolicyInput['project'] = { project_id: 'demo', active_skills: ['docx', 'style-card', 'citation-verifier'] }) {
  return new PolicyContextStore(mergePolicies(baseInput(project))).get();
}

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'veluga-phase2-'));
}

function seedProjectFiles(root: string): void {
  writeFileSync(
    path.join(root, 'market.md'),
    '# Market Outlook\nRevenue increased 18 percent in Q1. Customer retention remained above 92 percent.',
    'utf8'
  );
  writeFileSync(
    path.join(root, 'plan.txt'),
    '1. Execution Plan. The team will prioritize enterprise onboarding and weekly risk review.',
    'utf8'
  );
  writeFileSync(
    path.join(root, 'risks.md'),
    '## Risk Register\nSupply delays are the main operational risk. Mitigation owners are assigned.',
    'utf8'
  );
}

describe('Phase2 project layer', () => {
  it('initializes project.yaml, merges project overrides, and shows reentry only for projects', async () => {
    const root = await tempProject();
    const basePolicy = policy(null);
    const created = initializeProject(root, basePolicy, {
      projectId: 'phase2-demo',
      now: new Date('2026-05-23T09:00:00.000Z')
    });
    expect(created.owner).toBe('analyst@veluga.io');
    expect(created.overrides?.active_skills).toEqual(
      expect.arrayContaining(['docx', 'style-card', 'citation-verifier'])
    );

    const yaml = readFileSync(path.join(root, 'project.yaml'), 'utf8');
    expect(yaml).toContain('project_id: "phase2-demo"');
    expect(openProject(root, baseInput(null)).policy.project?.project_id).toBe('phase2-demo');

    const noProject = await tempProject();
    const openedNoProject = openProject(noProject, baseInput(null));
    expect(openedNoProject.project).toBeNull();
    expect(openedNoProject.reentry_banner).toBeNull();

    writeFileSync(
      path.join(root, 'project.yaml'),
      yaml.replace('last_session_summary: null', 'last_session_summary: "2026-05-23T10:00:00.000Z Draft ready"'),
      'utf8'
    );
    const opened = openProject(root, baseInput(null));
    expect(opened.reentry_banner?.summary).toContain('Draft ready');
    const markup = renderToStaticMarkup(ProjectReentryBanner({ project: opened.project, onResume: () => undefined }));
    expect(markup).toContain('Draft ready');
    expect(markup).toContain('Continue');
  });

  it('extracts and caches a style card after three source files', async () => {
    const root = await tempProject();
    initializeProject(root, policy(null), { projectId: 'style-demo' });
    seedProjectFiles(root);
    const activePolicy = policy({ project_id: 'style-demo', active_skills: ['docx', 'style-card', 'citation-verifier'] });

    const card = await extractStyleCard({ projectRoot: root, policy: activePolicy });
    expect(card.patterns.tone).not.toBe('');
    expect(card.source_files).toHaveLength(3);
    expect(existsSync(path.join(root, '.veluga', 'style-cards', `${card.card_id}.json`))).toBe(true);
    expect(readFileSync(path.join(root, 'project.yaml'), 'utf8')).toContain(`style_card_id: "${card.card_id}"`);

    const cached = await extractStyleCard({ projectRoot: root, policy: activePolicy });
    expect(cached.card_id).toBe(card.card_id);
  });

  it('verifies notebook citations and marks unsupported tags', async () => {
    const root = await tempProject();
    initializeProject(root, policy(null), { projectId: 'citation-demo' });
    writeFileSync(
      path.join(root, 'source.txt'),
      'Revenue increased 18 percent in Q1. Customer retention remained above 92 percent.',
      'utf8'
    );
    const activePolicy = policy({ project_id: 'citation-demo', active_skills: ['citation-verifier'] });
    const result = verifyProjectCitations({
      projectRoot: root,
      policy: activePolicy,
      text:
        'Revenue increased 18 percent in Q1 [src:nb_source.txt#0|nb]. Margin doubled overnight [src:nb_source.txt#99|nb].'
    });
    expect(result.total_citations).toBe(2);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toHaveLength(1);
    expect(result.modified_text).toContain('[unverified]');
  });

  it('renders docx with citations, strips parametric tags, and records watermark state', async () => {
    const root = await tempProject();
    const out = path.join(root, 'out.docx');
    const result = renderVelugaDocx({
      outputPath: out,
      text: 'Draft body [parametric:low]\n\nSupported claim [src:nb_source.txt#0|nb].'
    });
    expect(result.citation_count).toBe(1);
    expect(result.stripped_parametric_tags).toBe(1);
    expect(result.watermark).toBe(true);
    const bytes = readFileSync(out);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(bytes.toString('utf8')).toContain('footnotes.xml');
    expect(bytes.toString('utf8')).not.toContain('[parametric:low]');
  });

  it('extends intent routing and writes session summary audit events', async () => {
    const root = await tempProject();
    initializeProject(root, policy(null), { projectId: 'intent-demo' });
    const activePolicy = policy({ project_id: 'intent-demo', active_skills: ['docx', 'style-card', 'citation-verifier'] });
    const router = new IntentRouter();
    await expect(router.classify('summarize the attached project documents', activePolicy)).resolves.toMatchObject({
      intent_class: 'summarize_project',
      answer_mode: 'project_only'
    });
    await expect(router.classify('draft a report from the project files as docx', activePolicy)).resolves.toMatchObject({
      intent_class: 'draft_with_grounding',
      suggested_skills: expect.arrayContaining(['docx', 'style-card', 'citation-verifier'])
    });

    const auditDir = await tempProject();
    const audit = new AuditLogger(path.join(auditDir, 'audit.sqlite'));
    await audit.init();
    const summary = await updateLastSessionSummary({
      projectRoot: root,
      sessionId: 's2',
      turnCount: 2,
      lastTurns: [{ role: 'user', content: 'draft a report from the project files' }],
      policy: activePolicy,
      audit,
      now: new Date('2026-05-23T12:00:00.000Z')
    });
    expect(summary).toContain('2026-05-23T12:00:00.000Z');
    expect(readFileSync(path.join(root, 'project.yaml'), 'utf8')).toContain('last_session_summary');
    expect(audit.all().map((row) => row.event_type)).toContain('session.summary');
  });

  it('keeps Phase2 behavior disabled when Veluga mode or active project is missing', async () => {
    const root = await tempProject();
    mkdirSync(root, { recursive: true });
    const offPolicy = new PolicyContextStore(
      mergePolicies({ ...baseInput({ project_id: 'off', active_skills: ['citation-verifier'] }), session: { enable_veluga_orchestration: false } })
    ).get();
    const result = verifyProjectCitations({
      projectRoot: root,
      policy: offPolicy,
      text: 'Claim [src:nb_missing.txt#0|nb].'
    });
    expect(result.total_citations).toBe(0);
    await expect(
      updateLastSessionSummary({
        projectRoot: root,
        sessionId: 's3',
        turnCount: 1,
        lastTurns: [{ role: 'user', content: 'hello' }],
        policy: offPolicy
      })
    ).resolves.toBeNull();
  });
});
