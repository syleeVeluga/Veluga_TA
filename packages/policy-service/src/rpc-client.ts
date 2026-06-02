import { PolicyContextStore, type PolicyContext, type PolicyContextSnapshot } from '../../shared-types/src/index.js';

export interface RpcPolicyClientOptions {
  endpoint: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function resolveTimeoutMs(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function defaultTimeoutMs(): number {
  return resolveTimeoutMs(Number(process.env.VELUGA_POLICY_TIMEOUT_MS), 10000);
}

function isAbortLike(error: unknown): boolean {
  // Key off the abort/timeout error name only. Matching the message text would
  // misclassify unrelated failures (e.g. "connect ETIMEDOUT") as RPC timeouts.
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export class RpcPolicyServiceClient {
  private store: PolicyContextStore | null = null;

  constructor(private readonly options: RpcPolicyClientOptions) {}

  async fetchAll(): Promise<PolicyContext> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutMs = resolveTimeoutMs(this.options.timeoutMs, defaultTimeoutMs());
    let response: Response;
    try {
      response = await fetchImpl(new URL('/policy-context', this.options.endpoint), {
        headers: this.options.token ? { authorization: `Bearer ${this.options.token}` } : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (isAbortLike(error)) {
        throw new Error(`PolicyService RPC timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
    if (!response.ok) {
      throw new Error(`PolicyService RPC failed: ${response.status}`);
    }
    let snapshot: PolicyContextSnapshot;
    try {
      snapshot = (await response.json()) as PolicyContextSnapshot;
    } catch (error) {
      // A stall during the body read aborts here rather than at the fetch call.
      if (isAbortLike(error)) {
        throw new Error(`PolicyService RPC timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
    this.store = this.store ?? new PolicyContextStore(snapshot);
    return this.store.update(snapshot);
  }

  subscribe(listener: (next: PolicyContext) => void): () => void {
    if (!this.store) {
      throw new Error('RpcPolicyServiceClient.fetchAll() must run before subscribe()');
    }
    return this.store.get().subscribe(listener);
  }
}
