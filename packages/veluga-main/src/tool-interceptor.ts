import type { PolicyContext } from '../../shared-types/src/index.js';
import type { AuditLogger } from './audit-logger.js';
import type { PolicyGuard } from './agents/policy-guard.js';
import type { ApprovalQueue } from './approval/approval-queue.js';
import { hashApprovalPayload, type AgentStateManager } from './orchestrator/agent-state-manager.js';

export interface ExecutableTool {
  name: string;
  execute: (...args: unknown[]) => Promise<unknown> | unknown;
}

export type PermissionResult = 'allow' | 'deny' | 'allow_always';

export type PermissionResponse =
  | PermissionResult
  | {
      result: PermissionResult;
      payloadHash?: string;
      payload?: unknown;
    };

export interface PermissionRequester {
  requestPermission(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResponse>;
}

export function interceptTools<T extends ExecutableTool>(
  tools: T[],
  options: {
    guard: PolicyGuard;
    audit: AuditLogger;
    sessionId: string;
    policy: PolicyContext;
    approval?: {
      stateManager?: AgentStateManager;
      requestPermission?: PermissionRequester['requestPermission'];
      queue?: ApprovalQueue;
      approverId?: string;
      now?: () => Date;
    };
  }
): T[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (...args: unknown[]) => {
      const started = Date.now();
      const decision = options.guard.onBeforeCall(tool.name, args, {
        session: { id: options.sessionId },
        policy: options.policy
      });
      if (decision.kind === 'deny') {
        throw new Error(`Tool execution denied by policy: ${decision.reason}`);
      }
      if (decision.kind === 'require_approval') {
        const request = buildPermissionRequest({
          sessionId: options.sessionId,
          toolName: tool.name,
          args,
          prompt: decision.prompt,
          scope: decision.scope,
          policyVersionId: options.policy.policy_version_id
        });
        options.approval?.queue?.enqueue({
          approval_id: request.toolUseId,
          report_id: request.toolUseId,
          author: { user_id: options.policy.user.user_id, name: options.policy.user.user_id },
          approver_id: options.approval.approverId ?? 'policy-approver',
          submitted_at: (options.approval.now?.() ?? new Date()).toISOString(),
          title: decision.prompt,
          body: JSON.stringify(request.input),
          compliance_verdict: 'yellow',
          compliance_summary: 'Tool execution requires human approval',
          citation_tree_ready: false,
          status: 'submitted'
        });
        options.audit.append({
          session_id: options.sessionId,
          user_id: options.policy.user.user_id,
          event_type: 'hitl.requested',
          payload: { tool: tool.name, toolUseId: request.toolUseId, payload_hash: request.payloadHash },
          policy_version_id: options.policy.policy_version_id
        });
        const stateManager = options.approval?.stateManager;
        if (stateManager?.current() === 'RUNNING_PARALLEL') {
          stateManager.transition('AWAITING_APPROVAL', { approvalPayload: request.payload });
        }
        const requestPermission = options.approval?.requestPermission;
        if (!requestPermission) {
          if (stateManager?.current() === 'AWAITING_APPROVAL') {
            stateManager.transition('IDLE');
          }
          throw new Error(`Tool execution requires approval: ${decision.prompt}`);
        }

        const response = await requestPermission(options.sessionId, request.toolUseId, tool.name, request.input);
        const result = normalizePermissionResponse(response);
        const responsePayloadHash = result.payloadHash ?? (result.payload ? hashApprovalPayload(result.payload) : request.payloadHash);
        if (responsePayloadHash !== request.payloadHash) {
          options.audit.append({
            session_id: options.sessionId,
            user_id: options.policy.user.user_id,
            event_type: 'approval.payload_drift',
            payload: { expected_hash: request.payloadHash, actual_hash: responsePayloadHash },
            policy_version_id: options.policy.policy_version_id
          });
          if (stateManager?.current() === 'AWAITING_APPROVAL') {
            stateManager.transition('CRITICAL_ERROR');
          }
          throw new Error('Approval payload drift detected; refusing tool execution');
        }
        if (stateManager?.verifyApprovalPayload(request.payload) === false) {
          if (stateManager.current() === 'AWAITING_APPROVAL') {
            stateManager.transition('CRITICAL_ERROR');
          }
          throw new Error('Approval payload drift detected; refusing tool execution');
        }
        options.audit.append({
          session_id: options.sessionId,
          user_id: options.policy.user.user_id,
          event_type: 'hitl.resolved',
          payload: { tool: tool.name, toolUseId: request.toolUseId, result: result.result },
          policy_version_id: options.policy.policy_version_id
        });
        if (result.result === 'deny') {
          if (stateManager?.current() === 'AWAITING_APPROVAL') {
            stateManager.transition('IDLE');
          }
          throw new Error(`Tool execution requires approval: ${decision.prompt}`);
        }
        if (stateManager?.current() === 'AWAITING_APPROVAL') {
          stateManager.transition('RUNNING_PARALLEL');
        }
      }
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

function buildPermissionRequest(input: {
  sessionId: string;
  toolName: string;
  args: unknown[];
  prompt: string;
  scope: string;
  policyVersionId: string;
}): {
  toolUseId: string;
  input: Record<string, unknown>;
  payload: Record<string, unknown>;
  payloadHash: string;
} {
  const permissionInput = {
    args: input.args,
    prompt: input.prompt,
    scope: input.scope,
    policy_version_id: input.policyVersionId
  };
  const payload = {
    sessionId: input.sessionId,
    toolName: input.toolName,
    input: permissionInput
  };
  const payloadHash = hashApprovalPayload(payload);
  return {
    toolUseId: `${input.toolName}-${payloadHash.slice(0, 16)}`,
    input: { ...permissionInput, payload_hash: payloadHash },
    payload,
    payloadHash
  };
}

function normalizePermissionResponse(response: PermissionResponse): {
  result: PermissionResult;
  payloadHash?: string;
  payload?: unknown;
} {
  if (typeof response === 'string') return { result: response };
  return response;
}
