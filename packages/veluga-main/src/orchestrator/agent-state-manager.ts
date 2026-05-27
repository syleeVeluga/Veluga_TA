import { createHash } from 'node:crypto';
import type { PolicyContext } from '../../../shared-types/src/index.js';
import type { AuditLogger } from '../audit-logger.js';

export type AgentSessionState =
  | 'IDLE'
  | 'PLANNING'
  | 'AWAITING_CLARIFICATION'
  | 'RUNNING_PARALLEL'
  | 'AWAITING_APPROVAL'
  | 'COMPLIANCE_CHECKING'
  | 'STREAMING_RESPONSE'
  | 'CRITICAL_ERROR';

export const STATE_TRANSITIONS: Readonly<Record<AgentSessionState, readonly AgentSessionState[]>> = {
  IDLE: ['PLANNING', 'CRITICAL_ERROR'],
  PLANNING: ['RUNNING_PARALLEL', 'AWAITING_CLARIFICATION', 'CRITICAL_ERROR'],
  AWAITING_CLARIFICATION: ['PLANNING', 'IDLE', 'CRITICAL_ERROR'],
  RUNNING_PARALLEL: ['AWAITING_APPROVAL', 'COMPLIANCE_CHECKING', 'PLANNING', 'CRITICAL_ERROR'],
  AWAITING_APPROVAL: ['RUNNING_PARALLEL', 'IDLE', 'CRITICAL_ERROR'],
  COMPLIANCE_CHECKING: ['STREAMING_RESPONSE', 'IDLE', 'CRITICAL_ERROR'],
  STREAMING_RESPONSE: ['IDLE', 'CRITICAL_ERROR'],
  CRITICAL_ERROR: ['IDLE']
};

export interface AgentStateManagerOptions {
  sessionId: string;
  policy: PolicyContext;
  audit?: AuditLogger;
  onTransition?: (snapshot: AgentStateSnapshot) => void;
}

export interface AgentStateSnapshot {
  sessionId: string;
  state: AgentSessionState;
  previousState?: AgentSessionState;
  approvalPayloadHash?: string;
}

export class AgentStateManager {
  private state: AgentSessionState = 'IDLE';
  private approvalPayloadHash: string | undefined;

  constructor(private readonly options: AgentStateManagerOptions) {}

  current(): AgentSessionState {
    return this.state;
  }

  transition(to: AgentSessionState, metadata: { approvalPayload?: unknown } = {}): AgentStateSnapshot {
    const from = this.state;
    if (!STATE_TRANSITIONS[from].includes(to)) {
      this.options.audit?.append({
        session_id: this.options.sessionId,
        user_id: this.options.policy.user.user_id,
        event_type: 'orchestration.illegal_transition',
        payload: { from, to },
        policy_version_id: this.options.policy.policy_version_id
      });
      throw new Error(`Illegal orchestration transition: ${from} -> ${to}`);
    }

    this.state = to;
    if (to === 'AWAITING_APPROVAL' && 'approvalPayload' in metadata) {
      this.approvalPayloadHash = hashApprovalPayload(metadata.approvalPayload);
    } else if (from === 'AWAITING_APPROVAL' && to !== 'AWAITING_APPROVAL') {
      this.approvalPayloadHash = undefined;
    }
    const snapshot = { sessionId: this.options.sessionId, state: to, previousState: from, approvalPayloadHash: this.approvalPayloadHash };
    this.options.audit?.append({
      session_id: this.options.sessionId,
      user_id: this.options.policy.user.user_id,
      event_type: 'orchestration.session_transition',
      payload: snapshot,
      policy_version_id: this.options.policy.policy_version_id
    });
    this.options.onTransition?.(snapshot);
    return snapshot;
  }

  snapshot(): AgentStateSnapshot {
    return { sessionId: this.options.sessionId, state: this.state, approvalPayloadHash: this.approvalPayloadHash };
  }

  verifyApprovalPayload(payload: unknown, expectedHash = this.approvalPayloadHash): boolean {
    if (!expectedHash) return true;
    const actualHash = hashApprovalPayload(payload);
    if (actualHash === expectedHash) return true;

    this.options.audit?.append({
      session_id: this.options.sessionId,
      user_id: this.options.policy.user.user_id,
      event_type: 'approval.payload_drift',
      payload: { expected_hash: expectedHash, actual_hash: actualHash },
      policy_version_id: this.options.policy.policy_version_id
    });
    return false;
  }
}

export function hashApprovalPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalizeApprovalPayload(payload)).digest('hex');
}

export function canonicalizeApprovalPayload(payload: unknown): string {
  return JSON.stringify(sortForCanonicalJson(payload));
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortForCanonicalJson((value as Record<string, unknown>)[key]);
  }
  return out;
}
