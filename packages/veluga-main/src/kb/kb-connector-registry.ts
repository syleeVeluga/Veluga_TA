import type { KbAdapterOptions } from './kb-mcp-adapter.js';
import { KbMcpAdapter } from './kb-mcp-adapter.js';

/**
 * A KB connector plugin encapsulates a specific KB backend.
 * Register one before Veluga starts; leave none (or all disabled) to run without KB.
 */
export interface KbConnectorPlugin {
  readonly id: string;
  readonly enabled: boolean;
  createAdapter(opts?: Pick<KbAdapterOptions, 'audit' | 'sessionId' | 'timeoutMs'>): KbMcpAdapter;
}

/**
 * Holds registered KB connector plugins. The first enabled plugin wins.
 * isEnabled() === false means no KB is wired for this deployment — not a temporary outage.
 */
export class KbConnectorRegistry {
  private readonly plugins = new Map<string, KbConnectorPlugin>();

  register(plugin: KbConnectorPlugin): this {
    this.plugins.set(plugin.id, plugin);
    return this;
  }

  unregister(id: string): this {
    this.plugins.delete(id);
    return this;
  }

  setEnabled(id: string, enabled: boolean): this {
    const existing = this.plugins.get(id);
    if (existing) {
      this.plugins.set(id, { ...existing, enabled });
    }
    return this;
  }

  /** Returns the first enabled plugin, or null if none are configured/enabled. */
  getActive(): KbConnectorPlugin | null {
    for (const plugin of this.plugins.values()) {
      if (plugin.enabled) return plugin;
    }
    return null;
  }

  isEnabled(): boolean {
    return this.getActive() !== null;
  }

  /**
   * Creates an adapter from the active plugin, or returns null when no KB is configured.
   * Callers must handle null — it means KB is intentionally absent, not temporarily down.
   */
  createAdapter(opts?: Pick<KbAdapterOptions, 'audit' | 'sessionId' | 'timeoutMs'>): KbMcpAdapter | null {
    const active = this.getActive();
    return active ? active.createAdapter(opts) : null;
  }
}

/**
 * Plugin for a standard MCP-over-HTTP KB endpoint.
 * Pass the base URL (or set VELUGA_KB_MCP_URL env var) and enable it when your KB is ready.
 */
export class HttpKbConnectorPlugin implements KbConnectorPlugin {
  constructor(
    readonly id: string,
    private readonly url: string,
    readonly enabled: boolean = true
  ) {}

  createAdapter(opts?: Pick<KbAdapterOptions, 'audit' | 'sessionId' | 'timeoutMs'>): KbMcpAdapter {
    return new KbMcpAdapter({ url: this.url, ...opts });
  }
}

/**
 * Null-object plugin. Always disabled.
 * Use as the default registry entry before any real KB is wired — makes the "no KB" state explicit.
 */
export const NullKbConnector: KbConnectorPlugin = {
  id: 'null',
  enabled: false,
  createAdapter: () => new KbMcpAdapter()
};
