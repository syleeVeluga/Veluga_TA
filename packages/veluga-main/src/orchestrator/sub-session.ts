import type { BoundedSubSessionRequest, BoundedSubSessionResult } from '../../../shared-types/src/index.js';

export type RunBoundedSubSession = (
  request: BoundedSubSessionRequest,
  signal: AbortSignal
) => Promise<BoundedSubSessionResult>;

export interface BoundedSubSessionRunnerOptions {
  enabled: boolean;
  maxSubSessions: number;
  tokenBudget: number;
  run: RunBoundedSubSession;
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
      throw new BoundedSubSessionBudgetError('Bounded sub-session count exceeded');
    }

    const requestedBudget = requests.reduce((sum, request) => sum + request.tokenBudget, 0);
    if (requestedBudget > this.options.tokenBudget) {
      throw new BoundedSubSessionBudgetError('Bounded sub-session token budget exceeded');
    }

    const results = await Promise.all(requests.map((request) => this.runOne(request, signal)));
    const tokensUsed = results.reduce((sum, result) => sum + result.tokensUsed, 0);
    if (tokensUsed > this.options.tokenBudget) {
      throw new BoundedSubSessionBudgetError('Bounded sub-session token usage exceeded');
    }
    return results;
  }

  private async runOne(request: BoundedSubSessionRequest, signal: AbortSignal): Promise<BoundedSubSessionResult> {
    if (signal.aborted) throw abortError(signal);
    if (request.objective.trim().length === 0) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires an objective`);
    }
    if (request.boundaries.length === 0) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires explicit boundaries`);
    }
    if (request.tokenBudget <= 0) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} requires a positive token budget`);
    }

    const result = await this.options.run(request, signal);
    if (result.tokensUsed > request.tokenBudget) {
      throw new BoundedSubSessionBudgetError(`Sub-session ${request.id} exceeded its token budget`);
    }
    return {
      id: request.id,
      summary: result.summary,
      citations: [...result.citations],
      tokensUsed: result.tokensUsed
    };
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'aborted'));
}
