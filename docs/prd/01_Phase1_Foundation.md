# 01 — Phase 1: Foundation (권한 있는 일반 챗봇 + 화이트라벨링)

> **목표 한 줄**: SSO 로그인부터 안전한 일반 대화까지 — Veluga 브랜딩이 입혀진 데스크톱 앱이 안정 기동되고, PolicyContext가 단일 진실로 권한을 통제하며, A4/A5가 모든 도구 호출을 가로채는 상태.
>
> **기간**: 8~10주
> **선행**: 없음 (시작 Phase)
> **후속**: Phase 2 (Project + core Skill)
> **문서 상태**: ✅ 구현 완료 (2026-05-23 기준 Phase 1 구현·검증 완료)
>
> **이 PRD 단독으로 작업 가능**: ✅ (단, `00_Overview.md`와 `99_Appendix.md` 시그니처 참조 필수)

---

## 1. 범위 (Scope)

### 1.1 In-scope

| 영역 | 산출물 |
|---|---|
| **L0 Identity & Policy** | SSO 어댑터 (mock) + PolicyService (mock, YAML 디스크 로드) + 5-tier 머지 엔진 + PolicyContext 인메모리 주입 |
| **L1 Cowork 어댑터** | Open Cowork fork + `PolicyContextInjector` + `VelugaIpcMiddleware` + `ToolInterceptor` + Veluga Mode toggle |
| **L2 최소 에이전트** | A1 Intent Router (+ fast-path), A4 Policy Guard (**dry-run**), A5 Audit Logger, A6 General Planner, A7 General Responder |
| **L4 core Skill** | `system-self-help` (LLM 호출 0회) |
| **UI Veluga 어댑터** | `PolicyProvider`, Skill/KB 토글 가시성 바인딩, Veluga Mode toggle 노출, "외부 자료 미사용" 상시 배너 |
| **화이트라벨링** | §6 5단계 전체 (`package.json` 메타데이터·Tailwind·로고·설치 화면·White-out·Credits) |
| **LLM 게이트웨이 어댑터** | OpenAI/Anthropic 호환 인터페이스 추상화 → 사내 게이트웨이 URL 환경변수 주입 |
| **감사 DB** | SQLite append-only `audit_log` 테이블 + UPDATE/DELETE 트리거 차단 |
| **회귀 안전망** | Veluga Mode OFF 시 Open Cowork 원본 동작 보존 E2E 테스트 |

### 1.2 Out-of-scope (Phase 2+ 이관)

- Project 재진입 요약, `last_session_summary` 갱신 → Phase 2
- 외부 KB MCP consumer 어댑터, A2/A3 → Phase 3 (KB 자체는 외부 시스템 — 본 PRD 범위 밖)
- domain Skill, format Skill (docx 등) → Phase 2~3
- compliance-checker, citation-tracer, approval-queue → Phase 4
- Policy Guard `enforce` 모드 → Phase 3
- Docker 샌드박싱 (Kuse 패턴) → Phase 4

### 1.3 Phase 1이 *해결하는* 페르소나 빈틈

- **P2 박민호 (신입)**: "이 시스템으로 뭘 할 수 있어?" → `system-self-help` Skill로 LLM 호출 없이 정확 답변.
- **P4 정수민 (IT 관리자)**: 사용자 등록 → user.yaml 편집 → SSO 로그인 → 권한 가시화 확인 가능 (단, 관리자 UI는 Phase 2+).
- **W1 무거움 (단순 발화 3-hop LLM)**: fast-path 정규식으로 "안녕"에 LLM 호출 0회.

---

## 2. Acceptance Criteria (Phase 1 종료 조건)

다음 모두 PASS 시 Phase 1 종료:

### 2.1 기능 AC

- [x] **AC-1.1** SSO 로그인 다이얼로그 → mock IdP 토큰 발급 → `IdentityResolver` → `PolicyService.fetchAll()` → `PolicyContext` 빌드까지 5초 이내 완료
- [x] **AC-1.2** 세션 시작 시 `PolicyContext`가 Electron Main 인메모리에 박히고 Renderer로 broadcast됨 (DevTools로 검증)
- [x] **AC-1.3** PolicyService 응답 실패 시 마지막 캐시 정책 + 빨간색 "stale policy" 배너 + read-only 모드 fallback
- [x] **AC-1.4** 정책 변경 push (mock SSE) → `PolicyContext` 1초 내 부분 갱신 → UI Skill/KB 토글 즉시 재계산
- [x] **AC-1.5** 100% 도구 호출이 `ToolInterceptor`를 통과 (커버리지 테스트로 검증)
- [x] **AC-1.6** A4 Policy Guard `dry-run` 모드 — 로그만 기록, 차단 없음. 정책 위반 케이스는 audit_log에 `policy.violation_detected` 이벤트로 남음
- [x] **AC-1.7** A5 Audit Logger `audit_log` 테이블 — UPDATE/DELETE SQL 시도 시 트리거가 reject
- [x] **AC-1.8** A1 Intent Router 발화 100건 (페르소나 4명 × 25발화) 분류 정확도 ≥ 85%
- [x] **AC-1.9** A1 fast-path 적중 시 LLM 호출 0회 (계측: `llm.invocations.count` 메트릭)
- [x] **AC-1.10** A6 confidence 평가 100건 샘플 — 시점·기관·법령 키워드 등장 시 `confidence='low'` 자동 부여 정확도 ≥ 95%
- [x] **AC-1.11** A7 응답 100문장 샘플 — 신뢰도 태그 4개 중 하나 부착률 100%
- [x] **AC-1.12** `system-self-help` Skill — LLM 호출 0회, PolicyContext에서 가용 항목만 안내 (denied skill 노출 0건)

### 2.2 비기능 AC

- [x] **AC-1.13** Veluga Mode **OFF** 회귀 — Open Cowork 원본 E2E 테스트 스위트 100% 통과
- [x] **AC-1.14** Veluga Mode **ON** + 빈 PolicyContext (테스트 모드) — Open Cowork 원본 동작과 동등하게 작동
- [x] **AC-1.15** Cold start (앱 실행 → 첫 응답 가능) ≤ 8초 (개발 빌드 기준)
- [x] **AC-1.16** PolicyContext 평가 (Policy Guard `onBeforeCall`) p99 ≤ 5ms (인메모리)

### 2.3 화이트라벨링 AC (§6)

- [x] **AC-1.17** 작업 관리자(Win)/Activity Monitor(mac)/Dock에 "Veluga" 표시 (Open Cowork 흔적 0건)
- [x] **AC-1.18** 스플래시·로그인·홈화면·설정창 모두 Veluga 브랜딩 (수동 스크린 캡처 점검)
- [x] **AC-1.19** `grep -ri "open cowork\|opencowork" packages/` 결과가 `packages/cowork-core/` 외 영역에서 0건
- [x] **AC-1.20** `tailwind.config.js` primary/secondary 토큰이 Veluga 팔레트로 컴파일됨
- [x] **AC-1.21** Windows `.exe` 및 macOS `.dmg` 빌드 — 설치 마법사 모든 화면 Veluga 브랜딩 + 코드 서명 통과
- [x] **AC-1.22** Credits 페이지 — 설정 메뉴 진입 가능 + Open Cowork MIT 라이선스 전문 노출 + `LICENSES.md` 자동 생성

### 2.4 White-out AC (보안 감사 직결)

- [x] **AC-1.23** 빌드 산출물을 `mitmproxy` 또는 동등 도구로 5분 모니터링 → 외부 도메인 트래픽 **0 byte**
- [x] **AC-1.24** `npm ls` 결과 — Vercel Analytics, PostHog, Sentry, Datadog, Segment, Mixpanel, GA 패키지 0건
- [x] **AC-1.25** `electron-updater` 외부 GitHub release 호출 코드 경로 — 비활성 PR 머지됨 (또는 사내 URL 전환)
- [x] **AC-1.26** LLM API 호출이 `VELUGA_LLM_GATEWAY_URL` 환경변수로만 라우팅 (하드코딩 외부 도메인 0건, `docs/whiteout-endpoints.md` 카탈로그 완비)

### 2.5 보안 AC

- [x] **AC-1.27** SSO 토큰 저장 — OS keychain (Windows Credential Manager / macOS Keychain) 사용, 평문 디스크 저장 0건
- [x] **AC-1.28** SQLite DB 파일 — OS 사용자 디렉터리 권한 0600 / ACL 강제
- [x] **AC-1.29** PII 마스킹 — audit_log payload에서 주민번호·계좌·전화번호 정규식 자동 마스킹 (단위 테스트로 검증)

---

## 3. L0 — Identity & Policy 구현

### 3.1 인증 흐름

```
[Veluga 앱 실행]
    ↓
[로컬 SSO 토큰 캐시 검증] ─ valid ─► [PolicyContext 캐시 사용] (오프라인 부팅 허용 시간 내)
    │ invalid/expired
    ▼
[SSO 로그인 다이얼로그 — SAML/OIDC/사내 인증]
    ↓
[IdentityResolver(token) → Identity{ user_id, dept, role, clearance, group_ids }]
    ↓
[PolicyService.fetchAll(identity) → 5-tier YAML 로드 + 머지 → PolicyContext]
    ↓
[Electron Main 인메모리 박기 + Renderer broadcast]
    ↓
[PolicyService SSE/WebSocket subscribe (정책 변경 push)]
    ↓
[세션 시작 → Cowork Runtime 진입]
```

### 3.2 PolicyService Mock 구현 (Phase 1)

> Phase 1은 mock으로 시작. RPC 정책 서비스는 Phase 3 종료 전 교체.

- **로드 소스**: 디스크 YAML 파일 (`./dev-policies/institution.yaml`, `org.yaml`, `project.yaml`, `user.yaml`). 환경변수 `VELUGA_POLICY_DIR`로 경로 지정.
- **변경 push 시뮬레이션**: 동일 디렉터리에 파일 변경 감지 (`chokidar`) → 메모리 PolicyContext 재빌드 → Renderer SSE push.
- **장애 시뮬레이션**: 환경변수 `VELUGA_POLICY_SIMULATE_OUTAGE=true` 시 fetch 실패 → fallback 동작 검증.

**파일 위치**: `packages/policy-service/src/mock-server.ts` (Phase 3에서 실제 RPC 서버로 교체).

### 3.3 SSO 어댑터 Mock (Phase 1)

- **인터페이스 추상화**: `SsoProvider` 인터페이스 — `saml`, `oidc`, `internal` 3개 구현체 슬롯.
- **Phase 1 mock**: 로컬 dev IdP (예: `keycloak` Docker 컨테이너 또는 simple JWT signer). 토큰 만료 1시간 기본.
- **Phase 3 교체 예정**: 기관별 실제 SAML/OIDC 어댑터. 인터페이스는 Phase 1에서 확정.

**파일 위치**: `packages/policy-service/src/sso/{saml,oidc,internal}.ts`.

### 3.4 5-tier YAML 머지 엔진

**알고리즘 의사코드**:
```typescript
function mergePolicies(
  institution: InstitutionPolicy,
  org: OrgPolicy,
  project: ProjectPolicy | null,
  user: UserPolicy,
  session: SessionPolicy
): EffectivePolicy {
  // 1. deny 우선 — 상위 deny는 하위가 덮을 수 없음
  // 2. 미명시 항목만 하위가 채울 수 있음
  // 3. clearance — user.clearance 가 active level (단, project가 더 좁히면 좁힘)
  // 4. active_kb_scopes = (org.kb_scopes ∪ user.kb_extra_scopes) ∩ project.allowed_scopes
  // 5. active_skill_ids = ((org.default_skills ∪ user.extra_skills) ∪ project.active_skills) \ user.denied_skills
  // 6. external_apis: institution → org → project → user → session 순으로 deny 우선
  // 7. veluga.enable_veluga_orchestration: session > institution.default
  ...
}
```

**Unit Test 의무**: 머지 케이스 ≥ 30개 (deny 우선, scope 교집합, clearance 좁힘, project null, etc.).

**파일 위치**: `packages/policy-service/src/merge.ts` + `merge.test.ts`.

### 3.5 PolicyContext 인터페이스

> 상세 TypeScript 시그니처는 `99_Appendix.md` §1 참조. Phase 1은 그 시그니처 그대로 구현.

**필수 메서드**:
- `subscribe(listener): () => void` — Renderer가 변경 알림 수신
- `policyVersionId: string` — 감사 추적용 (모든 audit 이벤트에 동봉)
- `hasSkill(id): boolean` — UI 가시성 결정용
- `hasKbScope(scope): boolean` — 토글 가시성 결정용

### 3.6 정책 평가 시점 (Phase 1 적용분)

| 시점 | 평가자 | Phase 1 동작 |
|---|---|---|
| 로그인 직후 | PolicyService | 풀 페치 |
| 세션 시작 | PolicyContext 주입 | 인메모리 박기 |
| Skill 실행 직전 | Policy Guard | dry-run (로그만) |
| 파일 쓰기 | Policy Guard + HITL | HITL은 Cowork 원본 그대로 |
| 정책 변경 push | PolicyService → PolicyContext | 비동기 갱신 |

---

## 4. L1 — Open Cowork Fork & 어댑터

### 4.1 Fork 절차

1. `git clone https://github.com/OpenCoworkAI/open-cowork` → `packages/cowork-core/` 위치로 복사 (또는 git subtree).
2. 베이스 commit SHA를 `docs/upstream-base.md`에 기록.
3. **MIT LICENSE 파일을 `packages/cowork-core/LICENSE`에 보존** (절대 삭제 금지 — Hard Reject).
4. CI 보호 룰 추가 (§4.4).

### 4.2 추가할 어댑터 모듈 (Phase 1)

| 모듈 | 위치 | 책임 |
|---|---|---|
| `PolicyContextInjector` | `packages/veluga-main/src/policy-injector.ts` | Cowork 세션 시작 hook에서 PolicyContext 인메모리 박기, Renderer broadcast |
| `VelugaIpcMiddleware` | `packages/veluga-main/src/ipc-middleware.ts` | UI→Runtime IPC 진입점에 fast-path + A1 분기 + Veluga Mode 토글 |
| `ToolInterceptor` | `packages/veluga-main/src/tool-interceptor.ts` | Cowork 도구 호출 직전 hook에 A4 (`onBeforeCall`) + A5 (이벤트 emit) |
| `AuditLogger` | `packages/veluga-main/src/audit-logger.ts` | SQLite `audit_log` 테이블 append + Citation Graph stub (Phase 4 본격화) |
| `LlmGateway` | `packages/veluga-main/src/llm-gateway.ts` | 사내 게이트웨이 추상화 (OpenAI/Anthropic 호환 + 환경변수 주입) |
| `PolicyProvider` | `packages/veluga-renderer/src/PolicyProvider.tsx` | React Context — `usePolicyContext()` hook |
| `policy-bindings` | `packages/veluga-renderer/src/policy-bindings.ts` | PolicyContext → Skill/KB 토글 가시성 React state |
| `VelugaModeToggle` | `packages/veluga-renderer/src/VelugaModeToggle.tsx` | 설정창의 ON/OFF 토글 UI |
| `ExternalDataBanner` | `packages/veluga-renderer/src/ExternalDataBanner.tsx` | "외부 자료 미사용" 상시 배너 |

### 4.3 Cowork hook 결합 위치 (구체)

> AI agent는 fork 직후 다음 hook이 실제로 존재하는지 확인. 없으면 `98_Gap_Analysis.md`에 GAP-L1-* 로 등록.

| 결합 패턴 | Cowork hook 후보 (확인 필요) | Fallback (hook 없을 시) |
|---|---|---|
| 세션 시작 hook | `session.onStart` 또는 `runtime.beforeFirstMessage` | preload bridge에서 IPC 첫 메시지 가로채기 |
| IPC 메시지 진입 | `ipcMain.on('message', ...)` 핸들러 chain | Veluga IPC 채널 별도 신설 + Renderer가 그쪽으로 보내도록 변경 |
| 도구 실행 직전 | `agent-runtime.beforeToolCall` 또는 HITL `explicit_permission` hook | Tool resolver를 감싸는 proxy 패턴 |
| Renderer broadcast | `webContents.send('policy:updated', ...)` | preload에서 EventEmitter 패턴 |

**Phase 1 첫 주 작업**: AI agent는 위 hook들의 실제 존재를 확인하고 `docs/cowork-hooks.md`에 매핑 결과 기록. 누락 발견 시 즉시 PM 합의.

### 4.4 CI 보호 룰 (Hard Reject)

> 다음 규칙은 Phase 1에서 GitHub Actions 또는 동등 CI로 강제. PR이 위반 시 자동 reject.

```yaml
# .github/workflows/protected-paths.yml (예시)
- name: Reject changes in cowork-core
  run: |
    if git diff --name-only origin/main | grep -E "^packages/cowork-core/"; then
      echo "::error::packages/cowork-core/ is protected. Add adapters in packages/veluga-*."
      exit 1
    fi
- name: Reject forbidden telemetry packages
  run: |
    if grep -E "(posthog|sentry|vercel/analytics|datadog|segment|mixpanel|google-analytics)" packages/*/package.json; then
      echo "::error::Telemetry package detected. Forbidden in closed-network build."
      exit 1
    fi
- name: Reject hardcoded external LLM endpoints
  run: |
    if grep -rE "api\.(anthropic|openai)\.com" packages/veluga-*; then
      echo "::error::Hardcoded external LLM endpoint. Use VELUGA_LLM_GATEWAY_URL."
      exit 1
    fi
```

### 4.5 Veluga Mode Toggle 구현

```ts
// packages/veluga-main/src/ipc-middleware.ts
export async function handleUserMessage(msg: UserMessage, ctx: SessionContext) {
  if (!ctx.policyContext.veluga.enable_veluga_orchestration) {
    return openCoworkRuntime.handle(msg, ctx); // 원본 회귀
  }
  // 1. fast-path 시도
  const fastResult = tryFastPath(msg, ctx);
  if (fastResult) return fastResult;
  // 2. A1 Intent Router 진입
  const intent = await intentRouter(msg, ctx);
  // 3. answer_mode 분기
  if (intent.answer_mode === 'general') {
    const plan = await generalPlanner(msg, ctx);
    return await generalResponder(plan, ctx);
  }
  // Phase 2+ — kb/project_only/mixed 분기 (Phase 1은 fallback)
  return openCoworkRuntime.handle(msg, ctx);
}
```

UI: 설정창 하단에 토글. PolicyContext에 박힌 `veluga.enable_veluga_orchestration_default`가 초기값.

---

## 5. L2 — Phase 1 에이전트 구현

> 모든 에이전트 입출력 JSON 시그니처는 `99_Appendix.md` §2 참조. 본 섹션은 Phase 1 구현 디테일에 집중.

### 5.1 A1 — Intent Router (+ fast-path)

#### 5.1.1 Fast-path 규칙 (정규식 풀세트)

```typescript
const FAST_PATH_RULES = [
  // 1. 인사·감사·확인
  { pattern: /^\s*(안녕|안녕하세요|hi|hello|hey)[\s!?.~]*$/i, type: 'greeting' },
  { pattern: /^\s*(고마워요?|감사합니다?|땡큐|thanks?|thank you)[\s!?.~]*$/i, type: 'thanks' },
  { pattern: /^\s*(확인했어요?|ok|네|예|알겠습니다?|got it)[\s!?.~]*$/i, type: 'ack' },
  // 2. 시스템 능력 질의
  { pattern: /^\s*(\/help|도움말|뭐 할 수 있어|사용법|기능 알려)/i, type: 'self_help' },
  // 3. 명시 도구 호출
  { pattern: /^\s*\/skill\s+(\S+)/i, type: 'explicit_skill' },
  // (확장 가능 — 도메인 키워드는 정식 LLM router로)
];
```

**산출**: 매칭 시 `{ fast_path_hit, answer_mode, skip_planner }` 반환 → LLM 호출 0회 (greeting/thanks/ack 템플릿) 또는 1회 (self_help는 Skill만 호출).

#### 5.1.2 LLM Intent Router 프롬프트 (Phase 1)

> 전체 시스템 프롬프트는 `99_Appendix.md` §3.1 참조. 핵심 룰:

- UI "KB 사용" 토글이 OFF → `use_kb=false` 강제.
- `suggested_skills`는 `PolicyContext.active_skill_ids` 교집합만.
- 모호하면 `needs_clarification=true` → Cowork `AskUserQuestion` 트리거.
- 출력 JSON schema 위반 시 retry 1회 + 실패 시 안전 fallback (`{ intent_class: 'general_qa', answer_mode: 'general', use_kb: false }`).

#### 5.1.3 평가 셋

`tests/intent-router/golden.jsonl` — 100건 (페르소나 4명 × 25 발화). 분류 정확도 ≥ 85% 자동 검증.

### 5.2 A4 — Policy Guard (Phase 1 dry-run)

#### 5.2.1 시그니처
```ts
type GuardDecision =
  | { kind: 'allow' }
  | { kind: 'deny', reason: string }
  | { kind: 'require_approval', prompt: string, scope: 'this_call' | 'session' };

interface GuardContext {
  user: { id: string; clearance: Clearance };
  session: { id: string };
  policy: PolicyContext;
}

function onBeforeCall(tool: ToolName, args: unknown, ctx: GuardContext): GuardDecision;
```

#### 5.2.2 Phase 1 동작 (dry-run)

- `policy_guard_mode: 'dry-run'` (institution.yaml 기본값) — 평가는 정상 수행, 결과는 audit_log에만 기록. **차단 안 함**.
- 위반 케이스는 `event_type: 'policy.violation_detected'`로 남김 — Phase 3 enforce 전환 시 회귀 검증 자료.
- 신규 도구가 Policy Guard 화이트리스트에 미등록 시 audit_log에 `event_type: 'tool.unregistered'` 경고만 (Phase 3에서 자동 deny로 강화).

#### 5.2.3 Phase 3 전환 준비

- Phase 1 종료 시점에 `policy_guard_mode: 'enforce'`로 정책만 바꾸면 실제 차단이 작동하도록 코드 완성.
- 전환 전 dry-run 로그 분석으로 잘못 차단될 케이스 사전 식별.

### 5.3 A5 — Audit Logger

#### 5.3.1 SQLite 스키마 (Phase 1 베이스)

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                    -- ISO8601 UTC
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  policy_version_id TEXT NOT NULL,
  hash_prev TEXT,
  hash_self TEXT
);
CREATE INDEX idx_audit_session ON audit_log(session_id);
CREATE INDEX idx_audit_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_ts ON audit_log(ts);

-- append-only 강제
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(FAIL, 'audit_log is append-only'); END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(FAIL, 'audit_log is append-only'); END;
```

#### 5.3.2 Phase 1 이벤트 카탈로그

> 전체 카탈로그는 `99_Appendix.md` §4 참조. Phase 1 필수:

`session.start`, `session.end`, `intent.classified`, `policy.violation_detected`, `policy.updated`, `tool.called`, `tool.unregistered`, `hitl.requested`, `hitl.resolved`, `general.responded`

#### 5.3.3 PII 마스킹

```ts
// packages/veluga-main/src/audit-logger.ts
const PII_PATTERNS = [
  { name: 'rrn', regex: /\d{6}[-\s]?\d{7}/g, replace: '[RRN-MASKED]' },  // 주민번호
  { name: 'phone', regex: /01\d[-\s]?\d{3,4}[-\s]?\d{4}/g, replace: '[PHONE-MASKED]' },
  { name: 'bank', regex: /\d{3,4}[-\s]?\d{2,4}[-\s]?\d{6,}/g, replace: '[BANK-MASKED]' },
  // 추가 패턴은 institution.yaml.pii_patterns 정책에서 주입 (Phase 3)
];

function maskPii(payload: string): string { /* ... */ }
```

### 5.4 A6 — General Planner

#### 5.4.1 입력
- 사용자 발화
- 대화 이력 (최근 N=5 turn)
- **외부 자료 사용 안 함** (KB, Project 자료 모두 차단)

#### 5.4.2 confidence 자동 룰

- 시점 키워드 (`최근`, `현재`, `올해`, `이번달`, `지난 분기`, `today`, `now`, `recent`) → `confidence='low'` 강제
- 기관 키워드 (`우리 회사`, `우리 부서`, `사내`, `our company`) → `confidence='low'` 강제
- 법령·통계 키워드 (`법령`, `시행규칙`, `통계`, `세액공제`, `한도`, `tax credit`) → `confidence='low'` 강제 + `escalate_to_kb` 자동 권유
- 보편 상식 (`정의`, `개념`, `원칙`, `일반적인`) → `confidence='high'` 후보

#### 5.4.3 refuse 영역

- 법률 자문 (예: "내가 이 계약을 어겼을 때 처벌은?")
- 의료 진단 (예: "내 증상에 약 추천")
- 개인 정보 수집
- 정책상 정의된 금기 주제 (institution.yaml 확장 — Phase 3)

### 5.5 A7 — General Responder

#### 5.5.1 신뢰도 태그 부착 룰

- 각 문단 끝에 `[parametric:high]` 또는 `[parametric:low]` 필수
- "아마", "일반적으로", "통상" 같은 약한 표현 → `[parametric:low]` 강제
- 시점 의존 정보 → `[parametric:low]` 강제

#### 5.5.2 에스컬레이션 안내 템플릿

```
{본문 답변}

▶ 이 답변은 외부 자료를 보지 않은 일반 답변입니다.
[KB 사용을 활성화]하면 기관 자료에 근거한 정확한 답을 드릴 수 있습니다.
```

(Phase 3 KB 활성 후 진짜 KB 호출로 이어짐)

#### 5.5.3 Compliance 인용 정책 (Phase 1부터 박기)

- 결재 문서 본문 텍스트 생성 요청 → 거절 또는 KB 사용 권유 (Phase 4 compliance-checker가 그 태그를 차단할 수 있도록 기반 준비)

### 5.6 system-self-help Skill (LLM 0회)

#### 5.6.1 입력

`PolicyContext`만. (사용자 발화 매개변수 받지만 본문은 무시 — 시스템 능력 안내만 반환)

#### 5.6.2 출력 포맷

```markdown
## Veluga로 할 수 있는 것 (당신의 권한 기준)

### 1. 활성화된 능력 (Skills)
- {skill_id_1} — {short_description}
- {skill_id_2} — ...

### 2. 접근 가능한 자료 범위 (KB Scopes)
- {scope_1}
- {scope_2}
- (당신의 clearance: {clearance})

### 3. 활성 Project
- {project_id} — {purpose}
- (재진입 요약: Phase 2부터 표시 예정)

### 4. 일반 챗
- 외부 자료 없는 일반 질문 가능 (`[parametric]` 태그 표시)
- 시점·기관 특수 질문은 KB 활성화 권유

### 5. 현재 모드
- Veluga Mode: {ON | OFF}
- Policy Guard: {dry-run | enforce}

자세한 권한 변경은 IT 관리자에게 문의하세요.
```

#### 5.6.3 구현

```ts
// skills/core/system-self-help/handler.ts
export async function handle(ctx: SkillContext): Promise<string> {
  const p = ctx.policyContext;
  // LLM 호출 없이 템플릿 채우기
  return template
    .replace('{skills}', p.active_skill_ids.map(formatSkillLine).join('\n'))
    .replace('{scopes}', p.active_kb_scopes.join('\n'))
    /* ... */;
}
```

---

## 6. 화이트라벨링 (5단계 전체)

> §00 Overview §2.5의 5단계를 Phase 1 종료 전 완료. **Veluga 코어 로직과 병렬 진행 가능**하나, Phase 1 머지 전 모두 PR 통과·E2E 검증 완료.

### 6.1 Step 1 — `package.json` 메타데이터

```json
{
  "name": "veluga-agents",
  "productName": "Veluga",
  "version": "1.2.0",
  "description": "폐쇄망 공공/금융 기관용 에이전틱 업무 시스템",
  "author": "Veluga Team <contact@veluga.io>",
  "build": {
    "appId": "io.veluga.agents",
    "mac": { "category": "public.app-category.productivity" },
    "win": { "publisherName": "Veluga Inc." }
  }
}
```

**AC**: AC-1.17, AC-1.18.

### 6.2 Step 2 — 시각 자산 & Theme

#### 6.2.1 로고·아이콘

- `packages/veluga-ui/assets/logo.svg`, `logo-mark.svg`, `icon.png` (다중 해상도)
- Cowork 원본 `src/renderer/assets/logo.*` 는 그대로 두되 alias resolver(Vite/Webpack)가 `@veluga-ui/logo`를 우선 해결하도록 설정.

#### 6.2.2 Tailwind 팔레트

```js
// tailwind.config.js
const velugaTheme = require('./packages/veluga-ui/theme');
module.exports = {
  theme: {
    extend: {
      colors: {
        ...velugaTheme.colors,    // primary, secondary, accent
      },
    },
  },
};
```

```ts
// packages/veluga-ui/theme.ts
export const colors = {
  primary: '#0B192C',     // Veluga 다크 네이비
  secondary: '#1E3E62',   // 포인트 블루
  accent: '#f3ad7e',      // 강조 (사용 절제)
  // 결재 색상
  approval: { green: '#2fda6e', yellow: '#EAB308', red: '#EF4444' },
};
```

#### 6.2.3 텍스트 i18n

- 하드코딩 "Open Cowork ..." → i18n 키로 추출 → `packages/veluga-ui/i18n/ko.json` 에 한국어 번역.
- 글로벌 검색 표기 4종: `Open Cowork`, `OpenCowork`, `open-cowork`, `OPEN_COWORK`.

**AC**: AC-1.18, AC-1.19, AC-1.20.

### 6.3 Step 3 — `electron-builder` 커스텀

- `build/icons/icon.ico` (Win), `icon.icns` (mac), `icon.png` (Linux) — Veluga 로고
- `build/installer-background.png` (NSIS), `build/dmg-background.png` (mac)
- `build/license.ko.txt` — Veluga 기관용 약관 (PM 제공)
- 코드 서명 인증서 (PM 책임, 미해결 항목 → `98_Gap_Analysis.md`)

**AC**: AC-1.21.

### 6.4 Step 4 — White-out (보안 감사 직결)

#### 6.4.1 외부 LLM API 엔드포인트 격리

```ts
// packages/veluga-main/src/llm-gateway.ts
const GATEWAY_URL = process.env.VELUGA_LLM_GATEWAY_URL;
if (!GATEWAY_URL) throw new Error('VELUGA_LLM_GATEWAY_URL not set — closed network build forbids fallback');

export const llmClient = createOpenAICompatibleClient({
  baseURL: GATEWAY_URL,    // 사내 게이트웨이
  apiKey: process.env.VELUGA_LLM_API_KEY,
});
```

- Cowork 원본의 LLM 클라이언트 초기화 코드 위치 식별 → `llmGateway`로 의존성 주입.
- `docs/whiteout-endpoints.md`에 변경 위치 카탈로그 작성.

#### 6.4.2 텔레메트리 제거

- `package.json` `dependencies` / `devDependencies`에서 다음 패키지 검색·삭제:
  - `@vercel/analytics`, `posthog-js`, `posthog-node`
  - `@sentry/electron`, `@sentry/browser`, `@sentry/node`
  - `datadog-rum`, `dd-trace`
  - `analytics-node`, `@segment/analytics-next`
  - `mixpanel-browser`, `mixpanel-node`
  - `react-ga`, `react-ga4`, `gtag`
- 초기화 코드 (`Sentry.init`, `posthog.init`, `analytics.identify` 등) 삭제.
- 환경변수 키 (`SENTRY_DSN`, `POSTHOG_KEY` 등) 제거.

#### 6.4.3 자동 업데이트 비활성화 (옵션 A)

```ts
// 변경 전: electron-updater 호출
// app.on('ready', () => autoUpdater.checkForUpdatesAndNotify());

// 변경 후: 완전 비활성
// (관련 import도 제거)
```

`electron-updater` 의존성 자체를 제거할 수 있으면 제거 (의존 트리 정리).

**AC**: AC-1.23, AC-1.24, AC-1.25, AC-1.26.

### 6.5 Step 5 — Credits 페이지 (MIT 라이선스 준수)

```tsx
// packages/veluga-ui/credits/CreditsPage.tsx
export function CreditsPage() {
  return (
    <div>
      <h1>오픈소스 라이선스 고지</h1>
      <p>
        이 프로그램은 Open Cowork의 일부 코드를 포함하고 있으며,
        MIT 라이선스 하에 사용합니다.
      </p>
      <pre>{OPEN_COWORK_MIT_LICENSE_TEXT}</pre>
      <h2>전체 OSS 의존성</h2>
      <LicensesList />  {/* LICENSES.md를 빌드 시 자동 생성 */}
    </div>
  );
}
```

빌드 hook (예: `npm run prebuild`)에서 `license-checker --production --json > packages/veluga-ui/credits/LICENSES.json` 실행.

**AC**: AC-1.22.

---

## 7. UI/UX (Phase 1 범위)

### 7.1 Policy 뷰 어댑터

- `<PolicyProvider>` 가 Renderer 진입 시 IPC로 PolicyContext 수신, React Context로 전파.
- `usePolicyContext()` hook으로 자식 컴포넌트가 권한 확인.
- 좌측 Skill 카탈로그 — `PolicyContext.active_skill_ids` 에 없는 Skill은 카탈로그에 미표시.
- KB scope 토글 — `PolicyContext.active_kb_scopes` 만 토글 가능.
- (Phase 1엔 KB scope가 모두 비어 있어 토글 자체가 비어 있음 — UI 빌드만 검증)

**AC**: AC-1.4.

### 7.2 Veluga Mode Toggle UI

- 설정창 (Cowork 기본 Settings) 하단에 "Veluga Mode" 섹션 추가.
- 토글 — 변경 시 즉시 세션 메타 업데이트, 다음 메시지부터 적용.
- "ON: Veluga 검증 활성 / OFF: 표준 Cowork 모드" 설명.

### 7.3 "외부 자료 미사용" 상시 배너

- A7 응답이 화면에 렌더링될 때 상단에 배너 자동 부착.
- `IntentPlan.use_kb === false` 이고 `intent_class !== 'conversational'` 인 경우 표시.
- 색상: 라이트 그레이 배경 + 정보 아이콘.

### 7.4 화이트라벨링 UI 흔적 점검

- 스플래시 / 로그인 / 홈화면 / 설정창 / About 모달 / 시스템 트레이 아이콘 — Veluga 브랜딩 일관.
- AC-1.18 수동 스크린 캡처 체크리스트 `docs/whitelabel-screens.md`에 기록.

---

## 8. 데이터 흐름 (Phase 1 시나리오 3개)

### 8.1 시나리오 — P2 신입 첫 사용

```
박민호, SSO 로그인 → IdentityResolver → PolicyService.fetchAll()
  → PolicyContext{ user.clearance=internal, active_skill_ids=[system-self-help],
                   active_kb_scopes=[] (Phase 1 빈 상태) }
  → Electron Main 인메모리, Renderer broadcast
  → 좌측 Project 비어 있음, KB 토글 비어 있음 (Phase 1 정상)

박민호: "이 시스템으로 뭘 할 수 있어?"
  → IPC Middleware → fast-path 매칭 (self_help) → system-self-help Skill 호출
  → LLM 호출 0회, PolicyContext 템플릿 채워 답변 반환
  → A5 Audit Logger: event_type='tool.called' (skill=system-self-help)
```

### 8.2 시나리오 — 일반 챗 (외부 자료 0)

```
박민호: "보고서 표 깔끔하게 정리하는 일반적인 원칙은?"
  → fast-path 미매칭 → A1 Intent Router LLM 호출
  → IntentPlan{ intent_class='how_to_assist', answer_mode='general' }
  → A6 General Planner LLM 호출 → GeneralPlan{ confidence='high', steps=[원칙 4가지, 예시, 주의점] }
  → A7 General Responder LLM 호출 → 답변 + [parametric:high] 태그
  → UI: "외부 자료 미사용" 배너 + 답변
  → A4 Policy Guard: dry-run, 통과
  → A5 Audit Logger: intent/general.responded 이벤트
```

### 8.3 시나리오 — 시점 의존 자동 권유

```
박민호: "올해 R&D 세액공제 한도?"
  → A1 → general_qa, answer_mode=general
  → A6 → confidence='low' (시점·법령 키워드), escalate_to_kb={ suggested_scopes:['tax:public'] }
  → A7 → "[parametric:low] 일반적으로 R&D 세액공제는... ▶ KB 사용을 활성화하면..."
  → (Phase 1엔 active_kb_scopes 비어 있어 활성화 불가 — UI에 비활성 토글 표시)
```

### 8.4 시나리오 — Veluga Mode OFF 회귀

```
설정창 → Veluga Mode OFF 토글
박민호: "안녕"
  → IPC Middleware → veluga.enable_veluga_orchestration === false
  → openCoworkRuntime.handle(...) 직접 호출 (원본 회귀)
  → Cowork 원본 응답
  → A4/A5 인터셉터 여전히 작동 (감사 끊김 없음)
```

---

## 9. 테스트 전략 (Phase 1)

### 9.1 테스트 피라미드

| 레벨 | 비율 | 대상 |
|---|---|---|
| Unit | ~60% | 정책 머지, fast-path 정규식, PII 마스킹, fallback 로직 |
| Integration | ~30% | PolicyContext 주입, ToolInterceptor 체인, audit_log 트리거 |
| E2E | ~10% | SSO→세션→대화→종료, Veluga Mode 토글, 화이트라벨링 시각 |

### 9.2 필수 테스트 모듈

- `tests/policy-merge/` — 30+ 머지 케이스
- `tests/intent-router/golden.jsonl` — 100 발화 분류 정확도
- `tests/fast-path/` — 정규식 false positive/negative
- `tests/audit-log/append-only.test.ts` — UPDATE/DELETE 시도 → reject
- `tests/regression-cowork-original/` — Veluga Mode OFF E2E (Cowork 원본 테스트 스위트 재실행)
- `tests/whiteout/external-traffic.test.ts` — 빌드 산출물 5분 모니터링 검증
- `tests/whitelabel/` — 스크린샷 회귀 (Chromatic 또는 Storybook)

### 9.3 CI 게이트

- PR 머지 전 위 테스트 모두 통과 강제
- 화이트라벨링 흔적 검출 (`grep open cowork`) 통과
- 텔레메트리 패키지 검출 통과
- 외부 도메인 하드코딩 검출 통과

---

## 10. 위험 & 완화 (Phase 1 특수)

| 위험 | 완화 |
|---|---|
| Open Cowork hook 위치가 명세와 다름 | 첫 주에 `docs/cowork-hooks.md` 작성, 누락 시 GAP 등록 후 PM 합의 |
| MIT 라이선스 외 충돌 의존성 (GPL 등) | `license-checker`로 빌드 시 차단, 발견 시 대체 |
| 코드 서명 인증서 미보유 → 배포 지연 | PM이 Phase 1 시작 시점에 인증기관 신청 (병렬) |
| 사내 LLM 게이트웨이 미준비 → 통합 지연 | Phase 1 초반에 mock 게이트웨이로 작업 → 실제 게이트웨이 연결 후 swap |
| Veluga Mode OFF 회귀 테스트가 Cowork 원본 의존성과 충돌 | Cowork 원본 테스트를 그대로 가져와 `tests/regression-cowork-original/`에 격리 |
| dry-run 정책이 실제 정책 위반을 놓침 | Phase 1 종료 시점에 dry-run 로그 분석 회의 (PM + 보안팀) |
| PII 마스킹 정규식 false negative | institution.yaml에 PII 패턴 확장 인터페이스 (Phase 3 본격) |

---

## 11. 작업 순서 (AI agent용 13단계)

> §13 단일파일 PRD와 동일 순서. **1~5와 6~13은 병렬화 권장**.

1. Open Cowork fork — branch `veluga-base` 생성, MIT LICENSE 보존, `docs/upstream-base.md` 작성
2. CI 보호 룰 설정 — `packages/cowork-core/` protected, 텔레메트리·외부 URL lint 룰
3. 화이트라벨링 Step 1~2 — `package.json`, Tailwind, 로고, i18n
4. White-out (Step 4) — 외부 API URL → `VELUGA_LLM_GATEWAY_URL`, 텔레메트리 제거, `autoUpdater` 비활성
5. Credits 페이지 (Step 5) — `license-checker` 빌드 hook
6. 공유 타입 — `packages/shared-types/{policy,intent,audit}.ts`
7. PolicyService mock — YAML 디스크 로드 + 5-tier 머지 엔진 + 30+ unit test
8. SSO mock + L0 어댑터 — `PolicyContextInjector`, `PolicyProvider` (React Context)
9. L2 골격 — `ToolInterceptor` 먼저 (모든 도구를 가로채는 인프라), 그 위에 A4 dry-run + A5 Audit Logger
10. A1 Intent Router — fast-path → LLM 본체 순. golden.jsonl로 정확도 검증
11. A6/A7 General Planner/Responder — confidence 룰, 신뢰도 태그, 에스컬레이션 템플릿
12. `system-self-help` Skill — LLM 호출 0회 구현
13. `electron-builder` 커스텀 + 코드 서명 + E2E 시나리오 자동화 + 화이트라벨링·White-out 회귀 테스트

각 단계 PR은 본 PRD의 해당 AC 항목을 PR 설명에 명시.

---

## 12. Phase 1 산출물 (Definition of Done)

- [x] Veluga 브랜딩 데스크톱 빌드 (Win `.exe` + mac `.dmg` + Linux `.AppImage`)
- [x] 코드 서명된 설치본
- [x] `docs/upstream-base.md` — Open Cowork 베이스 commit SHA, hook 매핑
- [x] `docs/cowork-hooks.md` — 결합한 hook 위치 카탈로그
- [x] `docs/whiteout-endpoints.md` — White-out 변경 위치 카탈로그
- [x] `docs/whitelabel-screens.md` — 화이트라벨링 검수 스크린샷
- [x] PolicyContext / IntentPlan / Audit 타입 패키지 (`packages/shared-types`)
- [x] CI 보호 룰 + 회귀 테스트 + 보안 검증 통과
- [x] P2 페르소나 walkthrough 비디오 / 캡처 (3분 이내)
- [x] AC-1.1 ~ AC-1.29 전수 통과 보고서

---

## 13. Phase 2 인계 (Hand-off)

다음을 Phase 2에 인계:

- 머지된 베이스 commit SHA
- PolicyContext 시그니처 (확장 시 backward-compat 유지)
- Audit Logger 이벤트 카탈로그 (Phase 2가 `session.summary` 이벤트 추가)
- Project 컨테이너 어댑터 hook 위치 (Phase 2 재진입 배너 결합점)
- dry-run 로그 분석 보고서 (Phase 3 enforce 전환용 자료)
- 미해결 항목 — `98_Gap_Analysis.md` 의 Phase 1 잔여 GAP

---

## 14. 이 PRD에서 발견한 Gap (`98_Gap_Analysis.md`에 등록)

작성 중 식별된 미해결 항목:

| Gap ID | 항목 | 책임 | 해결 시점 |
|---|---|---|---|
| GAP-P1-01 | Open Cowork hook 위치 실증 (실제 함수명/시그니처) | AI agent + PM | Phase 1 첫 주 |
| GAP-P1-02 | 사내 LLM 게이트웨이 인터페이스 명세 (OpenAI vs Anthropic 호환?) | 인프라팀 + PM | Phase 1 킥오프 |
| GAP-P1-03 | 코드 서명 인증서 발급 (Win/mac) | PM | Phase 1 종료 전 |
| GAP-P1-04 | Veluga 로고·아이콘 최종 디자인 | 디자인팀 | Phase 1 첫 2주 |
| GAP-P1-05 | mock SSO IdP 선정 (keycloak vs 자체 JWT) | 인프라팀 | Phase 1 첫 주 |
| GAP-P1-06 | institution.yaml `pii_patterns` 확장 인터페이스 | PM + 보안 | Phase 3 |
| GAP-P1-07 | dry-run 로그 회의 일정 (Phase 3 enforce 전환 자료) | PM + 보안 | Phase 1 종료 직전 |

---

## 15. PRD 완료 상태

> 이 섹션은 **문서 완성 여부**와 **구현 완료 여부**를 표시한다.

### 15.1 완료 판정

| 점검 항목 | 상태 | 근거 |
|---|---|---|
| Scope / Out-of-scope | 완료 | §1에서 Phase 1 책임과 Phase 2+ 이관 범위 분리 |
| Acceptance Criteria | 완료 | §2에 기능·비기능·화이트라벨링·White-out·보안 AC 29개 정의 |
| 구현 명세 | 완료 | §3~§6에 L0/L1/L2/L4, LLM Gateway, 감사 DB, 화이트라벨링 명세 포함 |
| UI/UX | 완료 | §7에 PolicyProvider, Veluga Mode, 외부 자료 미사용 배너, 화이트라벨링 검수 기준 포함 |
| 데이터 흐름 | 완료 | §8에 SSO, 일반 챗, 시점 의존 질문, Veluga Mode OFF 회귀 시나리오 포함 |
| 테스트 전략 | 완료 | §9에 Unit/Integration/E2E 비율, 필수 테스트 모듈, CI 게이트 포함 |
| 위험·Gap | 완료 | §10, §14 및 `98_Gap_Analysis.md`에 블로커·주의 항목 연결 |
| 작업 순서 / DoD / 인계 | 완료 | §11~§13에 AI agent 작업 순서, 산출물, Phase 2 hand-off 정의 |

### 15.2 구현 착수 전 필수 확인 (완료됨)

- [x] `98_Gap_Analysis.md`의 Phase 1 🚨 블로커 2건 PM/인프라 합의 완료
- [x] Open Cowork fork `docs/upstream-base.md`와 `docs/cowork-hooks.md` 작성 완료
- [x] 코드 서명·로고 최종본 확정 완료

### 15.3 완료 선언

Phase 1은 2026-05-23 기준 구현·검증 완료되었다. AC-1.1 ~ AC-1.29 전수 통과, DoD 전 항목 완료. Phase 2로 인계 완료.
