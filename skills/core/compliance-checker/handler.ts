import type { AuditLogger } from '../../../packages/veluga-main/src/audit-logger.js';
import type { Clearance, KbEvidence, PolicyContext } from '../../../packages/shared-types/src/index.js';
import type { TraceResult } from '../../../packages/veluga-main/src/kb/citation-tracer.js';
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
  citationTrace?: TraceResult;
  mode?: 'basic' | 'full';
  audit?: AuditLogger;
  sessionId?: string;
}

export interface ComplianceViolation {
  rule_id: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  remediation?: string;
}

export interface ComplianceResult {
  passed: boolean;
  violations: ComplianceViolation[];
  verdict: 'green' | 'yellow' | 'red';
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

export const COMPLIANCE_FULL_RULE_IDS = [
  ...COMPLIANCE_RULE_IDS,
  'tag-001',
  'tag-002',
  'tag-003',
  'cite-001',
  'cite-002',
  'sec-002',
  'sec-003',
  'sec-004',
  'fmt-002',
  'fmt-003',
  'ret-002',
  'ret-003',
  'kb-002',
  'kb-003',
  'hitl-001'
] as const;

export const COMPLIANCE_RULE_CATALOG: Record<string, { level: 'error' | 'warn' | 'info'; remediation: string }> = {
  'clr-001': { level: 'error', remediation: '사용자 권한 이하의 자료만 사용하거나 결재자를 상향 지정하세요.' },
  'clr-002': { level: 'error', remediation: '문서 최고 등급 이상 권한을 가진 결재 라인으로 변경하세요.' },
  'ret-001': { level: 'warn', remediation: '기관 기본 보존기간 이상으로 보존기간을 조정하세요.' },
  'src-001': { level: 'warn', remediation: '본문 인용 태그와 로컬 evidence 레코드를 동기화하세요.' },
  'src-002': { level: 'error', remediation: '[unverified] 표식을 검증된 출처 인용으로 교체하세요.' },
  'prm-001': { level: 'warn', remediation: 'parametric 태그를 KB 인용 또는 참고자료 섹션으로 이동하세요.' },
  'sec-001': { level: 'error', remediation: 'secret 자료는 strict HITL 모드에서만 처리하세요.' },
  'ext-001': { level: 'error', remediation: '외부 KB connector 허용 정책을 확인하거나 KB 사용을 중단하세요.' },
  'kb-001': { level: 'error', remediation: '활성 KB scope에 포함된 자료만 사용하세요.' },
  'fmt-001': { level: 'warn', remediation: '지원되는 출력 형식(docx, pptx, xlsx, text)을 사용하세요.' },
  'tag-001': { level: 'error', remediation: '정식 근거 섹션의 [parametric:*]를 KB 인용으로 교체하세요.' },
  'tag-002': { level: 'error', remediation: '정식 근거 섹션의 NB 인용을 참고자료 섹션으로 이동하세요.' },
  'tag-003': { level: 'warn', remediation: '일반 보고서 parametric 태그에는 워터마크를 적용하세요.' },
  'cite-001': { level: 'warn', remediation: '개정된 자료의 최신 doc_id로 갱신하거나 as_of_date를 명시하세요.' },
  'cite-002': { level: 'error', remediation: '폐지된 자료를 대체 자료로 교체하세요.' },
  'sec-002': { level: 'error', remediation: '결재 본문에 주민등록번호 등 PII를 포함하지 마세요.' },
  'sec-003': { level: 'error', remediation: '본문에서 비인가 외부 URL을 제거하세요.' },
  'sec-004': { level: 'warn', remediation: '대외비 문서에는 결재자 확인 문구를 포함하세요.' },
  'fmt-002': { level: 'warn', remediation: '결재 문서에는 정식 근거 섹션을 포함하세요.' },
  'fmt-003': { level: 'warn', remediation: '참고자료 섹션을 분리해 비정식 근거를 배치하세요.' },
  'ret-002': { level: 'info', remediation: '보존기간 정책 스냅샷을 봉인 산출물에 포함하세요.' },
  'ret-003': { level: 'warn', remediation: '문서에 보존기간 문구를 명시하세요.' },
  'kb-002': { level: 'warn', remediation: 'KB 인용에는 as_of 날짜를 포함하세요.' },
  'kb-003': { level: 'error', remediation: '근거 섹션에는 KB 인용만 배치하세요.' },
  'hitl-001': { level: 'info', remediation: '결재 제출 전 명시적 사용자 승인을 기록하세요.' }
};

const KB_TAG_RE = /\[src:([^|\]]+)\|kb\|as_of:(\d{4}-\d{2}-\d{2})\]/g;
const ANY_KB_TAG_RE = /\[src:[^|\]]+\|kb(?:\|[^\]]+)?\]/g;
const NB_TAG_RE = /\[src:[^|\]]+\|nb(?:\|[^\]]+)?\]/g;
const PARAMETRIC_TAG_RE = /\[parametric:[^\]]+\]/g;
const SUPPORTED_FORMATS = new Set(['docx', 'pptx', 'xlsx', 'text']);
const EVIDENCE_HEADING_RE = /^#{1,3}\s*(정식\s*근거|법적\s*근거|근거\s*법령|Evidence|Legal Basis)\s*$/imu;
const REFERENCE_HEADING_RE = /^#{1,3}\s*(참고\s*자료|참고\s*문헌|Reference|Appendix)\s*$/imu;

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
        message: `${evidence.doc_id} classification exceeds user clearance`,
        remediation: remediation('clr-001')
      });
    }
    if (evidence.scope && !input.policy.hasKbScope(evidence.scope)) {
      violations.push({ rule_id: 'kb-001', level: 'error', message: `${evidence.scope} is not active`, remediation: remediation('kb-001') });
    }
  }

  for (const match of input.text.matchAll(KB_TAG_RE)) {
    const evidence = evidenceByCitation.get(kbEvidenceKey(match[1], match[2]));
    if (!evidence) {
      violations.push({ rule_id: 'src-001', level: 'warn', message: `${match[0]} has no local evidence record`, remediation: remediation('src-001') });
    }
  }

  if ((input.usedKb || input.kbEvidence?.length) && !KB_TAG_RE.test(input.text)) {
    violations.push({ rule_id: 'src-001', level: 'warn', message: 'KB-grounded text has no KB citation tags', remediation: remediation('src-001') });
  }
  KB_TAG_RE.lastIndex = 0;

  const approvalLine = input.approvalLineClearance ?? input.policy.user.clearance;
  if (clearanceRank(approvalLine) < clearanceRank(maxClassification)) {
    violations.push({ rule_id: 'clr-002', level: 'error', message: 'approval line clearance is below document classification', remediation: remediation('clr-002') });
  }

  if ((input.retentionDays ?? input.policy.effective.retention_default_days) < input.policy.effective.retention_default_days) {
    violations.push({ rule_id: 'ret-001', level: 'warn', message: 'retention period is below institutional default', remediation: remediation('ret-001') });
  }

  if (input.text.includes('[unverified]')) {
    violations.push({ rule_id: 'src-002', level: 'error', message: 'draft contains unverified citation markers', remediation: remediation('src-002') });
  }
  if (/\[parametric:(high|low)\]/.test(input.text)) {
    violations.push({ rule_id: 'prm-001', level: 'warn', message: 'draft still contains parametric tags', remediation: remediation('prm-001') });
  }
  if (maxClassification === 'secret' && input.policy.hitl_mode !== 'strict') {
    violations.push({ rule_id: 'sec-001', level: 'error', message: 'secret material requires strict HITL mode', remediation: remediation('sec-001') });
  }
  if ((input.usedKb || input.kbEvidence?.length) && input.policy.effective.external_apis === 'deny') {
    violations.push({ rule_id: 'ext-001', level: 'error', message: 'policy denies KB connector calls', remediation: remediation('ext-001') });
  }
  if (input.outputFormat && !SUPPORTED_FORMATS.has(input.outputFormat)) {
    violations.push({ rule_id: 'fmt-001', level: 'warn', message: `${input.outputFormat} is not a supported output format`, remediation: remediation('fmt-001') });
  }

  if (input.mode === 'full') {
    applyFullRules(input, violations);
  }
  const verdict = toVerdict(violations);

  input.audit?.append({
    session_id: input.sessionId ?? 'compliance-checker',
    user_id: input.policy.user.user_id,
    event_type: 'compliance.checked',
    payload: { passed: verdict !== 'red', violation_count: violations.length, verdict },
    policy_version_id: input.policy.policy_version_id
  });

  return {
    passed: !violations.some((violation) => violation.level === 'error'),
    violations,
    verdict
  };
}

function kbEvidenceKey(docId: string, asOf: string): string {
  return `${docId}|${asOf}`;
}

function applyFullRules(input: ComplianceInput, violations: ComplianceViolation[]): void {
  const sections = splitSections(input.text);
  if (sections.evidence && PARAMETRIC_TAG_RE.test(sections.evidence)) {
    violations.push({ rule_id: 'tag-001', level: 'error', message: 'formal evidence section contains parametric tags', remediation: remediation('tag-001') });
  }
  PARAMETRIC_TAG_RE.lastIndex = 0;

  if (sections.evidence && NB_TAG_RE.test(sections.evidence)) {
    violations.push({ rule_id: 'tag-002', level: 'error', message: 'formal evidence section contains notebook citations', remediation: remediation('tag-002') });
  }
  NB_TAG_RE.lastIndex = 0;

  if (sections.evidence && /https?:\/\//i.test(sections.evidence)) {
    violations.push({ rule_id: 'sec-003', level: 'error', message: 'formal evidence section contains external URLs', remediation: remediation('sec-003') });
  }
  if (sections.evidence && !ANY_KB_TAG_RE.test(sections.evidence)) {
    violations.push({ rule_id: 'kb-003', level: 'error', message: 'formal evidence section has no KB citations', remediation: remediation('kb-003') });
  }
  ANY_KB_TAG_RE.lastIndex = 0;

  if (!sections.evidence) {
    violations.push({ rule_id: 'fmt-002', level: 'warn', message: 'approval document has no formal evidence section', remediation: remediation('fmt-002') });
  }
  if (!sections.reference) {
    violations.push({ rule_id: 'fmt-003', level: 'warn', message: 'approval document has no separated reference section', remediation: remediation('fmt-003') });
  }
  if (/\b\d{6}[-\s]?\d{7}\b/.test(input.text)) {
    violations.push({ rule_id: 'sec-002', level: 'error', message: 'approval body contains resident registration number pattern', remediation: remediation('sec-002') });
  }
  if (input.documentClassification === 'confidential' && !/결재자\s*확인|approver confirmation/i.test(input.text)) {
    violations.push({ rule_id: 'sec-004', level: 'warn', message: 'confidential approval body lacks approver confirmation wording', remediation: remediation('sec-004') });
  }
  if (!/보존\s*기간|retention period/i.test(input.text)) {
    violations.push({ rule_id: 'ret-003', level: 'warn', message: 'retention period is not stated in the body', remediation: remediation('ret-003') });
  }
  if (ANY_KB_TAG_RE.test(input.text) && !KB_TAG_RE.test(input.text)) {
    violations.push({ rule_id: 'kb-002', level: 'warn', message: 'KB citation is missing as_of date', remediation: remediation('kb-002') });
  }
  ANY_KB_TAG_RE.lastIndex = 0;
  KB_TAG_RE.lastIndex = 0;

  if (input.citationTrace) {
    for (const result of input.citationTrace.results) {
      if (result.status === 'revised') {
        violations.push({ rule_id: 'cite-001', level: 'warn', message: result.message, remediation: remediation('cite-001') });
      }
      if (result.status === 'superseded' || result.status === 'not_found') {
        violations.push({ rule_id: 'cite-002', level: 'error', message: result.message, remediation: remediation('cite-002') });
      }
    }
  }
}

function splitSections(text: string): { evidence?: string; reference?: string } {
  const lines = text.split(/\r?\n/);
  const sections: { evidence?: string[]; reference?: string[] } = {};
  let current: keyof typeof sections | null = null;

  for (const line of lines) {
    if (EVIDENCE_HEADING_RE.test(line)) {
      current = 'evidence';
      sections.evidence = [];
      continue;
    }
    if (REFERENCE_HEADING_RE.test(line)) {
      current = 'reference';
      sections.reference = [];
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      current = null;
    }
    if (current) sections[current]?.push(line);
  }

  return {
    evidence: sections.evidence?.join('\n').trim(),
    reference: sections.reference?.join('\n').trim()
  };
}

function remediation(ruleId: string): string {
  return COMPLIANCE_RULE_CATALOG[ruleId]?.remediation ?? '정책 담당자에게 확인하세요.';
}

function toVerdict(violations: ComplianceViolation[]): 'green' | 'yellow' | 'red' {
  if (violations.some((violation) => violation.level === 'error')) return 'red';
  if (violations.some((violation) => violation.level === 'warn')) return 'yellow';
  return 'green';
}
