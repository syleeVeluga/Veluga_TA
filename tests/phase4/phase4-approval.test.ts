import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mergePolicies } from '../../packages/policy-service/src/merge.js';
import type { KbTraverseOutput, PolicyContext } from '../../packages/shared-types/src/index.js';
import { PolicyContextStore } from '../../packages/shared-types/src/index.js';
import { ApprovalQueue, type ApprovalItem } from '../../packages/veluga-main/src/approval/approval-queue.js';
import { MockApprovalConnector } from '../../packages/veluga-main/src/approval/connector.js';
import { sealApproval, verifySeal } from '../../packages/veluga-main/src/approval/seal.js';
import { DockerSandbox } from '../../packages/veluga-main/src/sandbox/docker-sandbox.js';
import { traceCitations } from '../../packages/veluga-main/src/kb/citation-tracer.js';
import { KbMcpAdapter, type KbMcpClient, type KbToolName } from '../../packages/veluga-main/src/kb/kb-mcp-adapter.js';
import { COMPLIANCE_FULL_RULE_IDS, COMPLIANCE_RULE_CATALOG, checkCompliance } from '../../skills/core/compliance-checker/handler.js';
import { ApprovalQueueArtifact } from '../../packages/veluga-renderer/src/artifacts/ApprovalQueueArtifact.js';

function makePhase4Policy(): PolicyContext {
  return new PolicyContextStore(
    mergePolicies({
      identity: {
        user_id: 'approver@veluga.io',
        dept: 'legal',
        roles: ['approver'],
        clearance: 'internal'
      },
      institution: {
        external_apis: 'allow',
        audit_log: 'required',
        default_veluga_mode: true,
        policy_guard_mode: 'enforce',
        hitl_mode: 'normal',
        retention_default_days: 1825
      },
      org: {
        org_id: 'legal',
        default_skills: ['system-self-help', 'citation-tracer', 'compliance-checker'],
        kb_scopes: ['law:public', 'policy:internal'],
        active_mcp_connectors: ['external-kb', 'approval-mock']
      },
      project: {
        project_id: 'phase4',
        allowed_scopes: ['law:public', 'policy:internal'],
        active_skills: ['citation-tracer', 'compliance-checker', 'docx']
      },
      user: {},
      session: { kb_token_budget: 50000 }
    })
  ).get();
}

class TraverseMockClient implements KbMcpClient {
  async listTools(): Promise<string[]> {
    return ['kb_search', 'kb_metadata', 'kb_hybrid', 'kb_traverse'];
  }

  async callTool(name: KbToolName): Promise<unknown> {
    if (name !== 'kb_traverse') return { chunks: [] };
    return traverseOutput();
  }
}

function traverseOutput(): KbTraverseOutput {
  return {
    nodes: [
      {
        id: 'law_2023_0145',
        label: 'Old regulation',
        scope: 'law:public',
        classification: 'public',
        valid_from: '2023-01-01',
        valid_to: null,
        properties: {}
      },
      {
        id: 'law_2026_0503',
        label: 'New regulation',
        scope: 'law:public',
        classification: 'public',
        valid_from: '2026-05-03',
        valid_to: null,
        properties: {}
      },
      {
        id: 'secret_node',
        label: 'Redacted node',
        scope: 'audit:confidential',
        classification: 'confidential',
        valid_from: '2026-01-01',
        valid_to: null,
        properties: {}
      }
    ],
    edges: [
      { type: 'revised_by', from_node: 'law_2023_0145', to_node: 'law_2026_0503', properties: { effective: '2026-05-03' } },
      { type: 'references', from_node: 'law_2023_0145', to_node: 'secret_node', properties: {} }
    ],
    summary: 'law_2023_0145 has a newer revision'
  };
}

function approvalItems(count = 8): ApprovalItem[] {
  return Array.from({ length: count }, (_, index) => {
    const green = index < 5;
    const approval_id = `ap-${index + 1}`;
    return {
      approval_id,
      report_id: `r-${index + 1}`,
      author: { user_id: `author-${index + 1}@veluga.io`, name: `작성자 ${index + 1}` },
      approver_id: 'approver@veluga.io',
      submitted_at: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      title: `보고서 ${index + 1}`,
      body: '본문',
      compliance_verdict: green ? 'green' : index < 7 ? 'yellow' : 'red',
      compliance_summary: green ? '인용 OK / 위반 0건' : '검토 필요',
      citation_tree_ready: true,
      status: 'ready_for_review',
      sealed_report: green
        ? {
            approval_id,
            report_id: `r-${index + 1}`,
            sealed_path: `sealed/${approval_id}.seal.json`,
            hash_self: `hash-${index + 1}`
          }
        : undefined
    };
  });
}

describe('Phase4 approval line', () => {
  it('validates kb_traverse, post-filters graph output, and detects revised citations', async () => {
    const policy = makePhase4Policy();
    const adapter = new KbMcpAdapter({ client: new TraverseMockClient() });
    await expect(adapter.healthCheck(policy)).resolves.toBe(true);
    expect(adapter.hasTraverseTool()).toBe(true);

    const trace = await traceCitations({
      text: '점검 대상 [src:law_2023_0145|kb|as_of:2026-05-01]',
      policy,
      kb: adapter
    });

    expect(trace.overall).toBe('yellow');
    expect(trace.results[0]).toMatchObject({ status: 'revised', suggested_doc_id: 'law_2026_0503' });
    const graph = await adapter.traverse(
      { start_node: 'law_2023_0145', edge_types: ['revised_by'], as_of_date: '2026-05-01', user_scopes: policy.active_kb_scopes },
      policy
    );
    expect(graph.nodes.map((node) => node.id)).not.toContain('secret_node');
    expect(graph.edges.every((edge) => edge.to_node !== 'secret_node')).toBe(true);
  });

  it('runs full compliance rules with 25 rule catalog entries and blocks formal evidence violations', () => {
    const policy = makePhase4Policy();
    expect(COMPLIANCE_FULL_RULE_IDS).toHaveLength(25);
    expect(COMPLIANCE_FULL_RULE_IDS.every((id) => COMPLIANCE_RULE_CATALOG[id]?.remediation)).toBe(true);

    const result = checkCompliance({
      text: [
        '# 보고서',
        '보존 기간 5년',
        '## 정식 근거',
        '[parametric:high] [src:notes.md|nb] [src:law_2023_0145|kb|as_of:2026-05-01]',
        '## 참고자료',
        '결재자 확인'
      ].join('\n'),
      policy,
      mode: 'full',
      kbEvidence: [{ doc_id: 'law_2023_0145', as_of: '2026-05-01', text: 'old law', classification: 'public', scope: 'law:public' }],
      usedKb: true,
      citationTrace: {
        overall: 'yellow',
        results: [
          {
            tag: '[src:law_2023_0145|kb|as_of:2026-05-01]',
            doc_id: 'law_2023_0145',
            as_of: '2026-05-01',
            status: 'revised',
            message: 'law_2023_0145 has a newer revision',
            suggested_doc_id: 'law_2026_0503'
          }
        ]
      }
    });

    expect(result.verdict).toBe('red');
    expect(result.violations.map((violation) => violation.rule_id)).toEqual(expect.arrayContaining(['tag-001', 'tag-002', 'cite-001']));
    expect(result.violations.every((violation) => violation.remediation)).toBe(true);
  });

  it('renders an approval queue artifact, bulk-approves five green items, and sends rejection notifications', async () => {
    const connector = new MockApprovalConnector();
    const queue = new ApprovalQueue({ connector, policyVersionId: 'p4' });
    queue.seed(approvalItems());

    const listed = queue.list('approver@veluga.io');
    expect(listed.items).toHaveLength(8);
    expect(listed.items.slice(0, 5).every((item) => item.compliance_verdict === 'green')).toBe(true);

    const html = renderToStaticMarkup(React.createElement(ApprovalQueueArtifact, { data: listed }));
    expect(html).toContain('결재 큐');
    expect(html).toContain('보고서 1');

    const approved = await queue.bulkApprove(
      listed.items.filter((item) => item.compliance_verdict === 'green').map((item) => item.approval_id),
      'approver@veluga.io',
      true
    );
    expect(approved.approved).toHaveLength(5);
    expect(queue.list('approver@veluga.io').items).toHaveLength(3);

    const notification = queue.reject('ap-6', 'approver@veluga.io', '개정 자료 반영 후 재상신 바랍니다.', 'phase4');
    expect(notification).toMatchObject({ to: 'author-6@veluga.io', project_id: 'phase4' });
    expect(queue.sentNotifications).toHaveLength(1);
    expect(queue.list('approver@veluga.io').items.map((item) => item.approval_id)).not.toContain('ap-6');
    await expect(queue.bulkApprove(['ap-7'], 'other-approver@veluga.io', true)).rejects.toThrow(/assigned to approver@veluga\.io/);
  });

  it('seals approval payloads, detects tampering, and builds hardened Docker sandbox arguments', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veluga-phase4-'));
    const sealed = sealApproval({
      outputDir: dir,
      hmacKey: 'test-secret',
      payload: {
        approval_id: 'ap-seal',
        report_id: 'r-seal',
        body: 'sealed body',
        policy_snapshot: { policy_version_id: 'p4' },
        citation_trace: { overall: 'green' },
        approver: 'approver@veluga.io'
      }
    });

    expect(verifySeal({ sealed_path: sealed.sealed_path, hmacKey: 'test-secret' }).ok).toBe(true);
    expect(() =>
      sealApproval({
        outputDir: dir,
        hmacKey: 'test-secret',
        payload: {
          approval_id: '../escape',
          report_id: 'r-seal',
          body: 'sealed body',
          policy_snapshot: { policy_version_id: 'p4' },
          citation_trace: { overall: 'green' },
          approver: 'approver@veluga.io'
        }
      })
    ).toThrow(/filename-safe/);
    const tampered = (await readFile(sealed.sealed_path, 'utf8')).replace('sealed body', 'tampered body');
    await writeFile(sealed.sealed_path, tampered, 'utf8');
    expect(verifySeal({ sealed_path: sealed.sealed_path, hmacKey: 'test-secret' }).ok).toBe(false);

    const sandbox = new DockerSandbox({
      image: 'veluga-sandbox:1.0',
      network: 'none',
      readOnly: true,
      capDrop: ['ALL'],
      capAdd: [],
      securityOpt: ['no-new-privileges'],
      user: '65534:65534',
      memory: '512m',
      cpus: '1.0',
      timeoutSeconds: 30,
      mounts: [{ source: dir, target: '/workspace', mode: 'rw' }]
    });
    const args = sandbox.buildDockerArgs(['python', '/workspace/analyze.py']);
    expect(args).toEqual(expect.arrayContaining(['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']));
  });
});
