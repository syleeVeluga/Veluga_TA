# 50 — 검증 & 롤아웃

> 목표 한 줄: service platform이 desktop, admin, gateway, attribution 요구를 모두 만족하는지 단계적으로 검증하고 배포한다.

---

## 1. 검증 레이어

| 레이어 | 검증 |
|---|---|
| Shared types | `PolicyContext`, membership, entitlement, quota schema unit test |
| Service API | auth/bootstrap/admin/quota contract integration test |
| Desktop | account login, bootstrap sync, managed model catalog, managed gateway session, sign-out regression |
| Admin web | Users/Groups/Quotas/Downloads CRUD Playwright smoke |
| Gateway | token validation, model allowlist validation, quota preflight, usage commit, provider call redaction |
| Security | token not in renderer, public LLM endpoint direct call 금지, OSS license 보존 |
| Packaging | signed installer, channel manifest, minimum version, closed-network profile |

---

## 2. 필수 회귀

- Veluga account mode OFF + 기존 API key config로 세션 시작.
- subscription-login 계획 경로와 managed account mode의 설정 충돌 없음.
- managed account mode에서 Veluga catalog 밖 모델 선택 불가.
- managed account mode에서 일반 사용자 API key/Base URL/직접 custom/Ollama/provider visibility 표면 숨김.
- B2B/B2G 폐쇄망 profile에서 admin/operator custom provider route가 catalog item으로 노출됨.
- `enable_veluga_orchestration=false`에서 vanilla Cowork path 유지.
- `packages/cowork-core/LICENSE` 보존.
- `docs/upstream-base.md`와 credits/license 산출물 존재.
- quota denied, entitlement denied, auth expired, network down 오류가 서로 구분됨.

---

## 3. Staged rollout

| 단계 | 대상 | 목적 |
|---|---|---|
| Internal alpha | Veluga 내부 계정, internal channel | login/bootstrap/gateway token 검증 |
| Design partner beta | 1~2개 tenant, beta channel | admin user/group/quota 운영 검증 |
| Controlled GA | stable channel, seat 제한 | quota enforcement와 support workflow 검증 |
| On-prem pilot | 폐쇄망 고객 1곳 | hosted API 없이 같은 contract 동작 검증 |

각 단계는 rollback channel과 minimum version 정책을 먼저 준비한 뒤 진행한다.

---

## 4. 운영 runbook 초안

- 사용자가 로그인 불가: auth status, tenant membership, seat assignment 확인.
- 다운로드 불가: entitlement download channel, platform artifact, signed URL 만료 확인.
- gateway 호출 실패: service token 만료, quota exceeded, provider outage 구분.
- quota 민원: user/group/tenant current cycle usage와 admin audit 변경 이력 확인.
- admin 변경 사고: audit event로 actor/target/diff 확인 후 이전 policy template 복구.
- closed-network 배포: update check off, offline package import, on-prem gateway endpoint 검증.
- custom provider route 장애: route health, credential 만료, gateway reachability, allowlist 상태 확인.

---

## 5. Definition of Done

- Service API contract와 shared type이 문서/테스트/구현에서 일치한다.
- Veluga account login만으로 managed gateway 세션이 동작한다.
- 사용자는 Veluga가 제공하고 admin이 허용한 모델만 provider별로 사용할 수 있다.
- B2B/B2G 폐쇄망에서는 custom provider가 admin/operator-managed catalog route로 제공된다.
- admin console에서 사용자/그룹/좌석/할당량/정책을 운영할 수 있다.
- quota enforcement가 gateway/server-side에서 집행된다.
- Open Cowork MIT attribution이 문서, credits, 배포 산출물에 남아 있다.
- hosted와 on-prem deployment profile이 같은 핵심 contract test를 통과한다.
- `npm run verify`와 package별 targeted tests가 통과한다.
