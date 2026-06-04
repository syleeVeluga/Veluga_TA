# Veluga Service Platform 도입 계획

> Status: **설계 단계 (초안)** · 최종 개정 2026-06-03
> Scope: Veluga 계정 인증 기반 desktop 배포, 서비스 entitlement, 관리자 콘솔, 사용자/그룹/할당량 운영
> 기준 브랜치: `main` (`229ca7e` 기준 검토)

이 폴더는 기존 Open Cowork clone snapshot 기반 desktop 앱을 **Veluga 자체 서비스**로 운영하기 위한 단계별 구현 계획이다.

기존 [subscription-login](../subscription-login/README.md)은 사용자가 개인 ChatGPT Plus 또는 Claude Pro 구독을 가져오는 기능이다. 이 계획은 Veluga 계정 보유자가 signed desktop 앱을 다운로드하고, Veluga 서비스가 사용자 권한·조직 정책·할당량·LLM gateway 접근을 내려주는 제품화 계층을 다룬다.

---

## 문서 구성 (읽는 순서)

| # | 문서 | 내용 |
|---|---|---|
| 00 | [개요 (Overview)](00-overview.md) | 현재 main 상태, 목표 상태, 하드 제약, 전체 토폴로지 |
| 10 | [Phase 1 — Service Foundation](10-phase1-service-foundation.md) | 계정·tenant·entitlement·download channel·service API 골격 |
| 20 | [Phase 2 — Desktop Account Client](20-phase2-desktop-account-client.md) | desktop 로그인, entitlement sync, managed gateway profile, 배포/업데이트 |
| 25 | [Managed Model Catalog & Surface Cleanup](25-managed-model-catalog-and-surface-cleanup.md) | Veluga 제공 모델만 provider별 노출 + local/provider 설정 표면 정리 |
| 30 | [Phase 3 — Admin Console](30-phase3-admin-console.md) | web admin + desktop admin entry, 사용자·그룹·좌석·정책 관리 |
| 40 | [Phase 4 — Quota & Usage Enforcement](40-phase4-quota-usage-enforcement.md) | gateway 사용량 계측, quota enforcement, policy/admin 연동 |
| 50 | [검증 & 롤아웃](50-verification-and-rollout.md) | 테스트 매트릭스, 보안 검증, staged rollout, DoD |

---

## 핵심 전제

1. **Open Cowork 사용 사실은 숨기지 않는다.** 앱은 Veluga로 브랜딩하되, credits/license 문서와 OSS 고지에는 Open Cowork(MIT) clone snapshot 사용 사실을 명확히 남긴다.
2. **`packages/cowork-core`는 vendored clone snapshot으로 취급한다.** 서비스 계층은 가능한 한 `packages/veluga-*`, `packages/policy-service`, 신규 backend/admin 패키지에서 붙인다.
3. **Veluga account 인증은 OpenAI/Anthropic 계정 인증과 별개다.** 개인 구독 로그인은 선택 기능이고, Veluga 서비스 도입 고객은 Veluga entitlement와 gateway token으로 사용한다.
4. **모델 목록은 Veluga 제공 catalog만 쓴다.** B2B/B2G 폐쇄망의 custom provider도 tenant/operator가 catalog route로 등록한 뒤 제공한다. managed tenant의 일반 사용자는 임의 provider, 임의 model id, 임의 base URL을 직접 추가할 수 없다.
5. **할당량은 desktop이 아니라 서버/gateway에서 강제한다.** desktop 표시는 UX 보조일 뿐이며, quota 우회 방지는 service API와 LLM gateway가 책임진다.
6. **폐쇄망 고객을 버리지 않는다.** connected SaaS형과 on-prem/admin backend형을 같은 계약으로 지원하되, public LLM endpoint 직접 호출 금지 원칙은 유지한다.

---

## 적용 상태

- [x] **Phase 0** — 현재 main 검토 + 계획 문서 초안 작성
- [ ] **Phase 1** — Service Foundation
- [ ] **Phase 2** — Desktop Account Client
- [ ] **Phase 2.5** — Managed Model Catalog & Surface Cleanup
- [ ] **Phase 3** — Admin Console
- [ ] **Phase 4** — Quota & Usage Enforcement
- [ ] **Phase 5** — 검증, 배포 채널, 운영 runbook

---

## AI 코딩 에이전트 작업 순서

이 폴더를 구현 계약으로 사용할 때는 다음 순서로 진행한다.

1. `00-overview.md`의 현재 main 확인 사항과 하드 제약을 먼저 검증한다.
2. `10-phase1-service-foundation.md`의 shared type과 service API contract를 구현한다.
3. `docs/base-snapshot.md`와 Open Cowork attribution baseline을 먼저 복구한다.
4. Desktop 구현은 `20-phase2-desktop-account-client.md`를 따르되, 모델 목록은 `25-managed-model-catalog-and-surface-cleanup.md`의 catalog contract를 정본으로 삼는다.
5. Admin 구현은 `30-phase3-admin-console.md`를 따르며, custom provider route는 일반 사용자 설정이 아니라 admin/operator 관리 기능으로 구현한다.
6. Gateway와 quota 구현은 `40-phase4-quota-usage-enforcement.md`를 따르며, quota보다 먼저 model id/catalog/allowlist를 검증한다.
7. 검증과 롤아웃은 `50-verification-and-rollout.md`의 회귀 목록을 체크리스트로 사용한다.

Phase 2, 2.5, 3은 Phase 1의 shared type과 API schema가 고정된 뒤 병렬화할 수 있다. Phase 4는 gateway route table, model allowlist, usage ledger contract가 모두 준비된 뒤 시작한다.
