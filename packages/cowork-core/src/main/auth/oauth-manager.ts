import { BrowserWindow, shell } from 'electron';
import crypto from 'node:crypto';
import type { ConfigSetId, ProviderProfileKey } from '../config/config-store';
import { configStore } from '../config/config-store';
import { log, logError } from '../utils/logger';
import { OAuthCallbackServer } from './oauth-callback-server';
import * as chatgptCodex from './oauth-providers/chatgpt-codex';
import { recordAuthMetric } from './auth-metrics';

/** Map a flow error message to a fixed, non-sensitive metric reason. */
function classifyOAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('timed out')) return 'timeout';
  if (m.includes('state')) return 'state_mismatch';
  if (m.includes('token exchange')) return 'token_exchange_fail';
  if (m.includes('cancel')) return 'cancelled';
  return 'other';
}

export type SupportedOAuthProvider = 'openai-codex';

interface FlowState {
  flowId: string;
  provider: SupportedOAuthProvider;
  profileId: ProviderProfileKey;
  configSetId: ConfigSetId;
  state: string;
  verifier: string;
}

export interface OAuthProgressEvent {
  flowId: string;
  status: 'started' | 'success' | 'error' | 'cancelled';
  message?: string;
}

export class OAuthManager {
  private currentFlow?: FlowState;
  private callbackServer = new OAuthCallbackServer();
  private refreshLocks = new Map<string, Promise<void>>();

  async startFlow(args: {
    provider: SupportedOAuthProvider;
    profileId: ProviderProfileKey;
  }): Promise<{ flowId: string }> {
    if (args.provider !== 'openai-codex') {
      throw new Error(`Unsupported OAuth provider: ${args.provider}`);
    }
    if (args.profileId !== 'openai') {
      throw new Error('ChatGPT Plus OAuth is only supported for the OpenAI profile');
    }
    if (this.currentFlow) {
      throw new Error('Another OAuth flow is already in progress');
    }

    const flowId = crypto.randomUUID();
    const state = crypto.randomUUID();
    const { verifier, challenge } = chatgptCodex.generatePKCE();
    const { redirectUri, promise } = await this.callbackServer.start(state);
    const configSetId = configStore.getAll().activeConfigSetId;

    this.currentFlow = {
      flowId,
      provider: args.provider,
      profileId: args.profileId,
      configSetId,
      state,
      verifier,
    };
    const authUrl = chatgptCodex.buildAuthorizeUrl({ redirectUri, state, challenge });
    recordAuthMetric('auth.oauth.flow.start');
    try {
      await shell.openExternal(authUrl);
    } catch (err) {
      this.callbackServer.stop();
      if (this.currentFlow?.flowId === flowId) {
        this.currentFlow = undefined;
      }
      throw err;
    }
    this.emitProgress({ flowId, status: 'started' });

    promise
      .then(async ({ code }) => {
        const creds = await chatgptCodex.exchangeCodeForToken({ code, redirectUri, verifier });
        await configStore.updateProfile(
          args.profileId,
          {
            authMethod: 'oauth',
            apiKey: '',
            oauthCredentials: {
              accessToken: creds.accessToken,
              refreshToken: creds.refreshToken,
              expiresAt: creds.expiresAt,
              tokenType: 'Bearer',
              accountId: creds.accountId,
              obtainedAt: Date.now(),
            },
          },
          configSetId
        );
        recordAuthMetric('auth.oauth.flow.success');
        this.emitProgress({ flowId, status: 'success' });
        log('[OAuth] flow completed', { flowId, provider: args.provider });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        recordAuthMetric('auth.oauth.flow.error', classifyOAuthError(message));
        this.emitProgress({ flowId, status: 'error', message });
        logError('[OAuth] flow failed', { flowId, error: message });
      })
      .finally(() => {
        if (this.currentFlow?.flowId === flowId) {
          this.currentFlow = undefined;
        }
      });

    return { flowId };
  }

  cancel(): void {
    const flow = this.currentFlow;
    this.callbackServer.stop();
    if (flow) {
      recordAuthMetric('auth.oauth.flow.error', 'cancelled');
      this.emitProgress({ flowId: flow.flowId, status: 'cancelled' });
      this.currentFlow = undefined;
    }
  }

  async refreshIfExpired(profileId: ProviderProfileKey): Promise<void> {
    const profile = configStore.getProfile(profileId);
    if (!profile || profile.authMethod !== 'oauth' || !profile.oauthCredentials) {
      return;
    }
    if (profile.oauthCredentials.expiresAt - Date.now() > 60_000) {
      return;
    }

    const existingLock = this.refreshLocks.get(profileId);
    if (existingLock) {
      await existingLock;
      return;
    }

    const lock = (async () => {
      try {
        const fresh = await chatgptCodex.refreshToken({
          accessToken: profile.oauthCredentials!.accessToken,
          refreshToken: profile.oauthCredentials!.refreshToken,
          expiresAt: profile.oauthCredentials!.expiresAt,
          accountId: profile.oauthCredentials!.accountId,
        });
        await configStore.updateProfile(profileId, {
          oauthCredentials: {
            accessToken: fresh.accessToken,
            refreshToken: fresh.refreshToken,
            expiresAt: fresh.expiresAt,
            tokenType: 'Bearer',
            accountId: fresh.accountId,
            obtainedAt: Date.now(),
          },
        });
        recordAuthMetric('auth.oauth.refresh.success');
        log('[OAuth] token refreshed', { profileId });
      } catch (err) {
        recordAuthMetric('auth.oauth.refresh.fail');
        throw err;
      } finally {
        this.refreshLocks.delete(profileId);
      }
    })();

    this.refreshLocks.set(profileId, lock);
    await lock;
  }

  async signOut(profileId: ProviderProfileKey): Promise<void> {
    await configStore.updateProfile(profileId, {
      authMethod: 'apikey',
      oauthCredentials: undefined,
    });
  }

  private emitProgress(payload: OAuthProgressEvent): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('auth.progress', payload);
    });
  }
}

export const oauthManager = new OAuthManager();
