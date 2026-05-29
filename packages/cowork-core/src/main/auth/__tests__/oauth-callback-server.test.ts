import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthCallbackServer } from '../oauth-callback-server';

describe('OAuthCallbackServer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts on an ephemeral loopback port and resolves a valid callback', async () => {
    const server = new OAuthCallbackServer();
    const { redirectUri, promise } = await server.start('state-1');

    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth_callback$/);
    const res = await fetch(`${redirectUri}?code=code-1&state=state-1`);

    expect(res.status).toBe(200);
    await expect(promise).resolves.toEqual({ code: 'code-1', state: 'state-1' });
  });

  it('can use the registered Codex callback path and redirect host', async () => {
    const server = new OAuthCallbackServer();
    const { redirectUri, promise } = await server.start('state-1', 5 * 60_000, {
      port: 0,
      path: '/auth/callback',
      redirectHost: 'localhost',
    });

    expect(redirectUri).toMatch(/^http:\/\/localhost:\d+\/auth\/callback$/);
    const res = await fetch(`${redirectUri}?code=code-1&state=state-1`);

    expect(res.status).toBe(200);
    await expect(promise).resolves.toEqual({ code: 'code-1', state: 'state-1' });
  });

  it('rejects state mismatches', async () => {
    const server = new OAuthCallbackServer();
    const { redirectUri, promise } = await server.start('expected-state');

    const rejected = expect(promise).rejects.toThrow('CSRF state mismatch');
    const res = await fetch(`${redirectUri}?code=code-1&state=wrong-state`);

    expect(res.status).toBe(400);
    await rejected;
  });

  it('rejects when the flow times out', async () => {
    const server = new OAuthCallbackServer();
    const { promise } = await server.start('state-1', 10);

    const rejected = expect(promise).rejects.toThrow('OAuth flow timed out');
    await rejected;
  });

  it('allows only one flow at a time', async () => {
    const server = new OAuthCallbackServer();
    await server.start('state-1');

    await expect(server.start('state-2')).rejects.toThrow(
      'Another OAuth flow is already in progress'
    );
    server.stop();
  });
});
