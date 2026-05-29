# Phase 1 — pi-ai OAuth 검증 스파이크

> 목표: 본격 구현 전에 pi-ai의 OAuth 지원이 **실제로 ChatGPT Plus 구독 토큰으로 응답을 받을 수 있는지** 격리된 스크립트로 검증. 검증 실패 시 우회 전략(우리가 직접 HTTP 호출)을 결정.
>
> 예상 소요: **반나절 (4시간)**

## 0. 적용 상태

- [x] 자동 스파이크 실행 및 결과 문서화: [spike-results.md](spike-results.md)
- [x] `openai-codex` provider/baseURL/model catalog 확인
- [x] pi-coding-agent 통합 시 provider key는 `openai-codex`를 사용해야 함을 확정
- [ ] 실제 ChatGPT Plus 계정으로 OAuth login → LLM 응답까지 live E2E 확인 *(Final QA / dogfooding 단계에서 수행)*

## 1. 검증 질문 (모두 yes/no로 답해야 함)

### Q1. pi-ai의 `openai-codex` OAuth provider가 단독으로 사용 가능한가?

**검증 방법**: `node -e "..."` 스크립트로 모듈 import + 메서드 호출
```js
import { OpenAICodexOAuth } from '@mariozechner/pi-ai/dist/utils/oauth/openai-codex.js';
const provider = new OpenAICodexOAuth();
console.log({
  hasGetApiKey: typeof provider.getApiKey,
  hasRefreshToken: typeof provider.refreshToken,
  hasStartFlow: typeof provider.startFlow ?? 'unknown',
});
```

**합격 조건**: `getApiKey`, `refreshToken` 메서드 존재. `startFlow` 같은 흐름 시작 메서드가 있다면 추가 점수.

### Q2. ChatGPT Plus의 baseURL을 pi-ai가 알아서 설정하는가?

**검증 방법**: pi-ai의 모델 카탈로그 또는 provider 설정 확인
```js
import { resolveModel } from '@mariozechner/pi-ai/dist/pi-model-resolution.js';
const model = resolveModel('openai-codex', 'gpt-5'); // 가상 모델명, 실제 명은 카탈로그에서 확인
console.log(model.baseUrl);
// 기대: "https://chatgpt.com/backend-api/codex/..."
// 만약 "https://api.openai.com/v1": 우리가 별도 분기 필요
```

**합격 조건**: `baseUrl`이 `chatgpt.com/backend-api/codex` 계열로 출력.

**불합격 시 대응**: agent-runner에서 `authMethod === 'oauth' && provider === 'openai-codex'`일 때 `baseUrl`을 명시적으로 override.

### Q3. 실제 OAuth flow가 동작하는가? (manual)

**검증 방법**: 임시 스크립트 `scripts/spike/chatgpt-oauth-spike.ts` 작성
```ts
import { OpenAICodexOAuth } from '@mariozechner/pi-ai/dist/utils/oauth/openai-codex.js';
import http from 'node:http';
import crypto from 'node:crypto';

// 1. PKCE
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomUUID();

// 2. callback server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost');
  if (url.pathname === '/oauth_callback') {
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    if (returnedState !== state) { res.writeHead(400); res.end('state mismatch'); return; }
    res.writeHead(200); res.end('Authenticated. You can close this tab.');
    console.log('CODE:', code);
    // 3. token exchange — pi-ai의 헬퍼가 있으면 사용, 없으면 fetch로 직접
    server.close();
  }
});
server.listen(0, '127.0.0.1', () => {
  const port = (server.address() as any).port;
  const redirectUri = `http://127.0.0.1:${port}/oauth_callback`;
  const authUrl = new URL('https://auth.openai.com/oauth/authorize');
  authUrl.searchParams.set('client_id', 'app_EMoamEEZ73f0CkXaXp7hrann');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid profile email offline_access');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  console.log('Open this URL:', authUrl.toString());
});
```

**합격 조건**:
1. ChatGPT Plus 계정으로 브라우저 로그인 성공
2. 콜백 서버가 `code` 캡쳐
3. 토큰 교환 endpoint가 200 + `{ access_token, refresh_token, expires_in, id_token }` 반환

**중요**: 본 스파이크는 `scripts/spike/`에 임시로만 두고, 본 구현에 머지되기 전 삭제 또는 `.gitignore` 처리.

### Q4. 받은 access_token으로 실제 LLM 응답이 나오는가?

**검증 방법**: 위에서 얻은 `access_token`을 OpenAI SDK에 넣어 호출
```ts
import OpenAI from 'openai';
const client = new OpenAI({
  apiKey: ACCESS_TOKEN_FROM_STEP_3,
  baseURL: 'https://chatgpt.com/backend-api/codex', // 또는 pi-ai가 알려준 값
});
const r = await client.chat.completions.create({
  model: 'gpt-5', // 실제 ChatGPT Plus가 노출하는 모델명
  messages: [{ role: 'user', content: 'say hi in korean' }],
});
console.log(r.choices[0].message.content);
```

**합격 조건**: 한국어 인사가 출력됨. 401/403이면 baseURL, 모델명, 헤더 중 무엇이 틀린지 디버깅.

**불합격 시 대응**:
- 모델명 문제일 가능성이 높음 → goose 코드에서 `model` 필드 인용 부분 재확인
- 헤더 누락 가능성 → `chatgpt-account-id` 헤더 추가 (JWT의 `account_id` claim에서 추출)
- 그래도 안 되면 우리가 직접 `fetch()`로 호출 (pi-ai 우회)

### Q5. `setRuntimeApiKey('openai', accessToken)`만으로 pi-coding-agent에서 동작하는가?

**검증 방법**: 최소한의 agent 호출
```ts
import { getSharedAuthStorage } from '@mariozechner/pi-coding-agent';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

const auth = getSharedAuthStorage();
auth.setRuntimeApiKey('openai', ACCESS_TOKEN);
// 또는 별도 provider 키가 필요할 수 있음 (openai-codex 등)

const session = createAgentSession({ provider: 'openai-codex', model: 'gpt-5', authStorage: auth });
// 채팅 호출
```

**합격 조건**: agent가 응답을 stream으로 반환. 

**불합격 시 대응**: `createAgentSession` 옵션에 OAuth 전용 필드가 따로 있을 가능성 → pi-coding-agent README와 `dist/core/*.d.ts` 재조사.

---

## 2. 산출물 (Deliverables)

| 항목 | 내용 |
|---|---|
| **검증 결과 보고서** | `docs/subscription-login/spike-results.md` (임시) — 각 Q1~Q5에 대한 yes/no + 근거 코드 |
| **결정 사항** | (a) pi-ai의 OAuth를 그대로 활용 / (b) 부분 우회 / (c) 완전 자체 구현 중 하나 |
| **baseURL/model 카탈로그** | 실제 동작 확인된 model명, baseURL, 필수 헤더 목록 |
| **스파이크 코드 정리** | `scripts/spike/` 삭제 또는 `.gitignore` 추가 |

---

## 3. Go / No-Go 기준

### Go (Phase 2 진행)
- Q1, Q2, Q4 모두 PASS
- Q3, Q5는 일부 우회 코드 필요해도 OK (대응책이 명확하면)

### No-Go (재설계)
- Q4 FAIL (어떤 조합으로도 ChatGPT Plus 응답 못 받음) → 사용자에게 보고 후 ChatGPT 지원 보류, Claude만 진행
- ToS 변경 사항 발견 (OpenAI가 endpoint 차단했거나 명시적 금지) → ChatGPT 보류

---

## 4. 작업 일정

| 시간 | 작업 |
|---|---|
| 0:00 - 0:30 | pi-ai 모듈 구조 탐색, Q1·Q2 답변 |
| 0:30 - 2:00 | Q3 스크립트 작성 + 실제 OAuth flow 실행 |
| 2:00 - 3:00 | Q4 token으로 실제 호출, 모델명/헤더 디버깅 |
| 3:00 - 3:30 | Q5 pi-coding-agent 통합 |
| 3:30 - 4:00 | spike-results.md 작성, 결정 사항 정리 |

---

## 5. 위험 요소

- **2FA / 추가 인증**: ChatGPT Plus 계정이 2FA 설정되어 있으면 브라우저 flow에서 추가 단계. 시스템 브라우저 사용으로 자연스럽게 처리 가능.
- **클라우드 환경에서 검증 불가**: 본 스파이크는 반드시 **개발자 로컬 머신**에서 실제 ChatGPT Plus 계정으로 수행. CI/CD에서 자동화 불가.
- **endpoint 변경**: goose 분석 시점(2026-05) 이후 OpenAI가 endpoint 변경 가능. Q4에서 즉시 감지됨.
