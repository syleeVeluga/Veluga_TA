import type { AuditLogger } from '../audit-logger.js';
import type { GateDecision, IntentPlan, PolicyContext } from '../../../shared-types/src/index.js';
import { hasClearance, requiredClearanceForScope } from '../kb/kb-contract.js';

export interface KnowledgeGateOptions {
  kbAvailable: boolean;
  audit?: AuditLogger;
  sessionId?: string;
}

export function knowledgeGate(intent: IntentPlan, policy: PolicyContext, options: KnowledgeGateOptions): GateDecision {
  let decision: GateDecision;

  if (!intent.use_kb) {
    decision = { allow: true, reason: 'kb_not_requested', alternatives: [] };
  } else if (!options.kbAvailable) {
    decision = {
      allow: false,
      reason: 'KB service is temporarily unavailable',
      alternatives: ['Continue with project files and general guidance only']
    };
  } else if (policy.effective.external_apis === 'deny') {
    decision = {
      allow: false,
      reason: 'Policy denies external API or KB connector calls',
      alternatives: suggestProjectAlternatives(policy)
    };
  } else {
    decision = evaluateScopes(intent, policy);
  }

  options.audit?.append({
    session_id: options.sessionId ?? 'knowledge-gate',
    user_id: policy.user.user_id,
    event_type: 'gate.decided',
    payload: {
      allow: decision.allow,
      reason: decision.reason,
      requested_scopes: intent.kb_scopes,
      alternatives: decision.alternatives
    },
    policy_version_id: policy.policy_version_id
  });

  return decision;
}

function evaluateScopes(intent: IntentPlan, policy: PolicyContext): GateDecision {
  for (const scope of intent.kb_scopes) {
    if (!policy.hasKbScope(scope)) {
      return {
        allow: false,
        reason: `KB scope is not active for this policy: ${scope}`,
        alternatives: lowerScopeAlternatives(scope, policy)
      };
    }
    const required = requiredClearanceForScope(scope);
    if (!hasClearance(policy.user.clearance, required)) {
      return {
        allow: false,
        reason: `Insufficient clearance for ${scope}`,
        alternatives: lowerScopeAlternatives(scope, policy)
      };
    }
  }

  const estimatedTokens = estimateIntentTokens(intent);
  const budget = policy.veluga.kb_token_budget ?? 50000;
  if (estimatedTokens > budget) {
    return {
      allow: true,
      reason: 'kb_token_budget_warning',
      alternatives: [],
      scope_overrides: intent.kb_scopes.slice(0, Math.max(1, Math.floor(intent.kb_scopes.length / 2)))
    };
  }

  return { allow: true, reason: 'ok', alternatives: [] };
}

function estimateIntentTokens(intent: IntentPlan): number {
  return intent.kb_scopes.length * 12000 + intent.suggested_skills.length * 1500;
}

function lowerScopeAlternatives(scope: string, policy: PolicyContext): string[] {
  const prefix = scope.split(':')[0];
  const candidates = policy.active_kb_scopes.filter((active) => active.startsWith(`${prefix}:`) || active.endsWith(':public'));
  return candidates.length ? candidates : suggestProjectAlternatives(policy);
}

function suggestProjectAlternatives(policy: PolicyContext): string[] {
  if (policy.project) {
    return ['Use project files already available in the workspace', 'Ask an authorized user to enable a narrower KB scope'];
  }
  return ['Proceed with general guidance only', 'Open a project with approved source files'];
}
