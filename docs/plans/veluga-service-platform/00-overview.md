# 00 — 개요 (Overview)

> 상위 인덱스: [README.md](README.md)

---

## 1. 문제 정의

현재 `main`의 Veluga는 Open Cowork clone snapshot을 기반으로 한 desktop 앱, Veluga 정책/감사/LLM gateway 패키지, 그리고 subscription login 계획을 갖고 있다. 그러나 OpenAI Codex 또는 Anthropic Claude Code desktop처럼 **Veluga 계정 보유자가 앱을 다운로드하고 로그인해서 쓰는 서비스 운영 계층**은 아직 별도 구현 계획이 없다.

또한 도입 기관의 관리자가 사용자, 그룹, 좌석, 할당량, 정책, 감사, 배포 채널을 운영하는 **관리자 콘솔**도 현재 `policy-service` mock/YAML 흐름과 분리된 제품 계획이 필요하다.

---

## 2. 현재 main 기준 확인 사항

| 영역 | 현재 상태 | 이 계획에서의 의미 |
|---|---|---|
| Open Cowork attribution | `packages/cowork-core/LICENSE` 존재, `README.md`가 Open Cowork MIT clone snapshot을 명시 | credits/license/upstream 기록은 제품화 선행 조건 |
| Upstream snapshot 기록 | `README.md`는 `docs/upstream-base.md`를 언급하지만 현재 파일은 없음 | Phase 1에서 attribution baseline으로 복구 또는 신규 작성 필요 |
| Desktop packaging | `packages/cowork-core/electron-builder.yml`의 `productName`은 `Veluga` | 계정 기반 download/update channel을 얹을 수 있음 |
| Auth config | `ConfigStore`는 API key/baseUrl/model 중심 local 설정 | Veluga managed account profile이 별도로 필요 |
| Model UI | model switcher와 Settings API는 hardcoded provider preset, pi-ai registry overlay, 사용자 provider visibility에 의존 | managed mode에서는 Veluga service catalog가 모델 정본이어야 함 |
| Subscription login | `docs/plans/subscription-login/`은 개인 ChatGPT Plus/Claude Pro 경로 | Veluga service account와 혼동 금지 |
| Policy service | `MockPolicyService`, `InternalSsoProvider`, YAML merge 중심 | 중앙 service API로 확장해야 함 |
| PolicyContext | `Identity`에는 `group_ids?`가 있으나 `PolicyContext.user`에는 없음 | admin group 정책 적용 전 shared type 확장 필요 |
| Quota | `kb_token_budget` 외 서비스 사용량/좌석 quota 모델 없음 | usage ledger와 gateway enforcement가 신규 필요 |
| LLM gateway | `packages/veluga-main/src/llm-gateway.ts`가 `VELUGA_LLM_GATEWAY_URL`을 강제 | Veluga service quota enforcement의 핵심 결합점 |

---

## 3. 목표 상태

### 3.1 Desktop 사용자 경험

Veluga 계정 인증자가 웹에서 signed installer를 다운로드하고 desktop을 실행한다. 첫 실행 시 Veluga 계정으로 로그인하면 service API가 다음을 내려준다.

- 사용자 identity와 org/tenant membership
- Veluga가 제공하고 tenant/admin policy가 허용한 provider별 모델 목록
- gateway URL, short-lived gateway token
- seat/entitlement 상태
- 개인·그룹·조직 정책에서 계산된 `PolicyContext`
- 현재 사용량과 남은 할당량
- enabled feature flags와 download/update channel

사용자는 API key를 몰라도 Veluga managed gateway를 통해 작업한다. 모델 선택은 provider별로 보이지만 목록은 Veluga service catalog에서 내려온 항목으로 제한한다. B2B/B2G 폐쇄망에서 제공되는 custom provider는 일반 사용자가 직접 입력하는 endpoint가 아니라 tenant admin 또는 on-prem operator가 catalog route로 등록한 모델로 노출한다. 기존 API key 방식과 subscription-login 방식은 개발자/개인 모드 또는 admin이 허용한 BYO 모드로 남긴다.

### 3.2 관리자 경험

도입 관리자는 web admin 또는 desktop settings의 admin entry에서 다음을 관리한다.

- 조직/tenant 기본 설정
- 사용자 초대, 비활성화, 역할, 그룹
- seat assignment와 라이선스 상태
- 사용자/그룹/조직별 월간/일간 quota
- 모델 접근 권한, thinking level 제한, tool/skill/connector 정책
- KB scope와 MCP connector 활성화
- 감사 로그 조회와 export
- desktop download channel, minimum version, kill switch

---

## 4. 전체 토폴로지

```
┌──────────────────────────────┐
│ Veluga Web                   │
│ - Download portal            │
│ - Admin console              │
└──────────────┬───────────────┘
               │ HTTPS
               ▼
┌──────────────────────────────┐
│ Veluga Service API            │
│ - Auth / session              │
│ - Tenant / user / group       │
│ - Entitlement / seat          │
│ - Policy resolver             │
│ - Usage ledger                │
│ - Model catalog               │
│ - Download manifest           │
└───────┬──────────────┬───────┘
        │              │
        │ policy       │ quota token / usage event
        ▼              ▼
┌──────────────────┐  ┌──────────────────────────────┐
│ Veluga Desktop   │  │ Veluga LLM Gateway            │
│ Electron Main    │  │ - provider routing            │
│ - account login  │  │ - quota enforcement           │
│ - entitlement    │  │ - audit usage emission        │
│ - PolicyContext  │  └──────────────────────────────┘
└──────────────────┘
```

폐쇄망 고객은 같은 계약을 on-prem Service API + on-prem LLM Gateway로 배포한다. connected SaaS형은 Veluga hosted Service API를 사용한다.

---

## 5. 하드 제약

1. **Open Cowork MIT 고지 유지**: `packages/cowork-core/LICENSE` 보존, credits/license 화면, OSS 문서, upstream snapshot 문서를 제품화 작업의 필수 산출물로 둔다.
2. **public LLM endpoint 직접 호출 금지**: Veluga managed 계정 모드에서는 desktop이 `api.openai.com` 또는 `api.anthropic.com`으로 직접 나가지 않는다. gateway가 모든 provider 호출을 소유한다.
3. **Veluga 제공 모델만 허용**: managed mode의 model catalog는 service API가 내려준 목록만 사용한다. Desktop의 hardcoded preset, pi-ai registry overlay, 사용자 직접 custom model input은 local/dev fallback일 뿐이다. Tenant/operator-managed custom provider route는 catalog의 정식 공급원이다.
4. **desktop quota 신뢰 금지**: 사용량 차감과 차단은 gateway/service API가 결정한다. Renderer와 local config는 표시와 사전 경고만 담당한다.
5. **관리자 정책은 `PolicyContext`로 수렴**: admin console이 만든 그룹/사용자 정책은 기존 5-tier merge 규칙을 확장해 session 시작 전 계산한다.
6. **Veluga Mode OFF 회귀 보장**: service 계층을 붙여도 `enable_veluga_orchestration=false`에서 vanilla Cowork 경로가 깨지지 않아야 한다.
7. **기존 API key/subscription-login 삭제 금지, managed 기본 UX에서는 숨김**: local/dev 또는 admin 허용 BYO 모드에서는 보존하되, managed tenant 일반 사용자에게는 임의 provider/API key/baseUrl 표면을 노출하지 않는다. Custom provider 설정은 admin/operator 표면으로 이동한다.
8. **토큰은 Main process 전용**: desktop service access token, refresh token, gateway token은 Electron main에서만 보관하고 renderer에는 상태 메타데이터만 전달한다.

---

## 6. 범위 밖

- 외부 기관 KB 시스템 자체 구현
- OpenAI/Anthropic 개인 구독 통합 재설계
- 결제/세금계산서/PG 연동 세부 구현
- 모바일 앱
- `packages/cowork-core`의 대규모 구조 변경
- public SaaS telemetry SDK 도입

---

## 7. 단계 의존성

```
Phase 1 Service Foundation
   ├─► Phase 2 Desktop Account Client
   ├─► Phase 2.5 Managed Model Catalog & Surface Cleanup
   ├─► Phase 3 Admin Console
   └─► Phase 4 Quota & Usage Enforcement
           └─► Phase 5 Verification & Rollout
```

Phase 2와 Phase 3은 Phase 1 API contract가 안정화된 뒤 병렬 진행 가능하다. Phase 4는 gateway와 admin quota model 양쪽에 의존한다.

---

## 8. 성공 기준

- Veluga 계정으로 로그인한 사용자가 API key 없이 managed gateway로 세션을 시작한다.
- Desktop에는 Veluga catalog와 admin allowlist가 허용한 모델만 provider별로 표시된다.
- Gateway는 catalog/allowlist 밖 모델을 provider 호출 전에 거부한다.
- 관리자가 사용자/그룹/좌석/할당량을 변경하면 다음 policy sync 또는 session 시작에 반영된다.
- quota 초과 시 gateway가 서버 측에서 차단하고 desktop UI는 명확한 오류와 관리자 문의 경로를 표시한다.
- admin console의 변경 사항은 audit log에 남고, 누가 무엇을 바꿨는지 추적 가능하다.
- Open Cowork MIT 고지와 `packages/cowork-core/LICENSE`가 배포 산출물과 문서에 보존된다.
- connected SaaS와 on-prem deployment profile 모두 같은 contract test를 통과한다.
