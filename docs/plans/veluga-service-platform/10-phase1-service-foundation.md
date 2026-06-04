# 10 — Phase 1: Service Foundation

> 목표 한 줄: Veluga 계정, tenant, entitlement, download channel, policy sync를 제공하는 최소 service API contract를 만든다.

---

## 1. 범위

**In scope**

- Veluga service identity model: `Tenant`, `User`, `Membership`, `Group`, `Role`.
- Desktop download entitlement: 계정/tenant별 channel, minimum version, allowed platforms.
- Service-issued desktop session token과 gateway token contract.
- Veluga master model catalog와 tenant model access contract.
- Tenant custom/on-prem model route contract.
- Policy service를 YAML mock에서 remote resolver contract로 확장.
- Open Cowork attribution baseline: `docs/base-snapshot.md`, credits/license 산출물 점검.

**Out of scope**

- 실제 billing/PG 연동.
- admin web UI 전체 구현.
- gateway quota enforcement의 최종 구현.
- 개인 OpenAI/Anthropic subscription-login 변경.

---

## 2. 데이터 모델 초안

```ts
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  deploymentProfile: 'hosted' | 'on-prem';
  status: 'active' | 'suspended';
}

export interface ServiceUser {
  id: string;
  email: string;
  name: string;
  status: 'invited' | 'active' | 'disabled';
}

export interface Membership {
  tenantId: string;
  userId: string;
  roles: Array<'owner' | 'admin' | 'billing_admin' | 'member' | 'auditor'>;
  groupIds: string[];
  clearance?: 'public' | 'internal' | 'confidential' | 'secret';
}

export interface Entitlement {
  tenantId: string;
  userId: string;
  seatStatus: 'assigned' | 'unassigned' | 'suspended';
  desktopAccess: boolean;
  allowedModelIds: string[];
  allowedFeatures: string[];
  downloadChannels: Array<'stable' | 'beta' | 'internal'>;
}

export interface VelugaModelCatalogItem {
  id: string;
  provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'local' | 'custom';
  displayName: string;
  routeKind: 'veluga-hosted' | 'tenant-custom' | 'on-prem-local';
  capabilities: {
    reasoning: boolean;
    vision: boolean;
    toolUse: boolean;
    streaming: boolean;
  };
  limits: {
    contextWindow: number;
    maxOutputTokens: number;
  };
  status: 'active' | 'deprecated' | 'disabled';
}

export interface ModelRoute {
  id: string;
  tenantId: string;
  catalogModelId: string;
  routeKind: 'veluga-hosted' | 'tenant-custom' | 'on-prem-local';
  providerProtocol: 'openai-compatible' | 'anthropic-compatible' | 'gemini-compatible' | 'custom';
  endpointRef: string;       // secret-bearing URL alias, not exposed to desktop users
  credentialRef: string;     // secret manager/key vault reference
  managedBy: 'veluga' | 'tenant-admin' | 'on-prem-operator';
  status: 'active' | 'disabled' | 'unhealthy';
}

export interface DesktopBootstrap {
  user: ServiceUser;
  tenant: Tenant;
  membership: Membership;
  entitlement: Entitlement;
  availableModels: VelugaModelCatalogItem[];
  defaultModelId: string;
  selectedModelId: string;
  effectivePolicy: PolicyContextSnapshot;
  gateway: {
    baseUrl: string;
    token: string;
    expiresAt: string;
  };
}
```

---

## 3. API contract 초안

| Method | Path | 책임 |
|---|---|---|
| `POST` | `/v1/auth/login/start` | browser/device login 시작 |
| `POST` | `/v1/auth/login/complete` | desktop session 발급 |
| `POST` | `/v1/auth/refresh` | short-lived access token 갱신 |
| `GET` | `/v1/me/bootstrap` | desktop 시작에 필요한 identity/policy/entitlement/gateway contract |
| `GET` | `/v1/models/catalog` | tenant가 볼 수 있는 Veluga 제공 모델 catalog |
| `GET` | `/v1/models/available` | 현재 user/group policy까지 적용된 사용 가능 모델 목록 |
| `GET` | `/v1/admin/model-routes` | tenant custom/on-prem route 목록(관리자/operator 전용) |
| `POST` | `/v1/admin/model-routes` | custom provider route 등록(관리자/operator 전용) |
| `GET` | `/v1/downloads/channels` | 사용자가 받을 수 있는 desktop channel 목록 |
| `GET` | `/v1/downloads/:channel/:platform/latest` | signed installer manifest |
| `GET` | `/v1/policies/effective` | 현재 user/tenant/project/session policy 계산 결과 |
| `POST` | `/v1/audit/client-events` | desktop side 중요 이벤트 업로드 |

MVP는 OpenAPI JSON 또는 TypeScript schema를 먼저 고정한다. 구현은 그 contract를 만족하는 service package에서 시작한다.

---

## 4. 패키지 배치

| 패키지 | 역할 |
|---|---|
| `packages/service-api` (신규) | HTTP API, auth/session, tenant/user/group/entitlement read model |
| `packages/service-client` (신규 또는 shared) | desktop/admin이 공유하는 typed API client |
| `packages/policy-service` | 기존 merge engine 유지, remote policy input adapter 추가 |
| `packages/shared-types` | `Tenant`, `Membership`, `Entitlement`, `VelugaModelCatalogItem`, `ModelRoute`, quota/policy 확장 타입 export |

`packages/policy-service`를 통째로 admin backend로 키우지 않는다. 기존 책임은 policy merge이고, service API는 계정/entitlement/admin storage를 소유한다.

---

## 5. 현재 코드 변경 포인트

| 파일/영역 | 변경 |
|---|---|
| `packages/shared-types/src/policy.ts` | `PolicyContext.user.group_ids` 추가, service membership 타입 추가 |
| `packages/shared-types/src/*` | Veluga model catalog, tenant model access, model route, selected model 타입 추가 |
| `packages/policy-service/src/merge.ts` | `Identity.group_ids`를 snapshot에 보존, group policy tier 입력 준비 |
| `packages/policy-service/src/sso/*` | mock alias 유지, real OIDC/SAML contract는 service auth로 분리 |
| `packages/veluga-main/src/policy-injector.ts` | local mock source와 remote service source를 같은 인터페이스로 받게 확장 |
| `docs/base-snapshot.md` | Open Cowork base commit, LICENSE 위치, credits 경로 기록 |

---

## 6. Attribution baseline

Phase 1 완료 전 다음을 현재 상태로 정리한다.

- `packages/cowork-core/LICENSE`가 존재하고 CI에서 삭제 차단.
- `docs/base-snapshot.md`가 존재하며 base repo, base commit, import 방식, protected source policy를 기록.
- user-facing credits/license 화면이 Open Cowork MIT 전문과 OSS dependency 목록을 노출.
- service download portal의 OSS notice 링크가 desktop credits와 같은 내용을 가리킴.

---

## 7. 검증

- Service API contract test: login/bootstrap/download manifest happy path.
- Policy merge unit test: `group_ids`가 `PolicyContext`에 보존되고 기존 테스트가 회귀하지 않음.
- Attribution check: `packages/cowork-core/LICENSE` 존재, `docs/base-snapshot.md` 존재.
- Security check: bootstrap 응답에 refresh token 또는 provider API key가 포함되지 않음.
- Model catalog check: bootstrap `availableModels`가 tenant/admin allowlist 밖 모델을 포함하지 않음.
- Selected model check: bootstrap `selectedModelId`가 `availableModels` 안에 있고, 없으면 `defaultModelId`로 보정됨.
- Model route check: custom/on-prem route endpoint와 credential이 desktop bootstrap에 평문으로 포함되지 않음.
- Compatibility check: service API가 없어도 local/dev config path는 유지됨.

---

## 8. 완료 조건

- Desktop과 admin이 공유할 service API contract가 문서와 schema로 고정됨.
- `PolicyContext`가 tenant/group membership을 표현할 수 있음.
- 계정이 desktop download 권한과 gateway bootstrap 권한을 구분해서 받을 수 있음.
- 계정 bootstrap이 Veluga 제공 모델 catalog와 허용 model id를 내려줄 수 있음.
- B2B/B2G custom provider route를 desktop secret 노출 없이 catalog item으로 표현할 수 있음.
- Open Cowork attribution baseline이 문서와 배포 산출물 양쪽에 남음.
