import type { PolicyContext } from '../../shared-types/src/index.js';
import type { AuditLogger } from './audit-logger.js';
import type { PolicyGuard } from './agents/policy-guard.js';

export interface ExecutableTool {
  name: string;
  execute: (...args: unknown[]) => Promise<unknown> | unknown;
}

export function interceptTools<T extends ExecutableTool>(
  tools: T[],
  options: {
    guard: PolicyGuard;
    audit: AuditLogger;
    sessionId: string;
    policy: PolicyContext;
  }
): T[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (...args: unknown[]) => {
      const started = Date.now();
      options.guard.onBeforeCall(tool.name, args, { session: { id: options.sessionId }, policy: options.policy });
      const result = await tool.execute(...args);
      options.audit.append({
        session_id: options.sessionId,
        user_id: options.policy.user.user_id,
        event_type: 'tool.called',
        payload: {
          tool: tool.name,
          args_masked: args,
          latency_ms: Date.now() - started,
          result_hash: JSON.stringify(result).slice(0, 256)
        },
        policy_version_id: options.policy.policy_version_id
      });
      return result;
    }
  }));
}
