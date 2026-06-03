# 20 — Phase 2: Desktop Account Client

> 목표 한 줄: 사용자가 Veluga 계정으로 desktop에 로그인하고, entitlement와 managed gateway 설정을 자동으로 받게 한다.

---

## 1. 범위

**In scope**

- desktop settings의 "Veluga Account" 섹션.
- browser/device login flow와 main-process token storage.
- `/v1/me/bootstrap` sync.
- managed gateway profile 적용.
- service-provided model catalog를 chat header와 settings에 적용.
- download/update channel manifest 확인.
- offline grace period와 account sign-out.

**Out of scope**

- admin console 전체.
- quota enforcement의 서버 구현.
- 기존 API key/subscription-login 설정 제거 또는 데이터 마이그레이션.

---

## 2. 사용자 흐름

```
[사용자] 웹 download portal에서 Veluga 계정 로그인
  → OS별 signed installer 다운로드
  → desktop 실행
  → "Veluga 계정으로 로그인" 클릭
  → system browser 인증
  → desktop callback/device code 완료
  → Main이 service token 저장
  → /v1/me/bootstrap 호출
  → managed gateway + provider별 availableModels + effective PolicyContext 적용
  → 채팅 시작
```

Renderer는 token 값을 보지 않는다. Renderer에는 로그인 상태, tenant 이름, quota summary, 만료/동기화 상태만 보낸다.

---

## 3. Desktop auth 저장 정책

| 값 | 저장 위치 | Renderer 노출 |
|---|---|---|
| refresh token | Main only, encrypted store 또는 OS keychain | 금지 |
| service access token | Main memory + encrypted cache | 금지 |
| gateway token | Main memory, 짧은 TTL | 금지 |
| user/tenant/account hint | config metadata | 허용 |
| quota summary | service response cache | 허용 |

기존 `store-encryption.ts`를 우선 재사용한다. keychain 도입은 보안 요구가 명확해질 때 별도 결정한다.

---

## 4. Managed gateway profile

현재 `ConfigStore`는 local API key, baseUrl, provider preset, selected model 중심이다. Veluga account mode에서는 사용자의 기존 local config를 덮어쓰지 않는다.

MVP 적용 방식:

1. `AppConfig`에 `velugaAccount?: VelugaAccountState` 추가.
2. session 시작 시 `velugaAccount.enabled === true`이면 service bootstrap의 gateway 값과 `selectedModelId`를 runtime env/auth storage에 주입.
3. Chat header model switcher는 local provider profiles가 아니라 bootstrap `availableModels`를 provider별로 표시한다.
4. Settings의 API key profile은 그대로 보존하되 managed tenant 사용자에게는 숨기고, UI에는 "Managed by Veluga account" 상태를 표시.
5. sign-out 시 managed runtime credential만 제거하고 사용자 API key profile은 복구한다.

장기적으로는 `ProviderProfileKey`에 `veluga:managed`를 추가할 수 있지만, Phase 2 MVP에서는 local config migration 위험을 줄인다.

---

## 5. IPC / preload 계약

| IPC | 책임 |
|---|---|
| `velugaAccount.getStatus` | 로그인 상태, tenant, quota summary, sync status |
| `velugaAccount.getAvailableModels` | service bootstrap에서 내려온 provider별 사용 가능 모델 목록 |
| `velugaAccount.setSelectedModel` | allowlist 안의 Veluga model id만 선택 |
| `velugaAccount.startLogin` | login URL 또는 device code 발급 |
| `velugaAccount.completeLogin` | callback/device completion 처리 |
| `velugaAccount.refreshBootstrap` | entitlement/policy/gateway 재동기화 |
| `velugaAccount.signOut` | token 제거, managed profile 비활성화 |
| `velugaAccount.openAdmin` | admin 권한이 있으면 web admin URL 열기 |

기존 `config.*` IPC와 섞지 않고 account domain을 분리한다. config modal은 account 상태를 읽어 표시만 한다.

---

## 6. 배포와 업데이트

| 기능 | 계획 |
|---|---|
| Download portal | service entitlement가 허용한 channel/platform만 manifest 제공 |
| Installer signing | Windows/macOS signing 상태를 manifest에 기록 |
| Update check | connected profile에서는 Veluga update manifest만 사용 |
| Closed-network profile | update check off, 관리자 배포 package import 방식 |
| Minimum version | service bootstrap이 `minimumDesktopVersion`을 내려 오래된 앱 차단 가능 |

`electron-updater`를 쓰더라도 GitHub/public release가 아니라 Veluga-controlled endpoint만 바라본다. 폐쇄망 profile에서는 update check를 완전히 비활성화한다.

---

## 7. UI 요구

- Settings 안에 `Veluga Account` 탭 또는 섹션 추가.
- account 상태: signed out, signing in, active, token expired, entitlement denied, offline grace.
- tenant switch는 Phase 2에서는 단일 tenant 우선. 다중 tenant는 list가 있으면 선택만 제공.
- 모델 선택은 Veluga-provided `availableModels`만 provider별 그룹으로 표시한다.
- API key, Base URL, 사용자 직접 custom provider, Ollama discovery, `visibleProviders`는 managed user에게 숨긴다. Admin/operator가 등록한 custom provider 모델은 catalog 항목으로 표시한다.
- quota summary는 "남은 요청/토큰" 정도만 표시하고, 상세 사용량은 admin web으로 연결.
- admin role 보유자에게만 "Admin console" entry 표시.

---

## 8. 검증

- Token redaction unit test: renderer IPC payload에 token 필드 없음.
- Bootstrap integration test: service mock → policy injector → session start.
- Sign-out test: managed token 제거 후 기존 API key config 보존.
- Managed model test: bootstrap에 없는 model id는 UI와 IPC 양쪽에서 선택 불가.
- Surface cleanup test: managed user에게 API key/baseUrl/사용자 직접 custom/Ollama provider 설정이 표시되지 않음.
- Offline grace test: bootstrap cache가 허용 시간 안에서만 사용됨.
- Update manifest test: channel entitlement 없는 사용자는 download URL을 받지 못함.

---

## 9. 완료 조건

- Veluga 계정 로그인만으로 API key 없이 managed gateway 세션 시작 가능.
- Veluga 계정 사용자는 Veluga catalog가 제공한 모델만 provider별로 선택 가능.
- 사용자의 기존 API key/subscription-login 설정은 손상되지 않음.
- service entitlement denied 또는 quota denied 상태가 UI에서 구분됨.
- 관리자 권한 사용자는 desktop에서 admin console로 진입 가능.
