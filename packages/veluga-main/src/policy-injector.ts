import type { PolicyContext } from '../../shared-types/src/index.js';
import type { MockPolicyService } from '../../policy-service/src/mock-server.js';

export class PolicyContextInjector {
  private current: PolicyContext | null = null;

  constructor(private readonly service: MockPolicyService) {}

  async initialize(): Promise<PolicyContext> {
    this.current = await this.service.fetchAll();
    return this.current;
  }

  getCurrent(): PolicyContext {
    if (!this.current) {
      throw new Error('PolicyContextInjector.initialize() must run before session start');
    }
    return this.current;
  }
}
