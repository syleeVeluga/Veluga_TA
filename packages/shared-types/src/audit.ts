export type AuditEventType =
  | 'session.start'
  | 'session.end'
  | 'intent.classified'
  | 'policy.violation_detected'
  | 'policy.updated'
  | 'tool.called'
  | 'tool.unregistered'
  | 'hitl.requested'
  | 'hitl.resolved'
  | 'skill.activated'
  | 'general.responded'
  | 'session.summary'
  | 'citation.linked'
  | 'style_card.extracted'
  | 'unverified.detected'
  | 'kb.unavailable'
  | 'kb.queried'
  | 'kb.over_classification'
  | 'gate.decided'
  | 'compliance.checked'
  | 'orchestration.session_transition'
  | 'orchestration.illegal_transition'
  | 'orchestration.task_transition'
  | 'orchestration.plan_rejected'
  | 'orchestration.budget_exceeded'
  | 'orchestration.execution_failed'
  | 'approval.submitted'
  | 'approval.granted'
  | 'approval.rejected'
  | 'approval.payload_drift'
  | 'seal.verify_failed'
  | 'sandbox.run';

export interface AuditEventInput {
  session_id: string;
  user_id: string;
  event_type: AuditEventType;
  payload: unknown;
  policy_version_id: string;
}

export interface AuditLogRow {
  id: number;
  ts: string;
  session_id: string;
  user_id: string;
  event_type: string;
  payload_json: string;
  policy_version_id: string;
  hash_prev: string | null;
  hash_self: string;
}
