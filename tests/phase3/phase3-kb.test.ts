import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PolicyContextStore, type KbDocChunk, type PolicyContext } from '../../packages/shared-types/src/index.js';
import { mergePolicies } from '../../packages/policy-service/src/merge.js';
import { RpcPolicyServiceClient } from '../../packages/policy-service/src/rpc-client.js';
import { AuditLogger } from '../../packages/veluga-main/src/audit-logger.js';
import { knowledgeGate } from '../../packages/veluga-main/src/agents/knowledge-gate.js';
import { resolveSkillPlan } from '../../packages/veluga-main/src/agents/skill-resolver.js';
import { KbContractError, parseKbSearchOutput } from '../../packages/veluga-main/src/kb/kb-contract.js';
import { KbMcpAdapter, type KbMcpClient, type KbToolName } from '../../packages/veluga-main/src/kb/kb-mcp-adapter.js';
import { verifyProjectCitations } from '../../packages/veluga-main/src/citation-verifier.js';
import { draftGovProposal } from '../../skills/domain/gov-proposal/handler.js';
import { checkCompliance, COMPLIANCE_RULE_IDS } from '../../skills/core/compliance-checker/handler.js';

function makePhase3Policy(overrides: {
  clearance?: 'public' | 'internal' | 'confidential' | 'secret';
  externalApis?: 'allow' | 'deny';
  activeSkills?: string[];
  allowedScopes?: string[];
  kbScopes?: string[];
  retentionDays?: number;
  project?: boolean;
} = {}): PolicyContext {
  return new PolicyContextStore(
    mergePolicies({
      identity: {
        user_id: 'analyst@veluga.io',
        dept: 'strategy',
        roles: ['analyst'],
        clearance: overrides.clearance ?? 'internal'
      },
      institution: {
        external_apis: overrides.externalApis ?? 'allow',
        audit_log: 'required',
        default_veluga_mode: true,
        policy_guard_mode: 'enforce',
        hitl_mode: 'normal',
        retention_default_days: overrides.retentionDays ?? 1825
      },
      org: {
        org_id: 'strategy',
        default_skills: ['system-self-help', 'style-card', 'citation-verifier', 'compliance-checker'],
        kb_scopes: overrides.kbScopes ?? ['law:public', 'policy:internal', 'audit:confidential'],
        active_mcp_connectors: ['external-kb']
      },
      project:
        overrides.project === false
          ? null
          : {
              project_id: 'phase3',
              allowed_scopes: overrides.allowedScopes ?? ['law:public', 'policy:internal', 'audit:confidential'],
              active_skills: overrides.activeSkills ?? ['gov-proposal', 'docx', 'pptx', 'xlsx']
            },
      user: {},
      session: { kb_token_budget: 50000 }
    })
  ).get();
}

function chunks(): KbDocChunk[] {
  return Array.from({ length: 6 }, (_, index) => ({
    doc_id: `kb_policy_${index + 1}`,
    chunk_id: `c${index + 1}`,
    scope: index === 5 ? 'audit:confidential' : index % 2 ? 'policy:internal' : 'law:public',
    classification: index === 5 ? 'confidential' : index % 2 ? 'internal' : 'public',
    text: `Requirement ${index + 1} says the proposal must describe eligibility, evaluation criteria, evidence, budget fit, and operating controls.`,
    valid_from: '2026-01-01',
    valid_to: null,
    score: 0.9 - index * 0.05,
    metadata: { title: `Policy ${index + 1}` }
  }));
}

class MockKbClient implements KbMcpClient {
  constructor(private readonly availableTools = ['kb_search', 'kb_metadata', 'kb_hybrid']) {}

  async listTools(): Promise<string[]> {
    return this.availableTools;
  }

  async callTool(name: KbToolName): Promise<unknown> {
    if (name === 'kb_metadata') return { docs: [{ doc_id: 'kb_policy_1' }] };
    if (name === 'kb_search') return { chunks: chunks() };
    return { mixed: chunks(), routing_explain: 'hybrid(vector+keyword)' };
  }
}

async function auditLogger(): Promise<AuditLogger> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'veluga-phase3-audit-'));
  const audit = new AuditLogger(path.join(dir, 'audit.sqlite'));
  await audit.init();
  return audit;
}

describe('Phase3 KB integration', () => {
  it('validates KB contracts, lists required tools, redacts over-classified chunks, and audits routing', async () => {
    const policy = makePhase3Policy({ clearance: 'internal' });
    const audit = await auditLogger();
    const adapter = new KbMcpAdapter({ client: new MockKbClient(), audit, sessionId: 's3' });

    expect(await adapter.healthCheck(policy)).toBe(true);
    expect(adapter.listedTools).toEqual(['kb_hybrid', 'kb_metadata', 'kb_search']);
    expect(() => parseKbSearchOutput({ chunks: [{ doc_id: 'broken' }] })).toThrow(KbContractError);

    const result = await adapter.hybrid({ query: 'R&D proposal guidance', scopes: policy.active_kb_scopes }, policy);
    expect(result.mixed).toHaveLength(5);
    expect(result.mixed.every((chunk) => chunk.classification !== 'confidential')).toBe(true);
    expect(audit.all().map((row) => row.event_type)).toEqual(expect.arrayContaining(['kb.over_classification', 'kb.queried']));
    expect(audit.all().find((row) => row.event_type === 'kb.queried')?.payload_json).toContain('hybrid(vector+keyword)');
  });

  it('fails closed when KB is unavailable or policy/scope clearance blocks access before the KB call', async () => {
    const unavailablePolicy = makePhase3Policy();
    const unavailable = knowledgeGate(
      {
        intent_class: 'compare_project_vs_kb',
        answer_mode: 'mixed',
        use_kb: true,
        kb_scopes: ['law:public'],
        suggested_skills: ['gov-proposal'],
        needs_clarification: false,
        clarification_questions: []
      },
      unavailablePolicy,
      { kbAvailable: false }
    );
    expect(unavailable.allow).toBe(false);
    expect(unavailable.alternatives[0]).toContain('project files');

    const externalDenied = knowledgeGate(
      { ...unavailablePolicyIntent(), kb_scopes: ['law:public'] },
      makePhase3Policy({ externalApis: 'deny' }),
      { kbAvailable: true }
    );
    expect(externalDenied).toMatchObject({ allow: false, reason: expect.stringContaining('external API') });

    const noClearance = knowledgeGate(
      { ...unavailablePolicyIntent(), kb_scopes: ['audit:confidential'] },
      makePhase3Policy({ clearance: 'internal' }),
      { kbAvailable: true }
    );
    expect(noClearance.allow).toBe(false);
    expect(noClearance.alternatives.length).toBeGreaterThan(0);
  });

  it('resolves Phase3 skill dependencies in deterministic order', () => {
    const policy = makePhase3Policy();
    const plan = resolveSkillPlan(['gov-proposal'], policy);
    expect(plan.ordered_skills.map((step) => step.id)).toEqual([
      'style-card',
      'gov-proposal',
      'citation-verifier',
      'compliance-checker',
      'docx'
    ]);
    expect(plan.ordered_skills.find((step) => step.id === 'gov-proposal')?.mode).toBe('write');
    expect(plan.unresolved_skills).toEqual([]);
  });

  it('drafts gov-proposal text with KB citations and verifies KB evidence matches', async () => {
    const policy = makePhase3Policy({ clearance: 'confidential' });
    const adapter = new KbMcpAdapter({ client: new MockKbClient() });
    await adapter.healthCheck(policy);

    const draft = await draftGovProposal({
      query: 'government R&D proposal',
      policy,
      kb: adapter,
      projectFacts: ['The company has prior deployment records.', 'The project plan includes weekly risk review.']
    });

    expect(draft.citation_count).toBeGreaterThanOrEqual(5);
    expect(draft.text).not.toContain('nb_project-facts.md');
    const verification = verifyProjectCitations({
      projectRoot: os.tmpdir(),
      policy,
      text: draft.text,
      kbEvidence: draft.kbEvidence,
      threshold: 0.1
    });
    expect(verification.total_citations).toBeGreaterThanOrEqual(5);
    expect(verification.matched).toBeGreaterThanOrEqual(5);
  });

  it('verifies KB citations from evidence even when no project is active', () => {
    const policy = makePhase3Policy({ clearance: 'internal', project: false });
    const verification = verifyProjectCitations({
      projectRoot: os.tmpdir(),
      policy,
      text:
        'Proposal controls are required [src:kb_policy_1|kb|as_of:2026-01-01]. Local file claim [src:nb_project-facts.md#0|nb].',
      kbEvidence: [
        {
          doc_id: 'kb_policy_1',
          as_of: '2026-01-01',
          text: 'Proposal controls are required',
          classification: 'internal',
          scope: 'policy:internal'
        }
      ]
    });

    expect(verification.total_citations).toBe(2);
    expect(verification.matched).toBe(1);
    expect(verification.unmatched).toEqual([expect.objectContaining({ reason: 'project_not_active' })]);
  });

  it('runs the compliance-checker basic rule catalog', () => {
    const policy = makePhase3Policy({ clearance: 'internal', externalApis: 'deny', retentionDays: 365 });
    expect(COMPLIANCE_RULE_IDS).toHaveLength(10);
    const result = checkCompliance({
      text: 'Unsupported final [src:kb_policy_6|kb|as_of:2026-01-01][unverified][parametric:low]',
      policy,
      kbEvidence: [
        {
          doc_id: 'kb_policy_6',
          as_of: '2026-01-01',
          text: 'Secret evidence',
          classification: 'confidential',
          scope: 'audit:confidential'
        }
      ],
      retentionDays: 30,
      approvalLineClearance: 'internal',
      outputFormat: 'pdf',
      usedKb: true
    });
    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.rule_id)).toEqual(
      expect.arrayContaining(['clr-001', 'clr-002', 'ret-001', 'src-002', 'prm-001', 'ext-001', 'fmt-001'])
    );
  });

  it('requires KB compliance evidence to match both document and as-of date', () => {
    const policy = makePhase3Policy({ clearance: 'internal' });
    const result = checkCompliance({
      text: 'Supported claim [src:kb_policy_1|kb|as_of:2026-02-01]',
      policy,
      kbEvidence: [
        {
          doc_id: 'kb_policy_1',
          as_of: '2026-01-01',
          text: 'Supported claim',
          classification: 'internal',
          scope: 'policy:internal'
        }
      ],
      usedKb: true
    });

    expect(result.violations).toEqual([
      expect.objectContaining({ rule_id: 'src-001', message: expect.stringContaining('no local evidence') })
    ]);
  });

  it('keeps the PolicyService fetchAll contract compatible for RPC sources', async () => {
    const snapshot = mergePolicies({
      identity: { user_id: 'rpc@veluga.io', dept: 'ops', roles: [], clearance: 'secret' },
      institution: { external_apis: 'allow', default_veluga_mode: true, policy_guard_mode: 'enforce' },
      org: { kb_scopes: ['policy:internal'], default_skills: ['system-self-help'] },
      project: null,
      user: {},
      session: {}
    });
    const client = new RpcPolicyServiceClient({
      endpoint: 'http://policy.local',
      fetchImpl: async () => new Response(JSON.stringify(snapshot), { status: 200 })
    });

    await expect(client.fetchAll()).resolves.toMatchObject({
      user: { user_id: 'rpc@veluga.io' },
      active_kb_scopes: ['policy:internal']
    });
  });
});

function unavailablePolicyIntent() {
  return {
    intent_class: 'compare_project_vs_kb' as const,
    answer_mode: 'mixed' as const,
    use_kb: true,
    kb_scopes: ['law:public'],
    suggested_skills: ['gov-proposal'],
    needs_clarification: false,
    clarification_questions: []
  };
}
