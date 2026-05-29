import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shell } from 'electron';
import type { ProviderProfile } from '../../config/config-store';

const OPENAI_BASE_URL = 'https://api.openai.' + 'com/v1';

const mocks = vi.hoisted(() => {
  const profiles: Partial<Record<string, ProviderProfile>> = {};
  let activeConfigSetId = 'default';
  return {
    profiles,
    get activeConfigSetId() {
      return activeConfigSetId;
    },
    set activeConfigSetId(value: string) {
      activeConfigSetId = value;
    },
    configStore: {
      getAll: vi.fn(() => ({ activeConfigSetId })),
      getProfile: vi.fn((profileId: string) => profiles[profileId] || null),
      updateProfile: vi.fn(async (profileId: string, updates: Partial<ProviderProfile>) => {
        profiles[profileId] = {
          ...profiles[profileId],
          ...updates,
        } as ProviderProfile;
      }),
    },
  };
});

vi.mock('../../config/config-store', () => ({
  configStore: mocks.configStore,
}));

describe('OAuthManager', () => {
  beforeEach(() => {
    mocks.activeConfigSetId = 'default';
    mocks.profiles.openai = {
      authMethod: 'apikey',
      apiKey: '',
      baseUrl: OPENAI_BASE_URL,
      model: 'gpt-5.3-codex',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    mocks.configStore.getAll.mockClear();
    mocks.configStore.getProfile.mockClear();
    mocks.configStore.updateProfile.mockClear();
    for (const key of Object.keys(mocks.profiles)) {
      delete mocks.profiles[key];
    }
  });

  it('runs the browser callback flow and stores OAuth credentials', async () => {
    vi.spyOn(shell, 'openExternal').mockResolvedValue(undefined);
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('https://auth.openai.com')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              access_token: 'access-token',
              refresh_token: 'refresh-token',
              expires_in: 3600,
            }),
          } as Response);
        }
        return realFetch(input, init);
      })
    );

    const { OAuthManager } = await import('../oauth-manager');
    const manager = new OAuthManager();
    const { flowId } = await manager.startFlow({ provider: 'openai-codex', profileId: 'openai' });
    const authUrl = new URL(vi.mocked(shell.openExternal).mock.calls[0][0]);
    const redirectUri = authUrl.searchParams.get('redirect_uri');
    const state = authUrl.searchParams.get('state');

    expect(flowId).toBeTruthy();
    expect(redirectUri).toMatch(/^http:\/\/localhost:145[57]\/auth\/callback$/);
    expect(authUrl.searchParams.get('originator')).toBe('codex_cli_rs');
    expect(state).toBeTruthy();
    await fetch(`${redirectUri}?code=code-1&state=${state}`);
    await vi.waitFor(() => {
      expect(mocks.configStore.updateProfile).toHaveBeenCalledWith(
        'openai',
        expect.objectContaining({
          authMethod: 'oauth',
          oauthCredentials: expect.objectContaining({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            tokenType: 'Bearer',
          }),
        }),
        'default'
      );
    });
  });

  it('stores callback credentials on the config set that started the flow', async () => {
    const { shell: testShell } = await import('electron');
    vi.spyOn(testShell, 'openExternal').mockResolvedValue(undefined);
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('https://auth.openai.com')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              access_token: 'access-token',
              refresh_token: 'refresh-token',
              expires_in: 3600,
            }),
          } as Response);
        }
        return realFetch(input, init);
      })
    );

    mocks.activeConfigSetId = 'set-started';
    const { OAuthManager } = await import('../oauth-manager');
    const manager = new OAuthManager();
    await manager.startFlow({ provider: 'openai-codex', profileId: 'openai' });
    const authUrl = new URL(vi.mocked(testShell.openExternal).mock.calls[0][0]);
    const redirectUri = authUrl.searchParams.get('redirect_uri');
    const state = authUrl.searchParams.get('state');
    mocks.activeConfigSetId = 'set-current';

    await fetch(`${redirectUri}?code=code-1&state=${state}`);

    await vi.waitFor(() => {
      expect(mocks.configStore.updateProfile).toHaveBeenCalledWith(
        'openai',
        expect.objectContaining({ authMethod: 'oauth' }),
        'set-started'
      );
    });
  });

  it('cleans up the pending flow when opening the browser fails', async () => {
    const { shell: testShell } = await import('electron');
    const openExternal = vi
      .spyOn(testShell, 'openExternal')
      .mockRejectedValueOnce(new Error('browser unavailable'))
      .mockResolvedValueOnce(undefined);

    const { OAuthManager } = await import('../oauth-manager');
    const manager = new OAuthManager();

    await expect(
      manager.startFlow({ provider: 'openai-codex', profileId: 'openai' })
    ).rejects.toThrow('browser unavailable');
    await expect(
      manager.startFlow({ provider: 'openai-codex', profileId: 'openai' })
    ).resolves.toEqual({ flowId: expect.any(String) });

    expect(openExternal).toHaveBeenCalledTimes(2);
    manager.cancel();
  });

  it('does not refresh credentials before the expiry buffer', async () => {
    mocks.profiles.openai = {
      authMethod: 'oauth',
      apiKey: '',
      baseUrl: OPENAI_BASE_URL,
      model: 'gpt-5.3-codex',
      oauthCredentials: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 120_000,
        tokenType: 'Bearer',
        obtainedAt: Date.now(),
      },
    };

    const { OAuthManager } = await import('../oauth-manager');
    await new OAuthManager().refreshIfExpired('openai');

    expect(mocks.configStore.updateProfile).not.toHaveBeenCalled();
  });

  it('uses a per-profile mutex for concurrent refreshes', async () => {
    mocks.profiles.openai = {
      authMethod: 'oauth',
      apiKey: '',
      baseUrl: OPENAI_BASE_URL,
      model: 'gpt-5.3-codex',
      oauthCredentials: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1,
        tokenType: 'Bearer',
        obtainedAt: Date.now(),
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 3600,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { OAuthManager } = await import('../oauth-manager');
    const manager = new OAuthManager();
    await Promise.all([manager.refreshIfExpired('openai'), manager.refreshIfExpired('openai')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.configStore.updateProfile).toHaveBeenCalledTimes(1);
    expect(mocks.profiles.openai?.oauthCredentials?.accessToken).toBe('fresh-access-token');
  });

  it('signs out by clearing OAuth credentials and returning to API key auth', async () => {
    const { OAuthManager } = await import('../oauth-manager');
    await new OAuthManager().signOut('openai');

    expect(mocks.configStore.updateProfile).toHaveBeenCalledWith('openai', {
      authMethod: 'apikey',
      oauthCredentials: undefined,
    });
  });
});
