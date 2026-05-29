# Subscription Login 도입 계획 — ChatGPT Plus + Claude Pro

> Status: **설계 단계 (초안)** · 최종 개정 2026-05-29
> Scope: 데스크탑 앱(Electron)에서 OpenAI/Anthropic의 **구독 계정 로그인**을 도입하여 API key 없이 사용 가능하도록 함
> 확정 결정(사용자 합의): ChatGPT Plus(OAuth PKCE) + Claude Pro(Claude Code CLI 위임)만 도입 · Gemini v1internal **제외** · 기존 API key 방식과 **공존** · ToS **보수적**(공식/묵인 방식만) · 기존 `store-encryption.ts` 재사용

이 폴더는 [aaif-goose/goose](https://github.com/aaif-goose/goose)의 subscription login 패턴을 우리 프로젝트에 적용하는 단계별 구현 계획이다.

---

## 문서 구성 (읽는 순서)

| # | 문서 | 내용 |
|---|---|---|
| 00 | [개요 (Overview)](00-overview.md) | 목적·문제 정의·결정 사항·현재 vs 목표 상태·하드 제약 |
| 01 | [배경 & 조사](01-background-research.md) | goose의 ChatGPT/Claude/Gemini OAuth 분석 + pi-ai OAuth 지원 발견 |
| 02 | [아키텍처](02-architecture.md) | 통합 지점·데이터 흐름·타입 모델·암호화 저장소 재사용 |
| 10 | [Phase 1 — pi-ai OAuth 검증 스파이크](10-phase1-spike-validation.md) | pi-ai의 `openai-codex` OAuth provider 실동작 검증 (반나절) |
| 11 | [Phase 2 — 타입 확장 & IPC 골격](11-phase2-types-and-ipc.md) | `ProviderProfile.authMethod` 추가·IPC 핸들러 스텁·설정 UI 라우팅 |
| 12 | [Phase 3 — ChatGPT Plus OAuth](12-phase3-chatgpt-plus-oauth.md) | `oauth-manager.ts` 구현·콜백 서버·토큰 갱신·agent-runner 통합 |
| 13 | [Phase 4 — Claude Pro CLI 위임](13-phase4-claude-pro-cli-delegate.md) | Claude Code CLI 탐지·subprocess 위임·chat-only MVP |
| 14 | [Phase 5 — UI & 롤아웃](14-phase5-ui-and-rollout.md) | 설정 화면·OAuth 진행 UI·ToS 고지 dialog·점진적 배포 |
| 20 | [검증 방법](20-verification.md) | 자동/수동 테스트 매트릭스·종단 시나리오·리스크 모니터링 |
| 30 | [보안 & ToS](30-security-and-tos.md) | 토큰 저장 정책·로깅 가드·ToS 회색지대 대응·차단 시 fallback |

---

## 핵심 전제 (반드시 준수)

1. **기존 API key 방식 절대 제거 금지** — `authMethod: 'apikey' | 'oauth' | 'cli-delegate'` 분기로 공존
2. **pi-ai/pi-coding-agent는 수정 금지** — upstream fork 정책을 따라 외부에서 `AuthStorage.setRuntimeApiKey()` API만 활용 (참조: [agent-orchestration-plan](../agent-orchestration-plan/README.md) §핵심 전제 1)
3. **Gemini는 도입하지 않음** — `v1internal` endpoint는 ToS 회색지대를 넘어섬
4. **토큰은 절대 로그에 출력 금지** — `access_token`, `refresh_token`, JWT 모두 마스킹
5. **ToS 고지 의무** — 첫 OAuth 사용 시 dialog로 비공식 endpoint 사용 사실 명시
6. **킬스위치** — OAuth/CLI 위임 방식 모두 설정에서 즉시 끄고 API key로 복귀 가능해야 함

자세한 근거는 [00-overview.md](00-overview.md) §하드 제약 참조.

---

## 적용 상태

- [x] **Phase 0** — 본 계획 문서화 (이 폴더)
- [x] **Phase 1** — pi-ai OAuth 스파이크 (자동 검증 완료, live account E2E는 Final QA)
- [x] **Phase 2** — 타입/IPC 골격
- [x] **Phase 3** — ChatGPT Plus OAuth
- [x] **Phase 4** — Claude Pro CLI 위임 (chat-only MVP)
- [x] **Phase 5** — UI & 롤아웃 (UI/텔레메트리/문서 구현 완료, 단계적 flag ON은 운영 작업)

> 모든 phase는 feature flag(`subscription_login.enabled`) 뒤에서 작업하며, 기본값은 OFF. Phase 5에서 dogfooding 통과 후 점진 ON.
