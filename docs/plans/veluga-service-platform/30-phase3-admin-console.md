# 30 — Phase 3: Admin Console

> 목표 한 줄: 도입 관리자가 사용자, 그룹, 좌석, 정책, 할당량, 배포 채널을 운영하는 web admin을 만든다.

---

## 1. 범위

**In scope**

- Web admin app.
- Desktop settings의 admin entry.
- Tenant/user/group/role/seat 관리.
- Policy template과 group/user override 관리.
- Veluga master catalog 기반 model allowlist 관리.
- B2B/B2G 폐쇄망용 tenant custom provider route 등록/승인 관리.
- Quota 설정 UI.
- Audit 조회와 export.
- Desktop download channel/minimum version 관리.

**Out of scope**

- 결제/세금계산서 상세.
- 외부 기관 KB storage 자체 운영.
- quota enforcement engine의 gateway-side 구현(Phase 4).

---

## 2. 패키지 배치

| 패키지 | 역할 |
|---|---|
| `packages/admin-web` (신규) | React + Vite admin UI |
| `packages/service-api` | admin REST/JSON API |
| `packages/service-client` | admin/desktop 공용 client |
| `packages/shared-types` | admin DTO, role, quota, audit event 타입 |

Admin UI는 operational tool이므로 marketing page를 만들지 않는다. 첫 화면은 조직 dashboard와 주요 관리 표면이다.

---

## 3. 관리자 역할

| Role | 권한 |
|---|---|
| `owner` | tenant 모든 설정, owner 지정, billing placeholder |
| `admin` | 사용자/그룹/좌석/정책/할당량 관리 |
| `billing_admin` | 사용량/계약/seat 현황 조회, quota 변경 요청 |
| `auditor` | audit 조회/export only |
| `member` | admin 접근 불가 |

모든 admin API는 service-side RBAC에서 차단한다. UI 숨김은 보조 수단이다.

---

## 4. 화면 구성

| 화면 | 기능 |
|---|---|
| Overview | 활성 사용자, seat 사용, quota 소진, 최근 정책 변경, desktop version 분포 |
| Users | 초대, 비활성화, role, group assignment, seat assignment |
| Groups | group 생성, 멤버, 기본 policy, model access, KB scope |
| Quotas | org/group/user quota template, reset cycle, overage behavior |
| Policies | PolicyContext preview, Veluga Mode default, tool/skill/connector 접근 |
| Models | Veluga 제공 모델 catalog, tenant/group/user allowlist, custom provider route, default model, thinking level 제한 |
| Downloads | stable/beta/internal channel, minimum version, release note, platform별 artifact |
| Audit | admin 변경 이력, user session events, export |
| Settings | tenant profile, SSO/OIDC/SAML 설정, on-prem gateway endpoint |

---

## 5. Admin API 초안

| Method | Path | 책임 |
|---|---|---|
| `GET` | `/v1/admin/overview` | tenant 운영 요약 |
| `GET/POST` | `/v1/admin/users` | 사용자 조회/초대 |
| `PATCH` | `/v1/admin/users/:id` | role/status/name 변경 |
| `GET/POST` | `/v1/admin/groups` | 그룹 조회/생성 |
| `PATCH` | `/v1/admin/groups/:id` | 그룹 정책/멤버 변경 |
| `GET/PUT` | `/v1/admin/seats` | seat assignment |
| `GET/PUT` | `/v1/admin/quotas` | quota template 관리 |
| `GET/PUT` | `/v1/admin/models/allowlist` | Veluga 제공 모델 중 tenant/group/user 허용 목록 관리 |
| `POST` | `/v1/admin/models/preview` | 특정 사용자에게 실제 노출될 모델 목록 preview |
| `GET/POST` | `/v1/admin/model-routes` | tenant custom/on-prem provider route 조회/등록 |
| `PATCH` | `/v1/admin/model-routes/:id` | route 상태, credential rotation, health check 설정 |
| `GET/PUT` | `/v1/admin/policies` | policy template 관리 |
| `GET` | `/v1/admin/audit` | audit 검색 |
| `GET/PUT` | `/v1/admin/downloads/channels` | channel/min version 관리 |

쓰기 API는 모두 idempotency key와 audit event를 요구한다.

---

## 6. PolicyContext preview

Admin이 group/user 정책을 바꿀 때 실제 사용자가 받을 `PolicyContext`를 preview할 수 있어야 한다.

```
Admin change draft
  → service-api /v1/admin/policies/preview
  → policy-service mergePolicies(...)
  → effective PolicyContextSnapshot 반환
  → UI가 변경 전/후 diff 표시
```

Preview에는 `active_skill_ids`, `active_kb_scopes`, `active_mcp_connectors`, `veluga.policy_guard_mode`, quota summary가 포함된다.

---

## 7. Model allowlist 요구

Admin은 일반 사용자처럼 desktop에서 임의 provider endpoint나 model id를 직접 추가하지 않는다. Admin은 Veluga master catalog에서 모델을 선택해 tenant, group, user allowlist를 구성한다. B2B/B2G 폐쇄망에서 custom provider가 필요하면 admin/operator 권한으로 route를 등록하고, 등록된 route를 catalog item으로 만든 뒤 allowlist에 포함한다.

필수 규칙:

- provider별 모델 그룹을 표시하되 목록은 Veluga catalog에서만 온다.
- tenant default model은 tenant allowlist 안에서만 선택 가능하다.
- group/user override는 상위 tenant allowlist를 넓힐 수 없고 좁힐 수만 있다.
- deprecated model은 새 default로 지정할 수 없다.
- on-prem local/custom model은 Veluga/on-prem operator가 service catalog에 route를 등록한 뒤 admin allowlist에서 선택한다.
- custom provider endpoint와 credential은 admin/operator route 관리 화면과 gateway에만 존재하고 일반 desktop 사용자에게 노출되지 않는다.
- subscription-login/BYO 모델 사용은 기본 OFF이며 admin policy가 허용한 사용자에게만 노출한다.

---

## 8. Audit 요구

모든 admin 변경은 append-only event로 남긴다.

```ts
export interface AdminAuditEvent {
  id: string;
  tenantId: string;
  actorUserId: string;
  eventType:
    | 'admin.user.invited'
    | 'admin.user.disabled'
    | 'admin.group.updated'
    | 'admin.model_allowlist.updated'
    | 'admin.model_route.updated'
    | 'admin.quota.updated'
    | 'admin.policy.updated'
    | 'admin.download_channel.updated';
  targetType:
    | 'user'
    | 'group'
    | 'quota'
    | 'policy'
    | 'model_allowlist'
    | 'model_route'
    | 'download_channel';
  targetId: string;
  beforeHash?: string;
  afterHash: string;
  createdAt: string;
}
```

Audit export는 tenant admin이 아닌 auditor/owner 권한에서만 허용한다.

---

## 9. 검증

- RBAC unit test: member는 admin API 전체 거부, auditor는 write 거부.
- Group policy preview test: group 변경이 expected `PolicyContext` diff로 나타남.
- Model allowlist test: group/user override가 tenant allowlist를 넓히지 못함.
- Custom route test: admin/operator가 등록한 custom provider route가 catalog item과 bootstrap available model로 이어짐.
- Model preview test: 특정 사용자에게 표시될 provider별 모델 목록이 bootstrap 결과와 일치.
- User lifecycle integration test: invite → active → group assign → seat assign → desktop bootstrap 반영.
- Audit test: 모든 admin write가 audit event를 생성.
- Admin UI Playwright smoke: Users/Groups/Quotas/Downloads 주요 CRUD 흐름.

---

## 10. 완료 조건

- 관리자가 사용자/그룹/좌석/정책/할당량을 web admin에서 변경할 수 있음.
- 관리자가 Veluga 제공 모델 중에서만 tenant/group/user 허용 목록을 관리할 수 있음.
- 관리자가 B2B/B2G 폐쇄망용 custom provider route를 등록하고 catalog item으로 배포할 수 있음.
- 변경 사항이 service bootstrap과 `PolicyContext`에 반영됨.
- admin write API가 모두 RBAC와 audit를 통과함.
- desktop settings에서 admin 권한 사용자만 admin console 진입점을 볼 수 있음.
