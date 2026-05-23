import type { AuditLogger } from '../audit-logger.js';
import type {
  KbHybridInput,
  KbHybridOutput,
  KbMetadataInput,
  KbMetadataOutput,
  KbSearchInput,
  KbSearchOutput,
  PolicyContext
} from '../../../shared-types/src/index.js';
import {
  normalizeKbHybridInput,
  normalizeKbMetadataInput,
  normalizeKbSearchInput,
  parseKbHybridOutput,
  parseKbMetadataOutput,
  parseKbSearchOutput
} from './kb-contract.js';
import { redactOverClassifiedChunks } from './kb-redactor.js';

export type KbToolName = 'kb_search' | 'kb_metadata' | 'kb_hybrid';

export interface KbMcpClient {
  listTools(): Promise<string[]>;
  callTool(name: KbToolName, input: unknown): Promise<unknown>;
}

export interface KbAdapterOptions {
  client?: KbMcpClient;
  url?: string;
  timeoutMs?: number;
  audit?: AuditLogger;
  sessionId?: string;
}

export class KbUnavailableError extends Error {
  constructor(message = 'KB service is temporarily unavailable') {
    super(message);
    this.name = 'KbUnavailableError';
  }
}

export class KbMcpAdapter {
  private available = false;
  private tools = new Set<string>();
  private readonly client: KbMcpClient | null;
  private readonly timeoutMs: number;

  constructor(private readonly options: KbAdapterOptions = {}) {
    this.client = options.client ?? (options.url || process.env.VELUGA_KB_MCP_URL ? new HttpKbClient(options.url ?? process.env.VELUGA_KB_MCP_URL!) : null);
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  isAvailable(): boolean {
    return this.available && this.hasRequiredTools();
  }

  get listedTools(): string[] {
    return [...this.tools].sort();
  }

  async healthCheck(policy?: PolicyContext): Promise<boolean> {
    if (!this.client) {
      this.markUnavailable(policy, 'not_configured');
      return false;
    }
    try {
      this.tools = new Set(await this.withTimeout(this.client.listTools()));
      this.available = this.hasRequiredTools();
      if (!this.available) this.markUnavailable(policy, 'missing_required_tools');
      return this.available;
    } catch (error) {
      this.markUnavailable(policy, error instanceof Error ? error.message : 'health_check_failed');
      return false;
    }
  }

  async search(input: KbSearchInput, policy: PolicyContext): Promise<KbSearchOutput> {
    this.ensureAvailable(policy);
    const normalized = normalizeKbSearchInput(input, policy);
    const parsed = parseKbSearchOutput(await this.call('kb_search', normalized));
    const redacted = redactOverClassifiedChunks(parsed, policy, this.auditOptions()).output;
    this.auditQuery(policy, 'kb_search', normalized.scopes, redacted.chunks.length);
    return redacted;
  }

  async metadata(input: KbMetadataInput, policy: PolicyContext): Promise<KbMetadataOutput> {
    this.ensureAvailable(policy);
    const normalized = normalizeKbMetadataInput(input, policy);
    const parsed = parseKbMetadataOutput(await this.call('kb_metadata', normalized));
    this.auditQuery(policy, 'kb_metadata', normalized.scopes, parsed.docs.length);
    return parsed;
  }

  async hybrid(input: KbHybridInput, policy: PolicyContext): Promise<KbHybridOutput> {
    this.ensureAvailable(policy);
    const normalized = normalizeKbHybridInput(input, policy);
    const parsed = parseKbHybridOutput(await this.call('kb_hybrid', normalized));
    const redacted = redactOverClassifiedChunks(parsed, policy, this.auditOptions()).output;
    this.auditQuery(policy, 'kb_hybrid', normalized.scopes, redacted.mixed.length, parsed.routing_explain);
    return redacted;
  }

  private async call(tool: KbToolName, input: unknown): Promise<unknown> {
    if (!this.client) throw new KbUnavailableError();
    try {
      return await this.withTimeout(this.client.callTool(tool, input));
    } catch (error) {
      this.available = false;
      throw error instanceof Error ? error : new KbUnavailableError();
    }
  }

  private ensureAvailable(policy: PolicyContext): void {
    if (!this.isAvailable()) {
      this.markUnavailable(policy, 'unavailable');
      throw new KbUnavailableError();
    }
  }

  private hasRequiredTools(): boolean {
    return ['kb_search', 'kb_metadata', 'kb_hybrid'].every((tool) => this.tools.has(tool));
  }

  private markUnavailable(policy: PolicyContext | undefined, reason: string): void {
    this.available = false;
    if (!policy) return;
    this.options.audit?.append({
      session_id: this.options.sessionId ?? 'kb-adapter',
      user_id: policy.user.user_id,
      event_type: 'kb.unavailable',
      payload: { reason },
      policy_version_id: policy.policy_version_id
    });
  }

  private auditQuery(policy: PolicyContext, tool: KbToolName, scopes: string[], resultCount: number, routingExplain?: string): void {
    this.options.audit?.append({
      session_id: this.options.sessionId ?? 'kb-adapter',
      user_id: policy.user.user_id,
      event_type: 'kb.queried',
      payload: { tool, scopes, result_count: resultCount, routing_explain: routingExplain },
      policy_version_id: policy.policy_version_id
    });
  }

  private auditOptions(): { audit?: AuditLogger; sessionId?: string } {
    return { audit: this.options.audit, sessionId: this.options.sessionId };
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new KbUnavailableError('KB service timed out')), this.timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

class HttpKbClient implements KbMcpClient {
  constructor(private readonly baseUrl: string) {}

  async listTools(): Promise<string[]> {
    const response = await fetch(new URL('/tools', this.baseUrl));
    if (!response.ok) throw new KbUnavailableError(`KB tool listing failed: ${response.status}`);
    const body = (await response.json()) as { tools?: string[] };
    return body.tools ?? [];
  }

  async callTool(name: KbToolName, input: unknown): Promise<unknown> {
    const response = await fetch(new URL(`/tools/${name}`, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new KbUnavailableError(`KB tool call failed: ${response.status}`);
    return response.json();
  }
}
