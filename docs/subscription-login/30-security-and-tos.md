# 30 — 보안 & ToS

본 문서는 subscription login 기능에 한정된 보안 정책과 ToS(Terms of Service) 회색지대 대응 방안을 정리한다.

---

## 1. 보안 모델

### 1.1 위협 모델 (Threat Model)

| 위협 | 영향 | 대응 |
|---|---|---|
| **로컬 디스크 탈취** | OAuth refresh token 영구 노출 → 사용자 ChatGPT 계정에 무기한 접근 가능 | 기존 `store-encryption.ts` (scrypt + AES-256) 사용. 단 키 derivation salt는 OS 사용자별로 분리 |
| **Renderer 프로세스 침해 (XSS, 악성 dependency)** | 토큰 탈취 | 토큰은 **main 프로세스에서만 보관**. renderer에는 마스킹된 메타데이터만 |
| **로그 파일에 토큰 누출** | 토큰이 평문으로 디스크에 잔존 | 모든 로그문에 redaction 필터 (JWT, sk-*, access_token 패턴) |
| **메모리 dump (crash dump)** | 토큰이 메모리에서 추출됨 | Electron 충돌 보고서 비활성화 (이미 화이트아웃 정책으로 비활성) |
| **MITM (네트워크 중간자)** | 토큰 교환 가로채기 | HTTPS 강제 (OpenAI/Anthropic 인증 endpoint는 모두 HTTPS), 인증서 검증 |
| **CSRF (악성 사이트가 콜백 호출)** | 임의 code 주입 | `state` 토큰으로 CSRF 보호, 5분 타임아웃 |
| **다른 프로세스의 localhost 콜백 가로채기** | 동일 머신의 다른 앱이 콜백 서버를 먼저 띄움 | port=0 (OS 자동 할당)으로 충돌 회피, 127.0.0.1 바인딩 (외부 접근 차단) |
| **OAuth flow 중 클립보드 노출** | code/verifier가 클립보드 거치면 다른 앱에 노출 | 클립보드 사용 안 함, 콜백으로만 전달 |

### 1.2 토큰 저장 정책

**저장 위치**: `electron-store` (OS별 기본 경로 — macOS `~/Library/Application Support/Veluga/`, Windows `%APPDATA%\Veluga\`)

**저장 형식**:
```
{
  "encrypted": "base64(AES-256-GCM payload)",
  "iv": "base64(...)",
  "salt": "base64(...)",
  "version": 1
}
```

**암호화 키 derivation**: `scrypt(machine_id || user_id, salt, ...)` — 머신 이동 시 자동 무효화. 자세한 방식은 [store-encryption.ts](../../packages/cowork-core/src/main/utils/store-encryption.ts) 참조.

**namespace 분리**:
- `apikey-credentials` (기존)
- `oauth-credentials` (신규) — provider별 sub-key (`openai-codex`, ...)
- `tos-acknowledgments` (신규) — 사용자 동의 이력

→ 백업/export 시 namespace 단위로 분리 가능. UI에서 "API key만 export" 옵션 제공 (OAuth 토큰은 머신 이동 시 어차피 복호화 불가하므로 export 의미 없음).

### 1.3 로그 redaction 패턴

`packages/cowork-core/src/main/utils/logger.ts` (기존 로거 확장):

```typescript
const REDACT_PATTERNS = [
  // JWT (header.payload.signature)
  { pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replace: '[JWT_REDACTED]' },
  // OpenAI-style key
  { pattern: /sk-[A-Za-z0-9]{20,}/g, replace: '[APIKEY_REDACTED]' },
  // OAuth bearer in URL or string
  { pattern: /(access_token|refresh_token|id_token)["\s:=]+["']?[A-Za-z0-9_.\-]+/gi, replace: '$1=[REDACTED]' },
  // Anthropic-style key
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g, replace: '[ANTKEY_REDACTED]' },
];

export function redactSensitive(s: string): string {
  return REDACT_PATTERNS.reduce((acc, { pattern, replace }) => acc.replace(pattern, replace), s);
}
```

기존 로거 wrap (intercept) — 모든 `info`/`warn`/`error` 메시지가 통과해야 함.

### 1.4 Renderer 노출 정책

**절대 금지** (보안 경계):
- access_token, refresh_token, id_token 원본
- JWT 디코딩 결과 전체 (account_id 정도만 마스킹 후 노출 가능)
- API key 원본 (기존 정책 유지)

**노출 허용**:
- `{ loggedIn: boolean, expiresAt: number, accountHint: string }` (계정 hint는 `sy***@veluga.io` 형태)
- 토큰 만료 시각, 마지막 갱신 시각

**검증 방법**: renderer의 DevTools에서 `JSON.stringify(window.veluga)` 결과를 grep — `access_token`, `refresh_token`, `sk-`, `eyJ` 0건.

---

## 2. ToS 회색지대 분석

### 2.1 ChatGPT Plus OAuth

| 사실 | 출처 |
|---|---|
| client_id `app_EMoamEEZ73f0CkXaXp7hrann`는 OpenAI Codex CLI(공식 제품)와 동일 | goose 코드 분석 |
| 호출 endpoint `chatgpt.com/backend-api/codex/responses`는 OpenAI 공식 API가 아닌 ChatGPT 내부 백엔드 | goose 코드 분석 |
| OpenAI ToS는 "공식 클라이언트가 아닌 자동화"를 명시적으로 금지하는 조항이 있을 가능성 (2026년 현재 ToS 원문 확인 필요) | OpenAI ToS 문서 |
| OpenAI Codex CLI는 공식 제품이며 동일 endpoint를 사용 | OpenAI 공식 |

**평가**: **회색지대**. 공식 CLI와 동일한 endpoint/client_id를 사용하므로 OpenAI 시스템 입장에서 구별 불가하지만, ToS상 명시적 허용은 아님. 사용자 명시 동의 후 사용.

**리스크 시나리오**:
1. OpenAI가 client_id 차단 → 우리 앱 + Codex CLI 둘 다 중단
2. OpenAI가 user-agent / 추가 헤더로 fingerprint 차단 → 우리만 중단
3. OpenAI가 ToS를 변경하여 명시 금지 → 자발적 중단 필요

**대응**:
- ToS 고지 dialog로 사용자 동의 (위 시나리오 모두 설명)
- 빠른 flag OFF 메커니즘 ([14-phase5 §2.2 롤백 기준](14-phase5-ui-and-rollout.md#22-롤백-기준))
- 차단 감지 시 자동으로 API key 모드 사용 권유 dialog

### 2.2 Claude Pro CLI 위임

| 사실 |
|---|
| Veluga가 직접 Anthropic API를 호출하지 않음 — 사용자의 Claude Code CLI가 호출 |
| Claude Code CLI는 Anthropic 공식 제품 |
| Claude Code CLI에서 외부 통합은 ACP/MCP로 공식 지원 (block/goose 등 활용 중) |

**평가**: **안전**. Anthropic이 자체적으로 외부 통합을 권장하는 패턴. 별도 ToS 고지 불필요(다만 "Claude Code CLI 설치가 필요하며 Anthropic ToS를 따른다"는 안내 정도).

### 2.3 Gemini (도입 안 함)

- `v1internal` 명칭이 보여주듯 명백한 내부 API
- 공식 CLI가 아닌 비공식 endpoint
- **본 계획 범위 밖** (사용자 결정)

---

## 3. 사용자 고지 (Disclosures)

### 3.1 ToS 고지 dialog (ChatGPT Plus 첫 사용 시)

[14-phase5 §1.5](14-phase5-ui-and-rollout.md#15-tos-고지-dialog-첫-oauth-사용-시) 참조.

### 3.2 도움말 문서

- ChatGPT Plus 로그인의 위험성 (차단 가능성, ToS 회색지대)
- Claude Pro CLI 위임의 한계 (tool use 미지원 MVP)
- 토큰 저장 위치 및 보안 정책 (사용자가 검증 가능하도록)

### 3.3 차단 발생 시 사용자 안내

OpenAI가 endpoint를 차단하여 401/403이 지속되면:

```
┌─────────────────────────────────────────────────┐
│ ⚠️ ChatGPT Plus 연결 문제                       │
├─────────────────────────────────────────────────┤
│ OpenAI가 ChatGPT Plus 로그인 방식을 차단했거나  │
│ 정책을 변경한 것으로 보입니다.                  │
│                                                 │
│ 다음 중 선택하세요:                             │
│   • OpenAI API key를 등록하여 계속 사용         │
│   • 다른 provider (Claude 등) 사용              │
│                                                 │
│ [API Key 등록] [다른 provider 사용]            │
└─────────────────────────────────────────────────┘
```

---

## 4. 사고 대응 (Incident Response)

### 4.1 토큰 유출 발견 시

1. **즉시 조치**:
   - feature flag `subscription_login.enabled=false`로 전사 OFF
   - 로그/dump에서 토큰 패턴 grep → 영향 범위 파악
   - 영향 사용자에게 알림 + ChatGPT/Anthropic 계정에서 세션 강제 종료 안내

2. **사용자 가이드**:
   - ChatGPT: `https://chat.openai.com/` → Settings → Security → "Log out all devices"
   - Claude: `claude /logout` 후 재로그인

3. **사후 조치**:
   - redaction 패턴 누락 원인 분석
   - 회귀 테스트 추가
   - 보안 review 의무화 ([review skill](../../) 사용)

### 4.2 ToS 변경 발견 시

1. 법무/제품 팀과 협의 후 결정
2. 결정에 따라:
   - 즉시 OFF + 사용자에게 안내
   - 또는 추가 동의 dialog (ToS 변경 사항 명시) 후 opt-in 유지

---

## 5. 정기 점검 (Periodic Review)

| 항목 | 주기 | 담당 |
|---|---|---|
| OpenAI ToS 원문 재확인 | 분기 | 제품 |
| Anthropic ToS 원문 재확인 | 분기 | 제품 |
| redaction 패턴 누락 audit | 분기 | 보안 |
| 차단/응답 코드 메트릭 review | 월 | 개발 |
| 의존성 보안 업데이트 (`pi-ai`, `electron-store` 등) | 월 | 개발 |
| Claude Code CLI 버전 호환성 확인 | 분기 | 개발 |

---

## 6. 참고 자료

- OpenAI ToS: https://openai.com/policies/terms-of-use
- Anthropic Usage Policies: https://www.anthropic.com/legal/aup
- Claude Code 문서: https://docs.claude.com/en/docs/claude-code
- ACP (Agent Client Protocol): https://github.com/agentclientprotocol
- OAuth 2.0 PKCE RFC 7636
- Veluga 화이트아웃 정책: [docs/whiteout-endpoints.md](../whiteout-endpoints.md)
- Veluga 오케스트레이션 보안 모델: [agent-orchestration-plan §하드 제약](../agent-orchestration-plan/00-overview.md)
