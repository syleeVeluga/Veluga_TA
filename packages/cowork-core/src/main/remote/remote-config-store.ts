/**
 * Remote Config Store
 * Remote control config store.
 */

import Store from 'electron-store';
import { log, logWarn } from '../utils/logger';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';
import type {
  RemoteConfig,
  GatewayConfig,
  DiscordChannelConfig,
  SlackChannelConfig,
  WebSocketChannelConfig,
  PairedUser,
} from './types';
import { DEFAULT_REMOTE_CONFIG } from './types';

class RemoteConfigStore {
  private store: Store<RemoteConfig & { pairedUsers: PairedUser[] }>;

  constructor() {
    // Cast to satisfy the Record<string, unknown> constraint of the encrypted store utility;
    // RemoteConfig & { pairedUsers: PairedUser[] } is structurally compatible at runtime.
    type RemoteConfigRecord = RemoteConfig & { pairedUsers: PairedUser[] } & Record<
        string,
        unknown
      >;
    this.store = createEncryptedStoreWithKeyRotation<RemoteConfigRecord>({
      stableKey: 'open-cowork-remote-stable-v1',
      legacyKeys: [
        'open-cowork-remote-v1',
        ...getLegacyDerivedKeyHexes({
          moduleDirname: __dirname,
          stableSeed: 'open-cowork-remote-stable-v1',
          legacySeed: 'open-cowork-remote-v1',
          salt: 'open-cowork-remote-salt',
        }),
      ],
      storeOptions: {
        name: 'remote-config',
        projectName: 'open-cowork',
        defaults: {
          ...DEFAULT_REMOTE_CONFIG,
          pairedUsers: [],
        },
      },
      logPrefix: '[RemoteConfigStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<RemoteConfig & { pairedUsers: PairedUser[] }>;

    // Migrate: change pairing mode to allowlist, preserving existing paired users.
    this.migrateAuthMode();
  }

  /**
   * Migrate old pairing mode to allowlist, preserving existing paired users.
   */
  private migrateAuthMode(): void {
    const gateway = this.store.get('gateway');
    if (gateway?.auth?.mode === 'pairing') {
      // Carry over already-paired user IDs so they are not locked out.
      // Use channelType:userId format to preserve channel scoping.
      const pairedUsers = this.store.get('pairedUsers', []);
      const allowlist = pairedUsers.map((u: PairedUser) => `${u.channelType}:${u.userId}`);

      log(
        '[RemoteConfig] Migrating auth mode from pairing to allowlist, preserving',
        allowlist.length,
        'users'
      );
      this.store.set('gateway.auth', {
        mode: 'allowlist',
        allowlist,
        requirePairing: false,
      });
    }
  }

  /**
   * Get all remote config.
   */
  getAll(): RemoteConfig {
    return {
      gateway: this.store.get('gateway'),
      channels: this.store.get('channels'),
    };
  }

  /**
   * Get gateway config.
   */
  getGatewayConfig(): GatewayConfig {
    return this.store.get('gateway');
  }

  /**
   * Filter prototype pollution keys from user-controlled objects.
   */
  private filterProtoPollution(obj: Record<string, unknown>): Record<string, unknown> {
    const filtered = { ...obj };
    delete filtered['__proto__'];
    delete filtered['constructor'];
    delete filtered['prototype'];
    return filtered;
  }

  /**
   * Update gateway config.
   */
  setGatewayConfig(config: Partial<GatewayConfig>): void {
    const current = this.getGatewayConfig();
    this.store.set('gateway', {
      ...current,
      ...this.filterProtoPollution(config as Record<string, unknown>),
    });
    log('[RemoteConfig] Gateway config updated');
  }

  getDiscordConfig(): DiscordChannelConfig | undefined {
    return this.store.get('channels.discord');
  }

  setDiscordConfig(config: DiscordChannelConfig): void {
    this.store.set('channels.discord', config);
    log('[RemoteConfig] Discord config updated');
  }

  getSlackConfig(): SlackChannelConfig | undefined {
    return this.store.get('channels.slack');
  }

  setSlackConfig(config: SlackChannelConfig): void {
    this.store.set('channels.slack', config);
    log('[RemoteConfig] Slack config updated');
  }

  getWebSocketConfig(): WebSocketChannelConfig | undefined {
    return this.store.get('channels.websocket');
  }

  setWebSocketConfig(config: WebSocketChannelConfig): void {
    this.store.set('channels.websocket', config);
    log('[RemoteConfig] WebSocket config updated');
  }

  isEnabled(): boolean {
    return this.store.get('gateway.enabled', false);
  }

  setEnabled(enabled: boolean): void {
    this.store.set('gateway.enabled', enabled);
    log('[RemoteConfig] Remote enabled:', enabled);
  }

  getPairedUsers(): PairedUser[] {
    return this.store.get('pairedUsers', []);
  }

  addPairedUser(user: PairedUser): void {
    const users = this.getPairedUsers();
    const existingIndex = users.findIndex(
      (u) => u.channelType === user.channelType && u.userId === user.userId
    );

    if (existingIndex >= 0) {
      users[existingIndex] = user;
    } else {
      users.push(user);
    }

    this.store.set('pairedUsers', users);
    this.syncAllowlist(users);
    log('[RemoteConfig] Paired user added:', user.userId);
  }

  removePairedUser(channelType: string, userId: string): boolean {
    const users = this.getPairedUsers();
    const newUsers = users.filter((u) => !(u.channelType === channelType && u.userId === userId));

    if (newUsers.length !== users.length) {
      this.store.set('pairedUsers', newUsers);
      this.syncAllowlist(newUsers);
      log('[RemoteConfig] Paired user removed:', userId);
      return true;
    }

    return false;
  }

  /**
   * Sync allowlist from paired users when auth mode is allowlist.
   */
  private syncAllowlist(users: PairedUser[]): void {
    const gateway = this.store.get('gateway');
    if (gateway?.auth?.mode === 'allowlist') {
      this.store.set(
        'gateway.auth.allowlist',
        users.map((u) => `${u.channelType}:${u.userId}`)
      );
    }
  }

  isPaired(channelType: string, userId: string): boolean {
    const users = this.getPairedUsers();
    return users.some((u) => u.channelType === channelType && u.userId === userId);
  }

  getPath(): string {
    return this.store.path;
  }

  reset(): void {
    this.store.clear();
    log('[RemoteConfig] Config reset');
  }
}

// Singleton instance
export const remoteConfigStore = new RemoteConfigStore();
