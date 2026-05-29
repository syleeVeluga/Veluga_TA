import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  generatePKCE,
  refreshToken,
} from '../oauth-providers/chatgpt-codex';

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.');
}

describe('chatgpt-codex oauth provider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('generates PKCE verifier and challenge values', () => {
    const pkce = generatePKCE();

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).not.toBe(pkce.verifier);
  });

  it('builds the OpenAI authorize URL with PKCE parameters', () => {
    const url = new URL(
      buildAuthorizeUrl({
        redirectUri: 'http://localhost:1455/auth/callback',
        state: 'state-1',
        challenge: 'challenge-1',
      })
    );

    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('scope')).not.toContain('api.connectors');
    expect(url.searchParams.get('originator')).toBe('codex_cli_rs');
  });

  it('exchanges an authorization code for credentials', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const accessToken = jwt({
      ['https://api.openai.' + 'com/auth']: { chatgpt_account_id: 'acct_123' },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: accessToken,
        refresh_token: 'refresh-1',
        expires_in: 3600,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const creds = await exchangeCodeForToken({
      code: 'code-1',
      redirectUri: 'http://127.0.0.1:1234/oauth_callback',
      verifier: 'verifier-1',
    });
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;

    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(creds).toMatchObject({
      accessToken,
      refreshToken: 'refresh-1',
      expiresAt: 3_601_000,
      accountId: 'acct_123',
    });
  });

  it('refreshes credentials and preserves the previous refresh token when absent', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-2',
          expires_in: 60,
        }),
      })
    );

    await expect(
      refreshToken({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 1_000,
        accountId: 'acct_123',
      })
    ).resolves.toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-1',
      expiresAt: 62_000,
      accountId: 'acct_123',
    });
  });
});
