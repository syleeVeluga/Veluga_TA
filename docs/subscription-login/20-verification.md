# 20 — 검증 방법

본 문서는 Phase 1~5 각 단계와 전체 통합의 **검증 매트릭스**를 정리한다.

---

## 1. 자동화 테스트

### 1.1 단위 테스트 (Unit)

| 모듈 | 파일 | 핵심 케이스 |
|---|---|---|
| `config-store` migrations | `config-store.migrations.test.ts` | v3→v4 마이그레이션, `authMethod: 'apikey'` 자동 부여, round-trip 무손실 |
| `auth-utils` | `auth-utils.test.ts` | `getEffectiveCredential` 분기별 동작, `isOAuthExpiringSoon` 경계값 |
| `oauth-callback-server` | `oauth-callback-server.test.ts` | port=0 정상, state mismatch reject, 5분 타임아웃, 동시 flow 거부 |
| `oauth-providers/chatgpt-codex` | `chatgpt-codex.test.ts` | PKCE 형식, authorize URL 파라미터, token exchange/refresh (mock fetch) |
| `oauth-manager` | `oauth-manager.test.ts` | e2e flow (mock callback + mock fetch), refresh 임박 갱신, 동시 호출 mutex |
| `claude-cli-detector` | `claude-cli-detector.test.ts` | 미설치/설치/미인증 3가지 상태, 5초 타임아웃 |
| `claude-cli-runner` | `claude-cli-runner.test.ts` | mock subprocess, stream-json 파싱, 부분 chunk, cancel SIGTERM→SIGKILL |
| `agent-runner` (회귀) | `agent-runner.auth-branching.test.ts` | authMethod별 분기, 기존 apikey 경로 회귀 0 |

### 1.2 통합 테스트 (Integration)

| 시나리오 | 검증 |
|---|---|
| OAuth 전체 flow (mock) | 로컬 mock OAuth server를 띄워 startFlow → callback → 저장까지 한 번에 |
| Refresh 타이밍 | `expiresAt`을 강제로 30초 후로 설정 → 채팅 호출 → refresh 발동 확인 |
| Sign out → 재인증 | credentials 삭제 → 채팅 시도 → 에러 → 재로그인 → 정상 |
| Feature flag OFF | OAuth IPC 호출 시 `error: feature disabled` |
| 멀티 프로필 | apikey 프로필과 oauth 프로필을 번갈아 활성화 → 토큰/키 격리 |

### 1.3 회귀 가드 (Regression Guards)

기존 API key 사용자에 대한 0의 영향을 보장:

| 가드 | 방법 |
|---|---|
| 기존 채팅 회귀 | 기존 e2e 테스트가 변경 없이 통과 |
| config 파일 호환 | v3 샘플 파일을 v4로 마이그레이션 후 다시 v3 형태로 reverse-mapping해서 비교 (extra 필드 외 동일) |
| `setRuntimeApiKey` 호출 시그니처 | apikey 경로에서 함수 호출 인자가 변하지 않음 (snapshot test) |
| 로그 출력 | 토큰 dump 발생 0회 (`grep -E 'sk-[A-Za-z]{20,}|eyJ[A-Za-z0-9_]+'` 결과 0) |

---

## 2. 수동 종단 테스트 (Manual E2E)

### 2.1 ChatGPT Plus 시나리오

**준비**: 실제 ChatGPT Plus 계정, 깨끗한 Veluga 빌드 (config 초기 상태)

| # | 단계 | 기대 결과 |
|---|---|---|
| 1 | 설정 → OpenAI provider → "ChatGPT Plus 로그인" 선택 | ToS 고지 dialog 표시 |
| 2 | 동의 후 [ChatGPT Plus 로그인] 클릭 | 시스템 브라우저 열림, OpenAI 인증 페이지 표시 |
| 3 | 브라우저에서 로그인 | 콜백 페이지 "로그인 완료" 표시, Veluga UI에 "로그인됨" 상태 |
| 4 | 채팅 시작 → "안녕" | 정상 응답 |
| 5 | 약 30분 후 다시 채팅 (또는 expiresAt 강제 조작) | refresh 자동 발동, 채팅 정상 |
| 6 | 로그아웃 | credentials 삭제, apikey 모드로 복귀 |
| 7 | 다시 로그인 → 다른 ChatGPT Plus 계정 | 새 토큰으로 정상 동작, 이전 토큰 잔존 0 |

### 2.2 Claude Pro CLI 시나리오

**준비**: Claude Code CLI 설치(또는 미설치 상태)

| # | 단계 | 기대 결과 |
|---|---|---|
| 1 | (CLI 미설치 상태) 설정 → Anthropic → "Claude Pro" 선택 | "Claude Code CLI 미설치" UI + 설치 안내 링크 |
| 2 | 안내대로 CLI 설치 → "다시 확인" | "v1.2.3 감지됨, 미인증" UI |
| 3 | 터미널에서 `claude /login` 실행 → 다시 확인 | "준비 완료" UI |
| 4 | 채팅 시작 → "안녕" | Claude Code CLI를 통해 응답 |
| 5 | 채팅 중 cancel 버튼 | 즉시 중단 (subprocess kill 확인) |
| 6 | 터미널에서 `claude /logout` → Veluga에서 채팅 시도 | 명확한 에러 메시지 |
| 7 | Tool use 요청 (예: "파일 읽어줘") | UI에서 도구 미지원 안내 |

### 2.3 공존 시나리오

| # | 단계 | 기대 결과 |
|---|---|---|
| 1 | OpenAI 프로필 A (apikey), B (oauth) 동시 생성 | 두 프로필 독립 저장 |
| 2 | A → B → A 전환하면서 채팅 | 각각 자신의 자격증명으로 호출 |
| 3 | A 프로필 export (UI 기능 있다면) | apikey 포함, oauth 토큰은 제외 (보안) |
| 4 | feature flag OFF | B 프로필 비활성화, UI에서 숨김, A는 그대로 |

### 2.4 보안 시나리오

| # | 단계 | 기대 결과 |
|---|---|---|
| 1 | OAuth flow 중 `~/Library/Logs/Veluga/*.log` (또는 OS별 로그) 확인 | access_token, refresh_token, JWT 본문 0건 |
| 2 | renderer DevTools에서 `window.veluga.auth.getStatus()` 호출 | 응답에 accessToken 키 없음 |
| 3 | electron-store 파일 직접 열람 | OAuth credentials 영역이 암호화되어 있음 (평문 아님) |
| 4 | 잘못된 state로 콜백 호출 (curl로 직접 시도) | 400 응답 + flow reject |
| 5 | OAuth flow 중 다른 OAuth flow 시작 시도 | "another flow in progress" 에러 |

---

## 3. 관측성 (Observability)

### 3.1 로그 레벨

| 레벨 | 사용 |
|---|---|
| `info` | flow 시작, 완료, refresh 성공 (토큰값 마스킹) |
| `warn` | refresh 실패 후 재시도, 타임아웃 임박 |
| `error` | flow 실패, state mismatch, refresh 최종 실패 |
| `debug` | (개발 빌드만) URL 생성, 응답 status code |

### 3.2 메트릭 대시보드

(텔레메트리 SaaS 금지 — [agent-orchestration-plan §하드제약](../agent-orchestration-plan/00-overview.md) 따라 internal only)

수집 메트릭은 [14-phase5-ui-and-rollout.md §2.3](14-phase5-ui-and-rollout.md#23-메트릭) 참조.

---

## 4. 리스크 모니터링 (Post-Launch)

| 모니터 항목 | 측정 주기 | 임계값 | 대응 |
|---|---|---|---|
| OpenAI OAuth 401/403 비율 | 1시간 | >10% | flag OFF + 사용자 알림 |
| ChatGPT 응답 latency p95 | 1시간 | baseline +50% | 조사 |
| Refresh 실패율 | 1일 | >5% | 디버그 |
| Claude CLI 호출 에러율 | 1일 | >10% | CLI 버전 매트릭스 확인 |
| 토큰 dump 발견 | 매 PR | 0건 | 즉시 incident |

---

## 5. 회귀 방지 체크리스트 (PR Template)

본 폴더의 작업과 관련된 PR을 머지하기 전에 작성자가 확인:

- [ ] `pnpm test` (또는 프로젝트 표준) 0 실패
- [ ] `tsc --noEmit` 0 에러
- [ ] 새 OAuth/CLI 코드에 단위 테스트 추가
- [ ] 토큰 redaction 패턴이 새 로그문에 적용됨
- [ ] feature flag 가드가 모든 신규 진입점에 있음
- [ ] 기존 API key 사용자 경로 무변화 (수동 확인)
- [ ] 문서 업데이트 (README.md 적용 상태 체크박스 갱신)

---

## 6. 종단 검증 시나리오 (Final QA)

Phase 5 일반 출시 직전 1회 수행:

1. 깨끗한 macOS / Windows / Linux 빌드 3개 환경에서 각각:
   - ChatGPT Plus 로그인 → 채팅 → 24시간 후 자동 refresh → 채팅 → 로그아웃
   - Claude Code CLI 설치 → 위임 모드 → 채팅 → CLI 업데이트 → 채팅 (호환성 확인)
   - 두 모드 + 기존 API key 모드 공존, 빠른 전환 5회
2. 빌드 산출물 디스크 inspector로 토큰 평문 grep → 0건
3. 네트워크 패킷 캡쳐(개발자 도구 또는 mitmproxy)로 의도하지 않은 endpoint 호출 0건
