# Phase 5 — UI 마감 & 점진적 롤아웃

> 목표: Phase 3·4의 백엔드 위에 사용자 친화적 UI를 완성하고, feature flag를 단계적으로 켜 안전 배포.
>
> 예상 소요: **1일 (UI) + 1주 (롤아웃 모니터링)**

## 1. UI 구성 요소

### 1.1 설정 화면 — Provider 패널

**파일 (가설)**: `packages/cowork-core/src/renderer/components/settings/ProviderSettings.tsx`

**컴포넌트 트리**:
```
<ProviderSettings>
  <AuthMethodSelector
    provider={profile.provider}
    value={profile.authMethod}
    onChange={...}
  />
  {/* method별 패널 */}
  {profile.authMethod === 'apikey' && <ApiKeyPanel />}
  {profile.authMethod === 'oauth' && <OAuthPanel />}
  {profile.authMethod === 'cli-delegate' && <CliDelegatePanel />}
</ProviderSettings>
```

### 1.2 `<AuthMethodSelector>`

- 라디오 그룹 (또는 segmented control)
- provider에 따라 옵션 필터링:
  - `openai`: API Key | ChatGPT Plus 로그인
  - `anthropic`: API Key | Claude Pro (Claude Code CLI 위임)
  - 그 외 provider: API Key만
- feature flag OFF인 옵션은 숨김 (개발 빌드에서만 회색 처리하여 디버깅 가능)

### 1.3 `<OAuthPanel>` (ChatGPT Plus)

**상태 분기**:
```
┌─ 미인증 상태 ─────────────────────┐
│ ⓘ ChatGPT Plus 구독으로 로그인    │
│                                   │
│ [ChatGPT Plus 로그인] 버튼        │
│                                   │
│ ⚠️ 비공식 endpoint 사용 안내      │
└──────────────────────────────────┘

┌─ 인증 진행 중 ────────────────────┐
│ 🔄 브라우저에서 로그인 완료해 주세요│
│                                   │
│ [취소] 버튼                       │
└──────────────────────────────────┘

┌─ 인증 완료 ───────────────────────┐
│ ✓ 로그인됨                        │
│                                   │
│ 계정: sy***@veluga.io             │
│ 만료: 2026-05-29 14:32 (자동 갱신)│
│                                   │
│ [로그아웃] 버튼                   │
└──────────────────────────────────┘
```

**구현 노트**:
- `window.veluga.auth.startOAuth({ provider: 'openai-codex', profileId })` 호출
- `window.veluga.auth.onProgress(cb)`로 진행 상태 구독
- 5분 후 타임아웃 시 자동으로 "재시도" 버튼 표시
- 만료 시각은 매 분 재계산 (`setInterval(..., 60_000)`)

### 1.4 `<CliDelegatePanel>` (Claude Pro)

**상태 분기**:
```
┌─ CLI 미설치 ──────────────────────┐
│ ⚠️ Claude Code CLI가 설치되지     │
│    않았습니다                     │
│                                   │
│ Claude Pro 구독을 사용하려면 먼저  │
│ Claude Code CLI를 설치해야 합니다 │
│                                   │
│ [설치 안내 열기] [다시 확인]      │
└──────────────────────────────────┘

┌─ 설치됨, 미인증 ──────────────────┐
│ ⓘ Claude Code v1.2.3 감지됨       │
│                                   │
│ Claude Code에서 로그인이 필요합니다│
│ 터미널에서 `claude /login` 실행 후│
│ 다시 확인을 눌러주세요            │
│                                   │
│ [다시 확인]                       │
└──────────────────────────────────┘

┌─ 준비 완료 ───────────────────────┐
│ ✓ Claude Code v1.2.3              │
│ ✓ 인증됨                          │
│                                   │
│ ⓘ 이 모드에서는 도구 호출이      │
│    지원되지 않습니다 (MVP)        │
└──────────────────────────────────┘
```

### 1.5 ToS 고지 Dialog (첫 OAuth 사용 시)

```
┌─────────────────────────────────────────────┐
│ ChatGPT Plus 로그인 안내                    │
├─────────────────────────────────────────────┤
│ 이 기능은 OpenAI의 ChatGPT Plus 구독을      │
│ 활용합니다. 다음 사항을 확인해 주세요:      │
│                                             │
│ • 공식 OpenAI API가 아닌 ChatGPT 내부       │
│   엔드포인트를 사용합니다                   │
│ • OpenAI가 정책을 변경하면 동작이 중단될    │
│   수 있습니다                               │
│ • OpenAI Codex CLI와 동일한 방식이지만,    │
│   사용에 대한 책임은 사용자에게 있습니다    │
│                                             │
│ □ 위 사항을 이해했으며 동의합니다           │
│                                             │
│              [취소]   [동의하고 계속]       │
└─────────────────────────────────────────────┘
```

- 동의 상태는 `config.tos.chatgpt_plus_oauth_acknowledged_at` 에 epoch ms로 저장
- 한 번 동의하면 재표시 없음 (정책 변경 시 acknowledged_at을 invalidate하여 재고지 가능)

### 1.6 채팅 화면 — 인증 상태 인디케이터

기존 채팅 UI 상단(또는 사이드바)의 모델 선택기 옆에:
```
[ChatGPT Plus ✓] gpt-5    또는    [API Key ✓] gpt-4o
[Claude Pro CLI ✓] claude-opus-4-7
```

만료 임박(<5분) 시 노란색 점, 만료/refresh 실패 시 빨간색 점.

## 2. 점진적 롤아웃 (Feature Flag)

### 2.1 단계

| 단계 | 기간 | flag 상태 | 대상 | 모니터링 |
|---|---|---|---|---|
| **0. 내부 dogfooding** | 1주 | `enabled=true` (개발자 로컬만) | 본인 + 2-3명 | 매일 회의에서 이슈 공유 |
| **1. 알파 (manual opt-in)** | 1주 | `enabled=true`, UI에 "베타" 배지 | 사내 5-10명 | 슬랙 #subscription-login 채널 |
| **2. 베타 (소규모 외부)** | 2주 | 위와 동일 | 신청한 외부 사용자 20명 | 1일 1회 사용성 체크 |
| **3. 일반 출시** | - | flag default ON | 전체 | 1주차 일일, 이후 주간 |

### 2.2 롤백 기준

다음 중 하나라도 발생 시 flag를 즉시 OFF:
- ChatGPT OAuth 호출 401/403 비율 > 10% (OpenAI 차단 신호)
- 토큰 갱신 실패율 > 5%
- Claude CLI 위임 중 hang/crash 보고 > 3건
- 보안 이슈 (토큰 dump, plaintext 노출) 1건이라도 발견 시 **즉시 전사 알림 + 토큰 무효화 가이드 배포**

### 2.3 메트릭

다음 메트릭을 internal logging(텔레메트리 SaaS 금지, 화이트아웃 유지 — [agent-orchestration-plan §하드제약 2](../agent-orchestration-plan/00-overview.md) 참조)으로 수집:

| 메트릭 | 측정 |
|---|---|
| `auth.oauth.flow.start` | OAuth flow 시작 횟수 |
| `auth.oauth.flow.success` | 정상 완료 |
| `auth.oauth.flow.error.{reason}` | 에러별 카운트 (timeout, state_mismatch, token_exchange_fail 등) |
| `auth.oauth.refresh.success` | refresh 성공 |
| `auth.oauth.refresh.fail` | refresh 실패 |
| `auth.cli.detect.installed` | Claude CLI 설치 감지 |
| `auth.cli.invoke.success/fail` | CLI 호출 결과 |
| `chat.message.by_auth_method.{apikey,oauth,cli-delegate}` | 메시지 송신 카운트 (사용 비율 파악) |

**금지**: 토큰값, 사용자 이메일 원본, 메시지 내용 — 모두 익명화/마스킹.

## 3. 문서 & 사용자 안내

### 3.1 도움말 문서 추가

`docs/user-guides/subscription-login.md` (신규):
- ChatGPT Plus 로그인 방법
- Claude Pro CLI 설치 + 연동 방법
- FAQ:
  - "API key는 어떻게 되나요?" → 그대로 사용 가능, 언제든 전환 가능
  - "토큰은 어디 저장되나요?" → 로컬 암호화 저장소 (electron-store + AES-256)
  - "OpenAI/Anthropic이 이 기능을 차단할 수 있나요?" → 가능하며 그 경우 자동으로 안내
  - "여러 계정 사용 가능한가요?" → 기존 프로필 시스템(`createSet/switchSet`)으로 가능

### 3.2 릴리즈 노트

```markdown
## vX.Y.0 — Subscription Login (Beta)

### 신규 기능
- **ChatGPT Plus 로그인 지원** — API key 없이 ChatGPT Plus 구독으로 사용 가능
- **Claude Pro CLI 위임** — 로컬에 설치된 Claude Code CLI를 통해 Claude Pro 활용

### 주의사항
- ChatGPT Plus 로그인은 OpenAI의 비공식 엔드포인트를 사용하며, OpenAI 정책 변경 시 차단될 수 있습니다.
- Claude Pro 위임은 별도 Claude Code CLI 설치가 필요합니다.
- 기존 API key 사용자에게는 영향 없습니다 (설정 → 인증 방식에서 전환 가능).
```

## 4. 완료 기준

- [x] 설정 UI: `<AuthMethodSelector>`(기존), `OAuthPanel`, `CliDelegatePanel` 모두 동작
- [x] ToS 고지 dialog 첫 OAuth 사용 시 1회 표시 + 동의 영속화 (`config.chatgptPlusTosAckAt`)
- [x] 채팅 화면에 인증 상태 인디케이터 (정상/만료임박<5분/실패 3색 — `AuthStatusIndicator`)
- [x] feature flag로 OFF 시 모든 신규 UI 숨김 + agent-runner 신규 경로는 flag 게이트
- [x] 텔레메트리 메트릭 수집 (`auth-metrics.ts`, internal logging only, 토큰/이메일 미기록)
- [x] 도움말 문서 + 릴리즈 노트 작성 ([user-guides/subscription-login.md](../user-guides/subscription-login.md), [release-notes.md](release-notes.md))
- [ ] dogfooding 1주 통과 + 알파 5명 통과 *(운영 단계 — §2.1 롤아웃 진행 시 체크)*

> **구현 메모**: ToS 동의는 `config.chatgptPlusTosAckAt`(epoch ms)에 저장 (문서의 `config.tos.chatgpt_plus_oauth_acknowledged_at`을 평탄화). 인증 상태 인디케이터는 구독 방식(oauth/cli-delegate)에서만 표시. 인디케이터·패널 모두 `subscriptionLoginFeatureFlags.enabled` 게이트.
