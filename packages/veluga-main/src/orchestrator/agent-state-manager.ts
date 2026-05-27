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
}

export class AgentStateManager {
  private state: AgentSessionState = 'IDLE';

  constructor(private readonly options: AgentStateManagerOptions) {}

  current(): AgentSessionState {
    return this.state;
  }

  transition(to: AgentSessionState): AgentStateSnapshot {
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
    const snapshot = { sessionId: this.options.sessionId, state: to, previousState: from };
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
    return { sessionId: this.options.sessionId, state: this.state };
  }
}
