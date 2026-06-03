# 25 — Managed Model Catalog & Surface Cleanup

> 목표 한 줄: managed platform 모드에서는 Veluga catalog에 등록된 모델만 provider별로 노출하고, 일반 사용자 임의 provider/API key/baseUrl 입력 표면은 숨기되 B2B/B2G용 custom provider route는 admin/operator 관리 표면으로 유지한다.

---

## 1. 결정

Veluga service platform에서는 **일반 desktop 사용자가 임의의 provider endpoint나 model id를 직접 추가하지 않는다.** 사용 가능한 모델은 다음 순서로 결정된다.

```
Veluga master model catalog
  → tenant contract / deployment profile
  → admin Models allowlist
  → group/user policy override
  → desktop bootstrap availableModels
  → gateway server-side enforcement
```

Desktop은 이 결과를 provider별 그룹으로 표시한다. 사용자가 보는 provider는 "OpenAI", "Anthropic", "Google" 같은 분류일 수 있지만, 실제 provider credential, upstream model id, routing base URL은 gateway/server에만 존재한다.

중요한 예외가 있다. B2B/B2G, 특히 폐쇄망에서는 custom provider가 필수 공급원이 될 수 있다. 이 custom provider는 제거하지 않는다. 다만 사용자가 desktop Settings에서 endpoint/key를 직접 입력하는 방식이 아니라, tenant admin 또는 on-prem operator가 Service API/Gateway route로 등록하고 catalog item으로 배포하는 방식으로 유지한다.

---

## 1.1 제품 프로필별 provider 정책

| 프로필 | 모델 공급원 | custom provider 처리 |
|---|---|---|
| B2C hosted | Veluga hosted catalog + 선택적 BYO 개인 모드 | 기본은 Veluga catalog. 개인/dev 모드에서만 사용자 직접 provider 설정 허용 |
| B2B connected | Veluga hosted catalog + tenant allowlist + tenant gateway route | tenant admin이 승인한 custom route를 catalog에 등록 가능 |
| B2G / closed network | on-prem Service API + on-prem LLM Gateway + 기관 custom provider | custom provider route가 주 공급원일 수 있음. on-prem operator/admin만 endpoint/credential 관리 |

---

## 2. 모델 카탈로그 타입

```ts
export type VelugaModelProvider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'local' | 'custom';

export interface VelugaModelCatalogItem {
  id: string;                    // desktop/admin이 쓰는 Veluga model id
  provider: VelugaModelProvider; // UI grouping key
  displayName: string;
  description?: string;
  routeKind: 'veluga-hosted' | 'tenant-custom' | 'on-prem-local';
  capabilities: {
    reasoning: boolean;
    vision: boolean;
    toolUse: boolean;
    streaming: boolean;
  };
  thinkingLevels?: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>;
  limits: {
    contextWindow: number;
    maxOutputTokens: number;
  };
  defaultForProvider?: boolean;
  status: 'active' | 'deprecated' | 'disabled';
}

export interface TenantModelAccess {
  tenantId: string;
  allowedModelIds: string[];
  defaultModelId: string;
  selectedModelId?: string;
  disabledReasonByModelId?: Record<string, string>;
}
```

`VelugaModelCatalogItem.id`는 provider 원본 id가 아니라 Veluga 서비스 id다. Gateway만 이 값을 실제 provider/model/route로 매핑한다.

---

## 3. Service API contract

| Method | Path | 책임 |
|---|---|---|
| `GET` | `/v1/models/catalog` | tenant가 볼 수 있는 Veluga master catalog subset |
| `GET` | `/v1/models/available` | 현재 user/group policy까지 적용된 모델 목록 |
| `PUT` | `/v1/admin/models/allowlist` | admin이 tenant/group/user 허용 모델 지정 |
| `POST` | `/v1/admin/models/preview` | 특정 사용자에게 노출될 모델 목록 preview |
| `GET/POST` | `/v1/admin/model-routes` | tenant custom/on-prem provider route 조회/등록 |

`/v1/me/bootstrap`은 `availableModels`, `defaultModelId`, `selectedModelId`를 포함한다. Desktop은 provider preset 파일이 아니라 bootstrap 결과를 신뢰한다.

---

## 4. Desktop 변경 계획

현재 `docs/reference/model-and-thinking-ui.md` 기준 desktop model switcher는 `ConfigStore`와 provider profile을 정본으로 본다. Managed mode에서는 정본이 바뀐다.

| 현재 표면 | Managed platform 동작 |
|---|---|
| `API_PROVIDER_PRESETS` hardcoded model list | local/dev fallback only. Managed mode에서는 사용 금지 |
| `getPiAiModelPresets()` pi-ai registry overlay | local/dev fallback only. Managed mode에서는 사용 금지 |
| Chat header model switcher | `availableModels`를 provider별로 group해서 표시 |
| Settings -> API provider tabs | 일반 managed user에게 숨김. 개인/dev 모드 또는 admin 허용 BYO 모드로 격리 |
| `visibleProviders` 사용자 토글 | 숨김. Admin Models allowlist가 provider/model 노출을 결정 |
| API key input | managed mode에서 숨김 |
| Base URL / custom protocol / custom model input | 일반 managed user에게 숨김. admin/operator custom route 관리 화면으로 이동 |
| Ollama local discovery | managed mode에서 숨김. on-prem local 모델은 service catalog의 `provider='local'` route로만 노출 |
| API diagnostics | Veluga service/gateway diagnostics로 전환 |

Desktop은 기존 local config를 삭제하지 않는다. 다만 `velugaAccount.enabled === true`이고 admin policy가 local/BYO model mode를 허용하지 않으면 local provider settings는 비활성/숨김 상태가 된다. Admin/operator-managed custom provider는 desktop local config가 아니라 service catalog/gateway route config에 저장한다.

---

## 5. Gateway enforcement

Gateway는 모든 managed 요청에서 다음을 검증한다.

1. service token이 유효한가.
2. `model`이 Veluga model id인가.
3. model id가 tenant/group/user allowlist에 포함되는가.
4. model status가 `active`인가.
5. quota preflight가 통과하는가.

검증이 끝난 뒤에만 server-side route table에서 실제 provider model id와 credential을 찾는다. Desktop이 upstream model id나 provider base URL을 알 필요가 없어야 한다.

---

## 6. 일반 사용자에게 숨기거나 이동할 표면

Managed tenant의 일반 사용자에게서 숨기거나 admin/operator 표면으로 이동할 항목:

- 첫 실행의 "API provider/key 설정" 필수 동선.
- Settings -> API의 직접 provider 설정 탭: OpenRouter, Anthropic, OpenAI, Gemini, Ollama, Custom.
- API key, Base URL, custom protocol, custom model, context window/max token 수동 입력.
- "More models" / custom endpoint 안내와 provider guidance.
- local Ollama discovery와 수동 모델 refresh.
- 사용자별 `visibleProviders` 토글.
- Memory 설정의 LLM/embedding API key/baseUrl override.
- public provider endpoint를 직접 찌르는 diagnostics.
- subscription-login UI 기본 노출. managed tenant에서는 admin이 `allow_byo_subscription_login=true`로 켠 경우에만 노출한다.
- OpenRouter 또는 custom relay를 통한 사용자 직접 우회 모델 사용. 필요한 경우 tenant/admin/operator가 Veluga gateway route로 catalog에 등록한다.

개발자/개인 모드에는 위 표면을 남길 수 있지만, service-managed org 사용자에게는 admin policy로 명시 허용된 경우만 보여준다.

유지해야 하는 표면:

- Admin Models 또는 Settings의 tenant custom provider route 관리.
- On-prem operator의 gateway route 등록/헬스체크/credential rotation.
- Custom provider route를 catalog item으로 노출하고 allowlist에 포함하는 흐름.
- 폐쇄망 profile에서 public provider 대신 custom provider를 기본 모델 공급원으로 쓰는 흐름.

---

## 7. Admin Models 화면

Admin은 일반 사용자처럼 임의 model id를 직접 입력하지 않는다. Admin 화면은 Veluga master catalog에서 모델을 선택해 tenant/group/user에 허용한다. B2B/B2G에서 새 custom provider가 필요하면 admin/operator 권한으로 route를 등록하고, 등록된 route가 catalog item이 된 뒤 allowlist에 포함한다.

필수 기능:

- provider별 model catalog 목록.
- custom provider route 등록 또는 on-prem operator route 승인 흐름.
- route health check와 credential rotation 상태.
- model capability(reasoning/vision/tool use/context window) 표시.
- tenant default model 지정.
- group/user override.
- deprecated model 경고와 migration target 지정.
- 특정 사용자 preview.

On-prem 고객이 자체 gateway route를 추가해야 하는 경우에는 일반 사용자 UI가 아니라 tenant admin, platform owner, 또는 on-prem operator 권한에서 catalog route를 등록한다.

---

## 8. 검증

- Managed bootstrap에 포함되지 않은 model id를 desktop에서 선택할 수 없음.
- Renderer가 임의 model id를 IPC로 보내도 Main 또는 service client가 거부.
- Gateway가 allowlist 밖 model id를 provider 호출 전에 거부.
- Settings/API key/baseUrl/사용자 직접 custom/Ollama 표면이 managed user에게 보이지 않음.
- Admin/operator가 등록한 custom provider route가 catalog item으로 bootstrap에 포함될 수 있음.
- Admin allowlist 변경 후 다음 bootstrap/model refresh에 반영됨.
- Local/dev mode에서는 기존 provider 설정 회귀가 없음.

---

## 9. 완료 조건

- Managed account mode의 모델 목록은 Veluga service catalog에서만 온다.
- 모델은 provider별로 그룹 표시되지만 provider credential/route는 gateway에만 있다.
- 사용자는 Veluga가 제공하지 않는 모델을 desktop UI, IPC, gateway 어느 경로로도 사용할 수 없다.
- B2B/B2G 폐쇄망 custom provider는 제거되지 않고 admin/operator-managed catalog route로 제공된다.
- 기존 local/dev provider 설정은 삭제되지 않되, managed tenant 기본 UX에서는 사라진다.
