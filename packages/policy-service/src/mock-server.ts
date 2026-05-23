import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PolicyContextStore, type PolicyContext, type PolicyContextSnapshot } from '../../shared-types/src/index.js';
import { mergePolicies, type Identity, type MergePolicyInput } from './merge.js';
import { parsePolicyFile } from './simple-yaml.js';

export interface MockPolicyServiceOptions {
  policyDir: string;
  identity: Identity;
  session?: MergePolicyInput['session'];
  projectId?: string;
  simulateOutage?: boolean;
}

export class MockPolicyService {
  private cache: PolicyContextSnapshot | null = null;
  private store: PolicyContextStore | null = null;
  private watcher: FSWatcher | null = null;

  constructor(private readonly options: MockPolicyServiceOptions) {}

  async fetchAll(): Promise<PolicyContext> {
    if (this.options.simulateOutage) {
      if (!this.cache) {
        throw new Error('PolicyService outage and no cached PolicyContext is available');
      }
      const stale = { ...this.cache, stale: true };
      this.store = this.store ?? new PolicyContextStore(stale);
      return this.store.update(stale);
    }

    const snapshot = await this.loadSnapshot();
    this.cache = snapshot;
    this.store = this.store ?? new PolicyContextStore(snapshot);
    return this.store.update(snapshot);
  }

  async startWatching(): Promise<() => void> {
    await this.fetchAll();
    this.watcher = watch(this.options.policyDir, async () => {
      try {
        await this.fetchAll();
      } catch {
        if (this.cache && this.store) {
          this.store.update({ ...this.cache, stale: true });
        }
      }
    });
    return () => this.watcher?.close();
  }

  private async loadSnapshot(): Promise<PolicyContextSnapshot> {
    const [institution, org, project, user] = await Promise.all([
      this.readPolicy('institution.yaml'),
      this.readPolicy('org.yaml'),
      this.readPolicy('project.yaml'),
      this.readPolicy('user.yaml')
    ]);

    return mergePolicies({
      identity: this.options.identity,
      institution,
      org,
      project,
      user,
      session: this.options.session
    });
  }

  private async readPolicy(fileName: string): Promise<Record<string, unknown>> {
    try {
      const text = await readFile(path.join(this.options.policyDir, fileName), 'utf8');
      return parsePolicyFile(text);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }
}
