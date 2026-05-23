import { PolicyContextStore, type PolicyContext, type PolicyContextSnapshot } from '../../shared-types/src/index.js';

export interface RpcPolicyClientOptions {
  endpoint: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export class RpcPolicyServiceClient {
  private store: PolicyContextStore | null = null;

  constructor(private readonly options: RpcPolicyClientOptions) {}

  async fetchAll(): Promise<PolicyContext> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(new URL('/policy-context', this.options.endpoint), {
      headers: this.options.token ? { authorization: `Bearer ${this.options.token}` } : undefined
    });
    if (!response.ok) {
      throw new Error(`PolicyService RPC failed: ${response.status}`);
    }
    const snapshot = (await response.json()) as PolicyContextSnapshot;
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
