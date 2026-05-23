import type { AuditLogger } from '../../../packages/veluga-main/src/audit-logger.js';
import type { Clearance, KbEvidence, PolicyContext } from '../../../packages/shared-types/src/index.js';
import { clearanceRank } from '../../../packages/veluga-main/src/kb/kb-contract.js';

export interface ComplianceInput {
  text: string;
  policy: PolicyContext;
  kbEvidence?: KbEvidence[];
  retentionDays?: number;
  approvalLineClearance?: Clearance;
  documentClassification?: Clearance;
  outputFormat?: string;
  usedKb?: boolean;
  audit?: AuditLogger;
  sessionId?: string;
}

export interface ComplianceViolation {
  rule_id: string;
  level: 'error' | 'warn';
  message: string;
}

export interface ComplianceResult {
  passed: boolean;
  violations: ComplianceViolation[];
}

export const COMPLIANCE_RULE_IDS = [
  'clr-001',
  'clr-002',
  'ret-001',
  'src-001',
  'src-002',
  'prm-001',
  'sec-001',
  'ext-001',
  'kb-001',
  'fmt-001'
] as const;

const KB_TAG_RE = /\[src:([^|\]]+)\|kb\|as_of:(\d{4}-\d{2}-\d{2})\]/g;
const SUPPORTED_FORMATS = new Set(['docx', 'pptx', 'xlsx', 'text']);

export function checkCompliance(input: ComplianceInput): ComplianceResult {
  const violations: ComplianceViolation[] = [];
  const evidenceByCitation = new Map((input.kbEvidence ?? []).map((evidence) => [kbEvidenceKey(evidence.doc_id, evidence.as_of), evidence]));
  let maxClassification: Clearance = input.documentClassification ?? 'public';

  for (const evidence of input.kbEvidence ?? []) {
    if (evidence.classification && clearanceRank(evidence.classification) > clearanceRank(maxClassification)) {
      maxClassification = evidence.classification;
    }
    if (evidence.classification && clearanceRank(evidence.classification) > clearanceRank(input.policy.user.clearance)) {
      violations.push({
        rule_id: 'clr-001',
        level: 'error',
        message: `${evidence.doc_id} classification exceeds user clearance`
      });
    }
    if (evidence.scope && !input.policy.hasKbScope(evidence.scope)) {
      violations.push({ rule_id: 'kb-001', level: 'error', message: `${evidence.scope} is not active` });
    }
  }

  for (const match of input.text.matchAll(KB_TAG_RE)) {
    const evidence = evidenceByCitation.get(kbEvidenceKey(match[1], match[2]));
    if (!evidence) {
      violations.push({ rule_id: 'src-001', level: 'warn', message: `${match[0]} has no local evidence record` });
    }
  }

  if ((input.usedKb || input.kbEvidence?.length) && !KB_TAG_RE.test(input.text)) {
    violations.push({ rule_id: 'src-001', level: 'warn', message: 'KB-grounded text has no KB citation tags' });
  }
  KB_TAG_RE.lastIndex = 0;

  const approvalLine = input.approvalLineClearance ?? input.policy.user.clearance;
  if (clearanceRank(approvalLine) < clearanceRank(maxClassification)) {
    violations.push({ rule_id: 'clr-002', level: 'error', message: 'approval line clearance is below document classification' });
  }

  if ((input.retentionDays ?? input.policy.effective.retention_default_days) < input.policy.effective.retention_default_days) {
    violations.push({ rule_id: 'ret-001', level: 'warn', message: 'retention period is below institutional default' });
  }

  if (input.text.includes('[unverified]')) {
    violations.push({ rule_id: 'src-002', level: 'error', message: 'draft contains unverified citation markers' });
  }
  if (/\[parametric:(high|low)\]/.test(input.text)) {
    violations.push({ rule_id: 'prm-001', level: 'warn', message: 'draft still contains parametric tags' });
  }
  if (maxClassification === 'secret' && input.policy.hitl_mode !== 'strict') {
    violations.push({ rule_id: 'sec-001', level: 'error', message: 'secret material requires strict HITL mode' });
  }
  if ((input.usedKb || input.kbEvidence?.length) && input.policy.effective.external_apis === 'deny') {
    violations.push({ rule_id: 'ext-001', level: 'error', message: 'policy denies KB connector calls' });
  }
  if (input.outputFormat && !SUPPORTED_FORMATS.has(input.outputFormat)) {
    violations.push({ rule_id: 'fmt-001', level: 'warn', message: `${input.outputFormat} is not a supported output format` });
  }

  input.audit?.append({
    session_id: input.sessionId ?? 'compliance-checker',
    user_id: input.policy.user.user_id,
    event_type: 'compliance.checked',
    payload: { passed: !violations.some((v) => v.level === 'error'), violation_count: violations.length },
    policy_version_id: input.policy.policy_version_id
  });

  return {
    passed: !violations.some((violation) => violation.level === 'error'),
    violations
  };
}

function kbEvidenceKey(docId: string, asOf: string): string {
  return `${docId}|${asOf}`;
}
