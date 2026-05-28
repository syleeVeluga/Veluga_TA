# Phase 3 — ChatGPT Plus OAuth 구현

> 목표: 사용자가 "ChatGPT Plus 로그인" 한 번으로 OAuth flow 완료, 자동 토큰 갱신과 함께 정상 채팅 동작.
>
> 예상 소요: **2일**
>
> 선행 조건: Phase 1 스파이크 결과 GO, Phase 2 타입/IPC 머지 완료

## 1. 모듈 구조

```
packages/cowork-core/src/main/auth/
├── oauth-manager.ts          ← 흐름 오케스트레이션
├── oauth-callback-server.ts  ← localhost HTTP 콜백
├── oauth-providers/
│   └── chatgpt-codex.ts      ← pi-ai 래퍼 + baseURL/모델 결정
└── __tests__/
    ├── oauth-manager.test.ts
    └── chatgpt-codex.test.ts
```

## 2. `oauth-callback-server.ts`

```typescript
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CallbackResult {
  code: string;
  state: string;
}

export class OAuthCallbackServer {
  private server?: http.Server;
  private pending?: {
    state: string;
    resolve: (r: CallbackResult) => void;
    reject: (e: Error) => void;
    timeout: NodeJS.Timeout;
  };

  /**
   * 콜백 서버를 띄우고 redirectUri를 반환. 한 번에 하나의 flow만 허용.
   */
  async start(state: string, timeoutMs = 5 * 60_000): Promise<{
    redirectUri: string;
    promise: Promise<CallbackResult>;
  }> {
    if (this.pending) throw new Error('Another OAuth flow is already in progress');

    const promise = new Promise<CallbackResult>((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res, resolve, reject));
      this.server.listen(0, '127.0.0.1', () => {
        const port = (this.server!.address() as AddressInfo).port;
        const timeout = setTimeout(() => {
          this.stop();
          reject(new Error('OAuth flow timed out'));
        }, timeoutMs);
        this.pending = { state, resolve, reject, timeout };
        resolve.call({}, { __setup: true, port } as any); // ✗ 잘못된 패턴, 아래 fix 참조
      });
    });

    // 위 코드는 예시이며 실제로는 setup/await을 분리해야 함:
    const port = await this.actuallyListen();
    const redirectUri = `http://127.0.0.1:${port}/oauth_callback`;
    return { redirectUri, promise };
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    resolve: (r: CallbackResult) => void,
    reject: (e: Error) => void,
  ) {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname !== '/oauth_callback') {
      res.writeHead(404); res.end('not found'); return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400); res.end(`OAuth error: ${error}`);
      reject(new Error(`OAuth provider returned error: ${error}`));
      this.stop();
      return;
    }
    if (!code || !state) {
      res.writeHead(400); res.end('missing code/state');
      reject(new Error('Missing code or state'));
      this.stop();
      return;
    }
    if (state !== this.pending?.state) {
      res.writeHead(400); res.end('state mismatch');
      reject(new Error('CSRF state mismatch'));
      this.stop();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h2>로그인 완료</h2><p>이 창은 닫아도 됩니다.</p></body></html>');
    resolve({ code, state });
    this.stop();
  }

  stop() {
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending = undefined;
    }
    this.server?.close();
    this.server = undefined;
  }
}
```

> 의사코드 일부는 정리 필요. 핵심은: (1) port=0으로 임의 포트, (2) 5분 타임아웃, (3) CSRF state 검증, (4) 동시 flow 1개만.

## 3. `oauth-providers/chatgpt-codex.ts`

```typescript
import crypto from 'node:crypto';
// pi-ai 의 OAuth provider import 경로는 Phase 1 스파이크에서 확정
import { OpenAICodexOAuth } from '@mariozechner/pi-ai/dist/utils/oauth/openai-codex.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';  // OpenAI Codex CLI와 동일
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export interface ChatGPTOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
  accountId?: string;
}

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(args: {
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCodeForToken(args: {
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<ChatGPTOAuthCredentials> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
    client_id: CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const json = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    id_token?: string;
    token_type: string;
  };
  const accountId = json.id_token ? extractAccountIdFromJwt(json.id_token) : undefined;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

export async function refreshToken(creds: ChatGPTOAuthCredentials): Promise<ChatGPTOAuthCredentials> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const json = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    ...creds,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? creds.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

function extractAccountIdFromJwt(jwt: string): string | undefined {
  try {
    const [, payloadB64] = jwt.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return payload['https://api.openai.com/auth/account_id'] ?? payload['account_id'];
  } catch { return undefined; }
}
```

> **참고**: 위 코드는 pi-ai의 OAuth provider가 충분치 않을 경우의 fallback. Phase 1 스파이크에서 pi-ai가 `exchangeCodeForToken`/`refreshToken`을 노출한다면 우리는 그것을 thin wrap하면 됨. **중복 구현 회피가 원칙**.

## 4. `oauth-manager.ts`

```typescript
import { shell } from 'electron';
import crypto from 'node:crypto';
import { OAuthCallbackServer } from './oauth-callback-server.js';
import * as chatgptCodex from './oauth-providers/chatgpt-codex.js';
import { configStore } from '../config/config-store.js';
import { logger } from '../utils/logger.js'; // 토큰 마스킹 필수

export type SupportedOAuthProvider = 'openai-codex';

interface FlowState {
  flowId: string;
  provider: SupportedOAuthProvider;
  profileId: string;
  state: string;
  verifier: string;
}

export class OAuthManager {
  private currentFlow?: FlowState;
  private callbackServer = new OAuthCallbackServer();
  private refreshLocks = new Map<string, Promise<void>>(); // per-profile mutex

  async startFlow(args: { provider: SupportedOAuthProvider; profileId: string }): Promise<{
    flowId: string;
  }> {
    if (this.currentFlow) throw new Error('Another OAuth flow is already in progress');
    const flowId = crypto.randomUUID();
    const state = crypto.randomUUID();
    const { verifier, challenge } = chatgptCodex.generatePKCE();

    const { redirectUri, promise } = await this.callbackServer.start(state);
    this.currentFlow = { flowId, provider: args.provider, profileId: args.profileId, state, verifier };

    const authUrl = chatgptCodex.buildAuthorizeUrl({ redirectUri, state, challenge });
    await shell.openExternal(authUrl);

    // 비동기로 완료 처리
    promise
      .then(async ({ code }) => {
        const creds = await chatgptCodex.exchangeCodeForToken({ code, redirectUri, verifier });
        await configStore.updateProfile(args.profileId, {
          authMethod: 'oauth',
          oauthCredentials: {
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            expiresAt: creds.expiresAt,
            tokenType: 'Bearer',
            accountId: creds.accountId,
            obtainedAt: Date.now(),
          },
        });
        this.emitProgress({ flowId, status: 'success' });
        logger.info('oauth flow completed', { flowId, provider: args.provider });
      })
      .catch((err) => {
        this.emitProgress({ flowId, status: 'error', message: err.message });
        logger.error('oauth flow failed', { flowId, error: err.message });
      })
      .finally(() => {
        this.currentFlow = undefined;
      });

    return { flowId };
  }

  cancel(): void {
    this.callbackServer.stop();
    if (this.currentFlow) {
      this.emitProgress({ flowId: this.currentFlow.flowId, status: 'cancelled' });
      this.currentFlow = undefined;
    }
  }

  /**
   * 만료 60초 전이면 갱신. per-profile mutex로 중복 갱신 방지.
   */
  async refreshIfExpired(profileId: string): Promise<void> {
    const profile = configStore.getProfile(profileId);
    if (!profile || profile.authMethod !== 'oauth' || !profile.oauthCredentials) return;
    if (profile.oauthCredentials.expiresAt - Date.now() > 60_000) return;

    if (this.refreshLocks.has(profileId)) {
      await this.refreshLocks.get(profileId);
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
        logger.info('oauth token refreshed', { profileId });
      } finally {
        this.refreshLocks.delete(profileId);
      }
    })();
    this.refreshLocks.set(profileId, lock);
    await lock;
  }

  async signOut(profileId: string): Promise<void> {
    await configStore.updateProfile(profileId, {
      authMethod: 'apikey',  // 사용자가 다시 apikey로 fallback 가능하도록
      oauthCredentials: undefined,
    });
  }

  private emitProgress(payload: any) {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('auth.progress', payload)
    );
  }
}

export const oauthManager = new OAuthManager();
```

## 5. IPC 핸들러 실제 구현

**파일**: `packages/cowork-core/src/main/index.ts` — Phase 2 스텁을 실제 구현으로 교체:

```typescript
ipcMain.handle('auth.startOAuth', async (_e, args) => {
  return await oauthManager.startFlow(args);
});
ipcMain.handle('auth.cancelOAuth', async () => {
  oauthManager.cancel();
});
ipcMain.handle('auth.signOut', async (_e, args) => {
  await oauthManager.signOut(args.profileId);
});
```

## 6. `agent-runner.ts` 통합

**파일**: `packages/cowork-core/src/main/claude/agent-runner.ts:1420-1434` 근처

```typescript
// 기존 (단순화):
authStorage.setRuntimeApiKey(profile.provider, profile.apiKey);

// 신규:
switch (profile.authMethod) {
  case 'apikey':
    if (!profile.apiKey) throw new Error('API key missing');
    authStorage.setRuntimeApiKey(profile.provider, profile.apiKey);
    break;

  case 'oauth':
    await oauthManager.refreshIfExpired(profile.id);
    const refreshed = configStore.getProfile(profile.id);
    if (!refreshed?.oauthCredentials) throw new Error('OAuth credentials lost after refresh');
    // ⚠️ provider 키 — Phase 1 스파이크에서 'openai' 또는 'openai-codex' 중 확정
    authStorage.setRuntimeApiKey(
      OAUTH_PROVIDER_KEY_MAP[profile.provider],
      refreshed.oauthCredentials.accessToken
    );
    // baseURL/모델 카탈로그도 분기 필요 (Phase 1 결과에 따라)
    break;

  case 'cli-delegate':
    // Phase 4에서 별도 코드 경로 (createAgentSession 자체를 사용하지 않음)
    throw new Error('CLI delegate runs through claude-cli-runner, not here');
}
```

## 7. 단위 테스트

`packages/cowork-core/src/main/auth/__tests__/`:

- `oauth-callback-server.test.ts`:
  - port=0 정상 동작
  - state mismatch 시 reject
  - 5분 타임아웃
  - 동시 flow 2개 거부
- `chatgpt-codex.test.ts`:
  - PKCE verifier 길이/형식
  - authorize URL 파라미터 검증
  - token exchange/refresh는 mock fetch
- `oauth-manager.test.ts`:
  - startFlow → callback → 저장까지 e2e (mock server + mock fetch)
  - refreshIfExpired 만료 미만 시 no-op
  - refreshIfExpired 만료 임박 시 새 토큰 저장
  - 동시 호출 시 mutex 동작 (refreshToken 1회만 호출됨)

## 8. 로깅 가드

`utils/logger.ts` (또는 기존 로거)에 redaction 필터:
```typescript
const TOKEN_PATTERNS = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /sk-[A-Za-z0-9]{20,}/g,
  /access_token["\s:=]+["']?[A-Za-z0-9_-]+/gi,
];
function redact(s: string): string {
  return TOKEN_PATTERNS.reduce((acc, p) => acc.replace(p, '***REDACTED***'), s);
}
```

기존 로거에 이미 redaction이 있는지 먼저 확인 — 있다면 패턴만 추가.

## 9. 완료 기준

- [ ] OAuth flow 성공 → 프로필에 credentials 저장 → 채팅 응답 정상
- [ ] 토큰 만료 임박 시 자동 refresh (강제로 expiresAt 과거 설정해서 테스트)
- [ ] Sign out → credentials 완전 제거 + apikey 모드로 복귀
- [ ] state mismatch / 사용자 거부 / 타임아웃 모두 graceful 처리
- [ ] 로그에 access_token/refresh_token 출력 0회 (테스트로 verify)
- [ ] 단위 테스트 추가 + 통과
- [ ] feature flag `chatgpt_plus_oauth=true` 시에만 노출
