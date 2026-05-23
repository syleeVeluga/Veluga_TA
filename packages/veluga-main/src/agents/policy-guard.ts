import type { PolicyContext } from '../../../shared-types/src/index.js';
import type { AuditLogger } from '../audit-logger.js';

export type GuardDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'require_approval'; prompt: string; scope: 'this_call' | 'session' };

export interface GuardContext {
  session: { id: string };
  policy: PolicyContext;
}

export interface ToolPolicy {
  name: string;
  privilege: 'PUBLIC' | 'WRITE_LOCAL' | 'PRIVILEGED';
}

export class PolicyGuard {
  private readonly tools = new Map<string, ToolPolicy>();

  constructor(private readonly audit?: AuditLogger) {}

  register(tool: ToolPolicy): void {
    this.tools.set(tool.name, tool);
  }

  onBeforeCall(tool: string, args: unknown, ctx: GuardContext): GuardDecision {
    const policy = this.tools.get(tool);
    let decision: GuardDecision = { kind: 'allow' };
    let reason: string | null = null;

    if (!policy) {
      reason = 'Tool is not registered in the Veluga policy whitelist';
    } else if (policy.privilege === 'PRIVILEGED' && ctx.policy.user.clearance !== 'secret') {
      decision = { kind: 'deny', reason: 'Secret clearance is required for privileged tools' };
      reason = decision.reason;
    } else if (policy.privilege === 'WRITE_LOCAL' && ctx.policy.effective.approval_for_destructive === 'required') {
      decision = { kind: 'require_approval', prompt: `${tool} 실행 승인이 필요합니다.`, scope: 'this_call' };
    }

    if (reason) {
      this.audit?.append({
        session_id: ctx.session.id,
        user_id: ctx.policy.user.user_id,
        event_type: policy ? 'policy.violation_detected' : 'tool.unregistered',
        payload: { tool, args_masked: args, reason },
        policy_version_id: ctx.policy.policy_version_id
      });
    }

    if (ctx.policy.veluga.policy_guard_mode === 'dry-run') {
      return { kind: 'allow' };
    }
    return decision;
  }
}
