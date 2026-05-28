# 02 — 아키텍처

## 1. 토폴로지

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React)                                            │
│  Settings UI                                                │
│   ├─ [API Key 입력]   (기존)                                │
│   ├─ [ChatGPT Plus 로그인 버튼]   (신규)                    │
│   └─ [Claude Pro CLI 위임]   (신규)                         │
└──────────┬──────────────────────────────────────────────────┘
           │ IPC (contextBridge)
           │   ├─ config.* (기존)
           │   ├─ auth.startOAuth (신규)
           │   ├─ auth.checkClaudeCli (신규)
           │   └─ auth.signOut (신규)
┌──────────┴──────────────────────────────────────────────────┐
│ Main 프로세스                                                │
│                                                              │
│  ┌──────────────────────┐    ┌────────────────────────────┐│
│  │ config-store.ts      │    │ oauth-manager.ts (신규)    ││
│  │  ProviderProfile {   │◄───┤  startFlow(provider)       ││
│  │   authMethod,        │    │  handleCallback(code,state)││
│  │   apiKey?,           │    │  refreshIfExpired(profile) ││
│  │   oauthCredentials?  │    │  signOut(provider)         ││
│  │  }                   │    └─────┬──────────────────────┘│
│  └──────────┬───────────┘          │                       │
│             │                       │ HTTP                  │
│             │                       ▼                       │
│             │              ┌──────────────────────┐         │
│             │              │ Local Callback       │         │
│             │              │ Server (port=0)      │         │
│             │              │   /oauth_callback    │         │
│             │              └──────────────────────┘         │
│             │                       ▲                       │
│             │                       │ redirect              │
│             │              ┌────────┴──────────┐            │
│             │              │ shell.openExternal│            │
│             │              │  (system browser) │            │
│             │              └───────────────────┘            │
│             │                                               │
│  ┌──────────▼──────────────────────────────────────────┐   │
│  │ store-encryption.ts (재사용)                        │   │
│  │  namespace: 'oauth-credentials'                     │   │
│  │  AES-256 (scrypt 파생키)                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │ agent-runner.ts                                    │    │
│  │   switch (profile.authMethod) {                    │    │
│  │     case 'apikey':                                 │    │
│  │       authStorage.setRuntimeApiKey(p, apiKey);     │    │
│  │     case 'oauth':                                  │    │
│  │       await oauthManager.refreshIfExpired(p);      │    │
│  │       authStorage.setRuntimeApiKey(p, accessToken);│    │
│  │     case 'cli-delegate':                           │    │
│  │       claudeCliRunner.spawn(...);   // 별도 경로  │    │
│  │   }                                                │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ pi-ai/pi-coding-agent
                  ┌─────────────────────────────────┐
                  │ OpenAI SDK / Anthropic SDK      │
                  │  Authorization: Bearer <token>  │
                  └─────────────────────────────────┘
```

---

## 2. 데이터 모델

### 2.1 `ProviderProfile` 확장 (`config-store.ts`)

```typescript
export type AuthMethod = 'apikey' | 'oauth' | 'cli-delegate';

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;       // epoch ms
  tokenType: 'Bearer';
  scope?: string;
  accountId?: string;      // ChatGPT Plus의 경우 JWT에서 추출
  obtainedAt: number;      // epoch ms — 갱신 주기 분석용
}

export interface ProviderProfile {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter' | ...;
  authMethod: AuthMethod;            // 신규
  apiKey?: string;                   // authMethod='apikey'일 때만
  oauthCredentials?: OAuthCredentials; // authMethod='oauth'일 때만
  // cli-delegate는 별도 저장값 없음 — claude CLI가 알아서 처리
  baseUrl?: string;
  customProtocol?: string;
}
```

**저장 위치**: 기존 `electron-store` + `store-encryption.ts`. 단 OAuth credentials는 별도 키(`oauth-credentials`)에 저장하여 프로필 export 시 토큰 분리 가능.

### 2.2 Feature flag

```typescript
// packages/cowork-core/src/main/config/feature-flags.ts (또는 기존 flag 모듈 활용)
{
  subscription_login: {
    enabled: false,            // 마스터 킬스위치
    chatgpt_plus_oauth: false, // provider별 토글
    claude_pro_cli: false,
  }
}
```

Phase 5에서 dogfooding 통과 후 단계적으로 `true`로 전환.

---

## 3. 통합 지점 (Integration Points)

| # | 파일 | 변경 유형 | 핵심 변경 |
|---|---|---|---|
| 1 | `packages/cowork-core/src/main/config/config-store.ts` | 타입 확장 | `AuthMethod`, `OAuthCredentials`, `ProviderProfile` 확장 |
| 2 | `packages/cowork-core/src/main/config/auth-utils.ts` | 함수 추가 | `getEffectiveCredential(profile)`: authMethod에 따라 분기하여 SDK에 넘길 값 반환 |
| 3 | `packages/cowork-core/src/main/auth/oauth-manager.ts` | **신규** | pi-ai OAuth provider 래퍼 + 콜백 서버 |
| 4 | `packages/cowork-core/src/main/auth/oauth-callback-server.ts` | **신규** | `http.createServer({ port: 0 })` 기반 콜백 캡쳐 |
| 5 | `packages/cowork-core/src/main/auth/claude-cli-detector.ts` | **신규** | `which/where claude` + npm global path + 버전/인증 상태 |
| 6 | `packages/cowork-core/src/main/auth/claude-cli-runner.ts` | **신규** | `child_process.spawn` 기반 stdio 위임 (Phase 4) |
| 7 | `packages/cowork-core/src/main/index.ts` | IPC 핸들러 추가 | `auth.startOAuth`, `auth.cancelOAuth`, `auth.checkClaudeCli`, `auth.signOut`, `auth.getStatus` |
| 8 | `packages/cowork-core/src/main/claude/agent-runner.ts` | 분기 추가 | `authMethod` 스위치 — 1420-1434 라인 근처 |
| 9 | `packages/cowork-core/src/main/utils/store-encryption.ts` | 변경 없음 | namespace key만 추가 |
| 10 | `packages/cowork-core/src/preload/*.ts` | IPC bridge 추가 | `window.veluga.auth.*` 노출 |
| 11 | `packages/cowork-core/src/renderer/...` (정확 경로는 구현 시 확인) | UI 추가 | 설정 화면 인증 방식 선택, OAuth 진행 dialog |

---

## 4. OAuth 흐름 상세 (ChatGPT Plus)

```
[1] User clicks "ChatGPT Plus 로그인"
       │
       ▼
[2] Renderer → IPC: auth.startOAuth({ provider: 'openai-codex', profileId })
       │
       ▼
[3] Main: oauthManager.startFlow('openai-codex')
       ├─ PKCE verifier 생성 (43자)
       ├─ challenge = SHA256(verifier)
       ├─ state = crypto.randomUUID()
       ├─ http.createServer({ port: 0 }) 기동 → 실제 포트 P 획득
       ├─ redirectUri = `http://127.0.0.1:${P}/oauth_callback`
       └─ authUrl 생성:
            https://auth.openai.com/oauth/authorize?
              client_id=app_EMoamEEZ73f0CkXaXp7hrann
              &response_type=code
              &redirect_uri={redirectUri}
              &scope=openid+profile+email+offline_access
              &state={state}
              &code_challenge={challenge}
              &code_challenge_method=S256
       │
       ▼
[4] shell.openExternal(authUrl)
       │
       ▼ (사용자가 브라우저에서 로그인)
       │
[5] OpenAI → 302 redirect → http://127.0.0.1:P/oauth_callback?code=...&state=...
       │
       ▼
[6] Callback server captures (code, state)
       ├─ state 검증 (CSRF)
       ├─ POST https://auth.openai.com/oauth/token
       │    grant_type=authorization_code
       │    code, redirect_uri, code_verifier, client_id
       ├─ 응답: { access_token, refresh_token, expires_in, id_token }
       └─ JWT 검증 (issuer=auth.openai.com, audience 등)
       │
       ▼
[7] oauthCredentials 저장 (store-encryption, namespace='oauth-credentials')
       │
       ▼
[8] Renderer 상태 업데이트: "로그인됨 · 만료 14:32"
```

**예외 처리**:
- 사용자가 브라우저를 닫음 / 거부 → 5분 타임아웃 후 cancel
- state 불일치 → 즉시 폐기, 에러 UI
- 토큰 교환 실패 (401/400) → 에러 메시지 + 재시도 버튼
- 콜백 서버 포트 충돌 → port=0 사용으로 사실상 불가

---

## 5. CLI 위임 흐름 상세 (Claude Pro)

```
[1] User selects "Claude Pro (Claude Code 위임)"
       │
       ▼
[2] Renderer → IPC: auth.checkClaudeCli
       │
       ▼
[3] Main: claudeCliDetector.detect()
       ├─ which/where claude   (POSIX/Windows)
       ├─ npm root -g → check {npmRoot}/.bin/claude
       ├─ 발견 시: spawn('claude', ['--version']) → version 추출
       └─ 발견 실패 시: { installed: false, instructions: 'https://docs.claude.com/...' }
       │
       ▼
[4] Renderer 표시: "Claude Code vX.Y.Z 감지됨 — 사용 준비 완료"
       │
       ▼ (사용자가 채팅 시작)
       │
[5] agent-runner: profile.authMethod === 'cli-delegate'
       └─ claudeCliRunner.invoke(messages, options)
            ├─ child_process.spawn('claude', ['--json-rpc', '--stdio'])
            ├─ stdin: JSON-RPC request (messages, model, system, ...)
            ├─ stdout: streaming response chunks
            └─ stderr: 에러 로깅
       │
       ▼
[6] Veluga UI에 응답 표시
```

**MVP 범위 한정**: 첫 PR은 단순 chat (system + messages → assistant message)만 지원. Tool use, vision, MCP는 Phase 4 이후 추가.

---

## 6. 보안 경계 (Trust Boundaries)

```
┌─────────────┐ trust=untrusted ┌──────────────────┐ trust=trusted ┌─────────────┐
│  Renderer   │ ────────────► │  Main 프로세스    │ ────────────► │  pi-ai SDK  │
│  (Chromium) │                │  (Node.js)        │                │             │
└─────────────┘                └──────────────────┘                └─────────────┘
       │                              │
       │                              ├─ OAuth 토큰 보관 (이곳에서만)
       │                              ├─ refresh logic
       │                              └─ token redaction in logs
       │
       └─ "로그인 상태 / 만료 시각" 메타데이터만 수신
          (실제 access_token은 절대 받지 않음)
```

**원칙**: Renderer에는 토큰이 절대 노출되지 않는다. `auth.getStatus()` 응답은:
```typescript
{
  loggedIn: true,
  provider: 'openai-codex',
  expiresAt: 1737000000000,
  accountHint: 'sy***@veluga.io', // 마스킹
  // access_token: 절대 포함 안 함
}
```

---

## 7. 의존성 추가

**신규 의존성 (Phase 1 검증 후 확정)**:
- 없음 — pi-ai의 OAuth provider, Node 내장 `http`, `crypto`, `child_process`만 사용 예정

이는 [agent-orchestration-plan §하드 제약](../agent-orchestration-plan/00-overview.md)의 "외부 의존성 최소화" 원칙과 일치.

만약 Phase 1에서 pi-ai의 ChatGPT OAuth가 baseURL을 자동 처리하지 않는 것으로 판명되면, 우리가 별도 thin HTTP client(또는 `openai` SDK를 `baseURL` 커스텀하여 재인스턴스화)를 구현해야 한다. 그래도 새 패키지 의존성은 없음.
