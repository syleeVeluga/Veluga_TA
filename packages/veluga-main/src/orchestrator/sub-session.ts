// Phase 3 (orchestrator) bounded sub-session runner. This validates and budgets
// multi-step deep-agent patterns and is not yet wired to the live spawn_agent
// path in cowork-core's agent-runner, which enforces equivalent guards inline.
// Keep the two implementations' rules in sync until they are consolidated.
import type { BoundedSubSessionRequest, BoundedSubSessionResult } from '../../../shared-types/src/index.js';
export {
  BUILTIN_GENERAL_SUBAGENT_PERSONA,
  SUMMARY_WITH_CITATIONS_CONTRACT
} from '../../../shared-types/src/index.js';

export type RunBoundedSubSession = (
  request: BoundedSubSessionRequest,
  signal: AbortSignal
) => Promise<BoundedSubSessionResult>;

export interface BoundedSubSessionRunnerOptions {
  enabled: boolean;
  maxSubSessions: number;
  tokenBudget: number;
  maxDepth?: number;
  allowedToolScope?: string[];
  run: RunBoundedSubSession;
  onEvent?: (event: {
    type:
      | 'deep_agent.spawn.requested'
      | 'deep_agent.spawn.started'
      | 'deep_agent.spawn.completed'
      | 'deep_agent.spawn.failed'
      | 'deep_agent.spawn.aborted'
      | 'deep_agent.budget.exceeded'
      | 'deep_agent.policy.denied';
    requestId: string;
    parentSessionId?: string;
    personaId?: string;
    tokensUsed?: number;
    error?: string;
  }) => void | Promise<void>;
}

export class BoundedSubSessionBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundedSubSessionBudgetError';
  }
}

export class BoundedSubSessionRunner {
  constructor(private readonly options: BoundedSubSessionRunnerOptions) {}

  async runAll(requests: BoundedSubSessionRequest[], signal: AbortSignal): Promise<BoundedSubSessionResult[]> {
    if (!this.options.enabled || requests.length === 0) return [];
    if (requests.length > this.options.maxSubSessions) {
      await this.emit({
        type: 'deep_agent.budget.exceeded',
        requestId: 'batch',
        error: 'Bounded sub-session count exceeded'
      });
      throw new BoundedSubSessionBudgetError('Bounded sub-session count exceeded');
    }

    const requestedBudget = requests.reduce((sum, request) => sum + request.tokenBudget, 0);
    if (requestedBudget > this.options.tokenBudget) {
      await this.emit({
        type: 'deep_agent.budget.exceeded',
        requestId: 'batch',
        error: 'Bounded sub-session token budget exceeded'
      });
      throw new BoundedSubSessionBudgetError('Bounded sub-session token budget exceeded');
    }

    const results = await Promise.all(requests.map((request) => this.runOne(request, signal)));
    const tokensUsed = results.reduce((sum, result) => sum + result.tokensUsed, 0);
    if (tokensUsed > this.options.tokenBudget) {
      await this.emit({
        type: 'deep_agent.budget.exceeded',
        requestId: 'batch',
        tokensUsed,
        error: 'Bounded sub-session token usage exceeded'
      });
      throw new BoundedSubSessionBudgetError('Bounded sub-session token usage exceeded');
    }
    return results;
  }

  private async runOne(request: BoundedSubSessionRequest, signal: AbortSignal): Promise<BoundedSubSessionResult> {
    await this.emit({
      type: 'deep_agent.spawn.requested',
      requestId: request.id,
      parentSessionId: request.parentSessionId,
      personaId: request.persona.id
    });
    try {
      if (signal.aborted) throw abortError(signal);
      const normalizedRequest = this.validateAndNormalizeRequest(request);
      await this.emit({
        type: 'deep_agent.spawn.started',
        requestId: request.id,
        parentSessionId: normalizedRequest.parentSessionId,
        personaId: normalizedRequest.persona.id
      });
      const result = await this.options.run(normalizedRequest, signal);
      if (result.tokensUsed > normalizedRequest.tokenBudget) {
        throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} exceeded its token budget`);
      }
      const normalizedResult: BoundedSubSessionResult = {
        id: normalizedRequest.id,
        parentSessionId: normalizedRequest.parentSessionId,
        personaId: normalizedRequest.persona.id,
        summary: result.summary,
        citations: [...result.citations],
        tokensUsed: result.tokensUsed,
        status: result.status ?? 'completed',
        error: result.error
      };
      await this.emit({
        type: 'deep_agent.spawn.completed',
        requestId: request.id,
        parentSessionId: normalizedResult.parentSessionId,
        personaId: normalizedResult.personaId,
        tokensUsed: normalizedResult.tokensUsed
      });
      return normalizedResult;
    } catch (error) {
      const type = signal.aborted ? 'deep_agent.spawn.aborted' : 'deep_agent.spawn.failed';
      await this.emit({
        type,
        requestId: request.id,
        parentSessionId: request.parentSessionId,
        personaId: request.persona?.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private validateAndNormalizeRequest(request: BoundedSubSessionRequest): BoundedSubSessionRequest {
    if (request.objective.trim().length === 0) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires an objective`);
    }
    if (!request.parentSessionId?.trim()) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires a parent session id`);
    }
    if (request.boundaries.length === 0) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires explicit boundaries`);
    }
    if (request.tokenBudget <= 0) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires a positive token budget`);
    }
    if (request.depth < 0 || request.depth > (this.options.maxDepth ?? 1)) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} exceeded max depth`);
    }
    if (!request.persona?.id || !request.persona.systemPrefix.trim()) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires a persona`);
    }
    const allowedToolScope = this.options.allowedToolScope;
    const toolScope = allowedToolScope?.length
      ? request.toolScope.filter((tool) => allowedToolScope.includes(tool))
      : [...request.toolScope];
    if (toolScope.length === 0) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires allowed tool scope`);
    }
    return {
      ...request,
      toolScope
    };
  }

  private async emit(event: Parameters<NonNullable<BoundedSubSessionRunnerOptions['onEvent']>>[0]): Promise<void> {
    await this.options.onEvent?.(event);
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'aborted'));
}
