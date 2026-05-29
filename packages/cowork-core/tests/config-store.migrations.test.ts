import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seed: {} as Record<string, unknown>,
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-migrations.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
        ...mocks.seed,
      };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = {
        ...this.store,
        ...key,
      };
    }

    clear(): void {
      this.store = {};
    }
  }

  return {
    default: MockStore,
  };
});

import { ConfigStore } from '../src/main/config/config-store';

describe('ConfigStore migrations', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('migrates v3 profiles to v4 authMethod defaults without losing data', () => {
    mocks.seed = {
      version: 3,
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      activeConfigSetId: 'default',
      profiles: {
        openai: {
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.2',
        },
        anthropic: {
          apiKey: 'sk-ant',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5',
        },
      },
      configSets: [
        {
          id: 'default',
          name: 'Default Config Set',
          isSystem: true,
          provider: 'openai',
          customProtocol: 'openai',
          activeProfileKey: 'openai',
          profiles: {
            openai: {
              apiKey: 'sk-openai',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-5.2',
            },
            anthropic: {
              apiKey: 'sk-ant',
              baseUrl: 'https://api.anthropic.com',
              model: 'claude-sonnet-4-5',
            },
          },
          enableThinking: false,
          thinkingLevel: 'off',
          updatedAt: '2026-05-29T00:00:00.000Z',
        },
      ],
      enableDevLogs: true,
      theme: 'dark',
      language: 'ko',
      sandboxEnabled: false,
      memoryEnabled: true,
      enableThinking: false,
      thinkingLevel: 'off',
      isConfigured: true,
    };

    const migrated = new ConfigStore().getAll();

    expect(migrated.version).toBe(4);
    expect(migrated.profiles.openai?.authMethod).toBe('apikey');
    expect(migrated.profiles.anthropic?.authMethod).toBe('apikey');
    expect(migrated.configSets[0]?.profiles.openai?.authMethod).toBe('apikey');
    expect(migrated.apiKey).toBe('sk-openai');
    expect(migrated.profiles.openai?.apiKey).toBe('sk-openai');
    expect(migrated.profiles.anthropic?.apiKey).toBe('sk-ant');

    mocks.seed = migrated as unknown as Record<string, unknown>;
    const roundTrip = new ConfigStore().getAll();

    expect(roundTrip).toEqual(migrated);
  });
});
