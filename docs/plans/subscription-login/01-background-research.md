# 01 — 배경 & 조사

본 문서는 [aaif-goose/goose](https://github.com/aaif-goose/goose) 프로젝트의 subscription login 구현을 분석한 결과와, 우리가 사용 중인 `@mariozechner/pi-ai` 라이브러리의 OAuth 지원 현황을 정리한다.

---

## 1. aaif-goose의 subscription login 패턴

### 1.1 ChatGPT Plus (OpenAI Codex 방식)

**핵심 파일**: `crates/goose/src/providers/chatgpt_codex.rs`

| 항목 | 값 |
|---|---|
| **CLIENT_ID** | `app_EMoamEEZ73f0CkXaXp7hrann` (OpenAI Codex CLI와 동일) |
| **OAuth Issuer** | `https://auth.openai.com` |
| **Scopes** | `openid`, `profile`, `email`, `offline_access` |
| **PKCE** | 43자 verifier + SHA-256 challenge (`code_challenge_method=S256`) |
| **콜백 URI** | `http://127.0.0.1:{port}/oauth_callback` (port=0 → OS 자동 할당) |
| **Token 교환 endpoint** | `https://auth.openai.com/oauth/token` |
| **API endpoint (실제 호출)** | `https://chatgpt.com/backend-api/codex/responses` ⚠️ 비공식 |
| **Auth 헤더** | `Authorization: Bearer {access_token}` + 선택적 `chatgpt-account-id` |
| **Refresh** | `grant_type=refresh_token` |
| **Token 저장 위치** | `~/.config/goose/chatgpt_codex/tokens.json` (평문 JSON) |
| **JWT 검증** | OpenAI JWKS로 서명 검증 + issuer/audience claim 체크 |

**중요 사실**: 호출 endpoint(`chatgpt.com/backend-api/codex/responses`)는 공식 OpenAI API(`api.openai.com/v1/chat/completions`)와 다르다. 즉 ChatGPT Plus OAuth로 받은 토큰은 **공식 API에서는 동작하지 않으며**, ChatGPT 내부 백엔드에만 사용 가능. 이는 우리 구현에서 baseURL을 분기해야 함을 의미한다.

**ToS 평가**: 이 endpoint와 client_id는 OpenAI Codex CLI(공식 제품)가 사용한다. 외부 사용은 ToS 회색지대이지만, "공식 CLI와 동일한 인증·endpoint를 차용한다"는 명분이 있어 사용자 결정의 "보수적 — 공식/묵인 방식" 범주에 들어간다.

### 1.2 Claude Pro (ACP 위임)

**핵심 파일**: `crates/goose/src/providers/claude_acp.rs`

| 항목 | 값 |
|---|---|
| **프로토콜** | ACP (Agent Client Protocol — MCP 기반) |
| **연결 방식** | `@agentclientprotocol/claude-agent-acp` npm 바이너리를 stdio JSON-RPC로 호출 |
| **바이너리 탐지** | `SearchPaths::builder().with_npm().resolve()` |
| **자체 OAuth** | **없음** — Claude CLI의 기존 인증 토큰 그대로 재사용 |
| **Mode mapping** | Goose의 Auto/Approve 모드 → ACP session mode (`bypassPermissions` 등) |

**중요 사실**: Goose는 Claude용 OAuth를 **직접 구현하지 않는다**. 사용자가 별도로 `claude` CLI를 설치하고 `claude /login`으로 인증하면, Goose는 그 CLI에 stdio로 요청을 위임할 뿐. 우리가 채택할 가장 안전한 패턴이다.

### 1.3 Gemini Advanced (제외 — 참고용)

| 항목 | 값 |
|---|---|
| **API endpoint** | `https://cloudaicompanion-pa.googleapis.com/v1internal:streamGenerateContent` |

`v1internal` 명칭이 보여주듯 **명백한 Google 내부 API**. Google이 언제든 차단/스펙 변경 가능. 사용자가 "보수적" 입장을 명시했으므로 본 계획에서 **제외**.

### 1.4 콜백 서버 구조 (참고)

`crates/goose/src/oauth/mod.rs`:
- `axum`으로 localhost 콜백 서버 구동, 환경변수 `GOOSE_OAUTH_CALLBACK_PORT` (default=0)
- CSRF state 검증, `oneshot` 채널로 인증 결과 전달
- `webbrowser::open()` 실패 시 URL을 터미널에 출력 (CLI fallback)

→ 우리는 Electron이므로 `shell.openExternal()` + Node `http.createServer({ port: 0 })`로 등가 구현.

---

## 2. pi-ai 라이브러리의 OAuth 지원 (결정적 발견)

본 계획의 핵심 결정 요인. 우리가 **OAuth 로직을 직접 짤 필요가 없다**.

### 2.1 발견된 모듈

`node_modules/@mariozechner/pi-ai/dist/utils/oauth/`:
- `anthropic.js` — Anthropic OAuth provider
- `openai-codex.js` — **ChatGPT Plus OAuth** (우리가 쓸 것)
- `github-copilot.js` — GitHub Copilot (참고)
- `gemini-cli.js` — Gemini CLI OAuth (참고, 사용 안 함)

### 2.2 인터페이스 (`pi-ai/dist/utils/oauth/types.d.ts:36`)

```typescript
interface OAuthProviderInterface {
  getApiKey(credentials: OAuthCredentials): string;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  // ...
}
```

- `getApiKey()`: OAuth credentials에서 SDK에 넣을 토큰 추출 (Anthropic은 `credentials.access`, OpenAI Codex는 JWT 디코딩 후 access_token 반환)
- `refreshToken()`: 만료 시 새 토큰 발급

### 2.3 OpenAI provider의 Bearer 처리 (`openai-responses.js:106`)

```javascript
return new OpenAI({
  apiKey,        // OAuth access_token이 그대로 전달됨
  baseURL: model.baseUrl,
  defaultHeaders: headers,
});
```

OpenAI SDK는 `apiKey`를 `Authorization: Bearer {value}` 헤더로 자동 변환. 따라서 **OAuth access_token을 그대로 `apiKey` 자리에 넣으면 Bearer 토큰으로 전송된다.**

### 2.4 환경변수 우선순위 (`env-api-keys.js:47-105`)

1. Runtime override (`setRuntimeApiKey`)
2. 환경변수 (`ANTHROPIC_OAUTH_TOKEN`, `OPENAI_API_KEY` 등)
3. 파일 기반 `auth.json`

→ Veluga는 우선순위 1을 사용. OAuth 토큰 갱신 시점에 `setRuntimeApiKey('openai', newAccessToken)` 한 줄로 처리 가능.

### 2.5 잔여 의문 (Phase 1 스파이크에서 검증)

| 의문 | 검증 방법 |
|---|---|
| pi-ai의 `openai-codex` provider가 자동으로 `baseURL`을 `chatgpt.com/backend-api`로 설정하는가? | 모듈 import 후 `model.baseUrl` 확인 |
| 단순히 `setRuntimeApiKey('openai', oauthToken)`만 하면 401 나오는가? (baseURL 미스매치) | 실제 ChatGPT Plus 계정으로 호출 시도 |
| pi-coding-agent의 `createAgentSession()`이 별도의 provider 선택 옵션을 갖는가? (`'openai'` vs `'openai-codex'`) | `agent-runner.ts:1420` 주변 호출 시그니처 확인 |
| 토큰 만료 60초 buffer 자동 갱신이 pi-ai 안에 있는가? | `OAuthProviderInterface.refreshToken` 호출 트리거 확인 |

→ Phase 1(반나절 스파이크)에서 위 4건 모두 답한 후 본격 구현 진입.

---

## 3. Veluga_TA 현재 구조 (관련 부분)

### 3.1 AI provider SDK

`packages/cowork-core/package.json`:
- `@anthropic-ai/sdk` (v0.39.0)
- `@mariozechner/pi-ai` (v0.60.0) ← OAuth 지원 발견 위치
- `@mariozechner/pi-coding-agent` (v0.60.0) ← AuthStorage 호스트
- `openai` (v6.32.0)
- `@google/genai` (v1.44.0) — 본 계획 범위 외

### 3.2 인증 진입점

| 파일 | 라인 | 역할 |
|---|---|---|
| `packages/cowork-core/src/main/config/config-store.ts` | 71-77 (`ProviderProfile`) | provider, apiKey, baseUrl 등 저장 타입 |
| `packages/cowork-core/src/main/config/config-store.ts` | 92-151 (`AppConfig`) | 다중 프로필 + 활성 프로필 ID |
| `packages/cowork-core/src/main/config/auth-utils.ts` | 5-39 | API key 형식 감지 (이미 `isLikelyOAuthAccessToken()` 함수 존재 — OAuth 도입을 예상한 흔적) |
| `packages/cowork-core/src/main/utils/store-encryption.ts` | 1-50 | electron-store + scrypt + AES-256, 키 로테이션 지원 |
| `packages/cowork-core/src/main/claude/shared-auth.ts` | 7-11 | `getSharedAuthStorage()` 싱글톤 |
| `packages/cowork-core/src/main/claude/agent-runner.ts` | 1420-1434 | `setRuntimeApiKey(provider, apiKey)` 호출 지점 ← OAuth 분기 진입점 |
| `packages/cowork-core/src/main/index.ts` | 1417-1631 | config.* IPC 핸들러 등록 (옆에 `auth.*` 추가 예정) |

### 3.3 Electron BrowserWindow 인프라

`packages/cowork-core/src/main/index.ts:500-600` — 메인 윈도우 생성. OAuth는 **별도 webview를 띄우지 않고** `shell.openExternal()`로 시스템 기본 브라우저를 사용. 이유:
- OpenAI/Anthropic 인증 페이지는 embedded webview를 종종 차단 (User-Agent 또는 보안 정책)
- 사용자가 이미 브라우저에 로그인되어 있으면 SSO로 즉시 통과
- 시스템 브라우저가 더 신뢰됨 (피싱 의혹 회피)

### 3.4 OAuth/세션 관련 기존 코드

**현재 OAuth 인프라는 없음.** 이는 신규 구축 영역이지만, pi-ai가 OAuth provider를 제공하므로 우리가 짤 것은 다음에 한정:
- localhost 콜백 서버 (~50줄)
- IPC 핸들러 (`auth.*`)
- 설정 UI
- 토큰 저장 namespace 추가
- agent-runner의 `authMethod` 분기

---

## 4. 핵심 결론

| 결론 | 영향 |
|---|---|
| pi-ai가 ChatGPT Plus OAuth provider를 이미 가짐 | PKCE/JWT/refresh 로직 직접 구현 불필요 |
| `setRuntimeApiKey()`는 OAuth Bearer 토큰을 그대로 수용 | Agent 통합 매우 단순 |
| ChatGPT 토큰은 비공식 endpoint(`chatgpt.com/backend-api/codex/responses`)에만 동작 | baseURL 분기 필요 — Phase 1 스파이크에서 pi-ai가 처리하는지 확인 |
| Claude는 OAuth 없음, CLI 위임이 정답 | 별도 코드 경로 — `child_process.spawn('claude')` 또는 ACP 어댑터 |
| 기존 `store-encryption.ts`가 토큰 저장에 충분 | 새 의존성 0 |
| `auth-utils.ts`에 `isLikelyOAuthAccessToken()`이 이미 있음 | 이전에 OAuth 도입을 검토한 흔적 → 자연스러운 확장 |

→ **구현 난이도: 중하**. 핵심 위험은 (a) pi-ai의 ChatGPT OAuth가 baseURL을 알아서 처리하는지, (b) Claude CLI 위임 시 streaming/tool_use 호환성 두 가지. 둘 다 Phase 1·4 초반에 검증.
