# 99 — Appendix (공유 스키마 · 디렉터리 · 결정 로그 · 카탈로그)

> **이 문서의 역할**: 모든 Phase PRD가 공유하는 자료 정의. AI coding agent가 코딩 중 수시 참조.
>
> **범위 알림**: 본 Appendix는 **Veluga가 만들 코드의 스키마·디렉터리**만 다룬다. 외부 KB 시스템(인덱스 저장소·임베딩·ingest·DB 스키마)은 본 PRD 범위 밖이며, 이 문서에 KB 서버 측 구현 스키마는 포함하지 않는다. Veluga가 호출하는 *contract 시그니처*만 §5에 남긴다.

---

## 1. PolicyContext 인터페이스 (TypeScript)

```ts
// packages/shared-types/src/policy.ts
export type Clearance = 'public' | 'internal' | 'confidential' | 'secret';
export type HitlMode = 'strict' | 'normal' | 'relaxed';
export type PolicyGuardMode = 'enforce' | 'dry-run';

export interface PolicyContext {
  policy_version_id: string;                  // 감사 추적용 (모든 audit 이벤트에 동봉)
  user: {
    user_id: string;
    dept: string;
    roles: string[];
    clearance: Clearance;
  };
  institution: InstitutionPolicyMerged;
  org: OrgPolicyMerged;
  project?: ProjectPolicyMerged;
  effective: {
    external_apis: 'allow' | 'deny';
    audit_log: 'required' | 'optional';
    unverified_quotes: 'allow' | 'warn' | 'deny';
    approval_for_destructive: 'required' | 'optional';
    retention_default_days: number;
  };
  active_kb_scopes: string[];
  active_skill_ids: string[];
  active_mcp_connectors: string[];
  veluga: {
    enable_veluga_orchestration: boolean;
    policy_guard_mode: PolicyGuardMode;
    kb_token_budget?: number;
  };
  hitl_mode: HitlMode;

  // helpers
  hasSkill(id: string): boolean;
  hasKbScope(scope: string): boolean;

  // 변경 알림
  subscribe(listener: (next: PolicyContext) => void): () => void;
}
```

### 1.1 5-tier 머지 룰 (요약)

1. **deny 우선** — 상위 deny는 하위가 덮을 수 없다.
2. **상위 미명시만 하위가 채울 수 있다**.
3. `active_kb_scopes = (org.kb_scopes ∪ user.kb_extra_scopes) ∩ project.allowed_scopes`
4. `active_skill_ids = ((org.default_skills ∪ user.extra_skills) ∪ project.active_skills) \ user.denied_skills`
5. `external_apis`: institution → org → project → user → session 순 deny 우선
6. `veluga.enable_veluga_orchestration`: session > institution.default
7. `clearance`: user.clearance (단, project가 추가 제한 명시 시 좁힘)

머지 함수: `packages/policy-service/src/merge.ts` + 30+ unit test.

---

## 2. L2 에이전트 입출력 시그니처

### 2.1 IntentPlan

```ts
// packages/shared-types/src/intent.ts
export type IntentClass =
  | 'conversational' | 'general_qa' | 'how_to_assist' | 'planning_assistance'
  | 'summarize_project' | 'draft_with_grounding' | 'compare_project_vs_kb'
  | 'compliance_check' | 'format_conversion';

export type AnswerMode = 'general' | 'project_only' | 'kb_grounded' | 'mixed';

export interface IntentPlan {
  intent_class: IntentClass;
  answer_mode: AnswerMode;
  use_kb: boolean;
  kb_scopes: string[];
  suggested_skills: string[];
  needs_clarification: boolean;
  clarification_questions: string[];
  fast_path_hit?: 'greeting' | 'thanks' | 'ack' | 'self_help' | 'explicit_skill';
}
```

### 2.2 GateDecision (A2)

```ts
export interface GateDecision {
  allow: boolean;
  reason: string;
  scope_overrides?: string[];
  alternatives?: AlternativeProposal[];
}

export interface AlternativeProposal {
  kind: 'project_file' | 'lower_scope' | 'narrower_scope';
  description: string;
  payload: any;
}
```

### 2.3 SkillActivationPlan (A3)

```ts
export interface SkillActivationPlan {
  ordered_skills: SkillStep[];
  rationale: string;
  data_passing: 'project_temp' | 'memory';
}

export interface SkillStep {
  id: string;
  mode: 'read' | 'write';
  args?: any;
}
```

### 2.4 GuardDecision (A4)

```ts
export type GuardDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'require_approval'; prompt: string; scope: 'this_call' | 'session' };

export type ToolPrivilege = 'PUBLIC' | 'WRITE_LOCAL' | 'PRIVILEGED';
```

### 2.5 GeneralPlan / Response (A6/A7)

```ts
export interface GeneralPlan {
  confidence: 'high' | 'medium' | 'low' | 'refuse';
  category: 'conversational' | 'common_knowledge' | 'how_to' | 'user_planning' | 'out_of_scope';
  steps: string[];
  escalate_to_kb: null | { reason: string; suggested_scopes: string[] };
  knowledge_boundaries: string[];
}

export interface GeneralResponse {
  text: string;                       // 답변 본문 (신뢰도 태그 포함)
  citation_tags: CitationTag[];       // 부착된 태그 카탈로그
  escalation_offered: boolean;
}

export type CitationTag =
  | { kind: 'kb'; doc_id: string; as_of: string }
  | { kind: 'nb'; file_id: string; chunk_id: string }
  | { kind: 'parametric'; level: 'high' | 'low' };
```

---

## 3. Agent LLM 시스템 프롬프트 (요지)

> 전체 프롬프트는 `prompts/` 디렉터리에 별도 파일로 관리. 본 섹션은 핵심 룰만.

### 3.1 A1 Intent Router

```
당신은 라우터다. 사용자 발화 + Project 메타 + KB scope 목록을 받아
IntentPlan JSON 하나만 반환한다.

규칙:
- 일상 대화·상식·how-to는 answer_mode="general" → A6/A7로
- Project 자료만으로 충분 → answer_mode="project_only", use_kb=false
- 인용·근거·법령·정책 키워드 → answer_mode="kb_grounded", use_kb=true
- "이 자료가 가이드라인에 부합?" 류 → answer_mode="mixed"
- 모호하면 needs_clarification=true
- suggested_skills는 PolicyContext.active_skill_ids 교집합만
- 출력은 strict JSON, schema 위반 시 retry
```

### 3.2 A6 General Planner

```
당신은 답변 계획자다. 외부 자료를 보지 않는다.
GeneralPlan JSON 하나만 반환한다.

자동 confidence 규칙:
- 시점 키워드 (최근/현재/올해 등) → "low"
- 기관 키워드 (우리 회사/사내 등) → "low"
- 법령·통계 키워드 → "low" + escalate_to_kb 자동 권유
- 보편 상식·정의 → "high" 후보

refuse 영역:
- 법률 자문, 의료 진단, 개인정보, institution 금기 주제
```

### 3.3 A7 General Responder

```
당신은 응답자다. A6의 plan에 따라 답변을 작성한다.

룰 (절대):
1. 각 문단 끝에 [parametric:high] 또는 [parametric:low] 부착
2. "아마/일반적으로/통상" 표현 → [parametric:low] 강제
3. 모르는 것은 "모릅니다" — 추측 금지
4. A6.escalate_to_kb 가 있으면 말미에 KB 활성 권유
5. 결재 문서 본문 텍스트 요청은 거절 또는 KB 권유
```

---

## 4. Audit Logger 이벤트 카탈로그 (전체)

| event_type | payload 주요 필드 | 도입 Phase |
|---|---|---|
| `session.start` | `policy_version_id`, `user_id`, `active_project` | Phase 1 |
| `session.end` | `turn_count`, `duration_ms` | Phase 1 |
| `session.summary` | `last_summary`, `skills_invoked`, `llm_invocations`, `tokens_used` | Phase 2 |
| `intent.classified` | `utterance_hash`, `intent_plan` | Phase 1 |
| `policy.violation_detected` | `tool`, `args_masked`, `reason` (dry-run에서) | Phase 1 |
| `policy.updated` | `policy_version_id_old`, `policy_version_id_new`, `diff` | Phase 1 |
| `gate.decided` | `intent_plan_id`, `allow`, `reason`, `alternatives` | Phase 3 |
| `skill.activated` | `skill_id`, `mode`, `rationale` | Phase 1 |
| `style_card.extracted` | `card_id`, `source_files`, `llm_invocations` | Phase 2 |
| `tool.called` | `tool`, `args_masked`, `result_hash`, `latency_ms`, `sandboxed?` | Phase 1 |
| `tool.unregistered` | `tool`, `args_masked` (Phase 1 경고 → Phase 3 deny) | Phase 1 |
| `hitl.requested` | `prompt`, `scope` | Phase 1 |
| `hitl.resolved` | `approved_by`, `decision`, `comment` | Phase 1 |
| `kb.queried` | `query`, `scopes`, `as_of_date`, `returned_doc_ids`, `routing_explain` | Phase 3 |
| `kb.unavailable` | `reason`, `attempts` (외부 KB 부재·timeout 시 fallback 발동) | Phase 3 |
| `kb.over_classification` | `doc_id`, `chunk_id`, `redacted_classification`, `user_clearance` (kb-redactor 안전망) | Phase 3 |
| `citation.linked` | `output_artifact_id`, `kb_node_ids[]` 또는 `nb_file_ids[]` | Phase 2 (nb) / Phase 3 (kb) |
| `unverified.detected` | `tag`, `position`, `reason` | Phase 2 |
| `general.responded` | `confidence`, `escalation_offered`, `escalation_accepted` | Phase 1 |
| `compliance.checked` | `report_id`, `findings[]`, `verdict` | Phase 3 (basic) / Phase 4 (full) |
| `approval.submitted` | `report_id`, `approver`, `compliance_verdict` | Phase 4 |
| `approval.granted` | `approval_id`, `approver`, `sealed_path` | Phase 4 |
| `approval.rejected` | `approval_id`, `approver`, `comment` | Phase 4 |
| `seal.verify_failed` | `sealed_path`, `expected_hash`, `actual_hash` | Phase 4 |
| `sandbox.run` | `tool`, `container_id`, `exit_code` | Phase 4 |

---

## 5. 외부 KB MCP — Veluga 호출 contract (consumer 시그니처)

> **본 절은 Veluga가 외부 KB에 *호출하는 입력*과 *기대하는 출력 형태*만 정의한다. 외부 KB의 인덱스 저장소, 임베딩, 청킹, 랭킹, ingest, 권한 검증 구현은 외부 운영 주체 책임이며 본 PRD 범위 밖이다.** 외부 KB가 다른 형태를 노출한다면 Phase 3 첫 주 `GAP-P3-01`에서 합의 후 어댑터(`packages/veluga-main/src/kb/kb-mcp-adapter.ts`)가 변환한다.

### 5.1 Phase 3 도구 contract

```
kb_search(KbSearchInput)   -> KbSearchOutput
kb_metadata(KbMetadataInput) -> KbMetadataOutput
kb_hybrid(KbHybridInput)   -> KbHybridOutput
```

상세 시그니처는 `03_Phase3_KB.md` §3.3 참조. Zod 스키마 위치: `packages/veluga-main/src/kb/kb-contract.ts`.

### 5.2 Phase 4 도구 contract (추가)

```
kb_traverse(KbTraverseInput) -> KbTraverseOutput
```

상세 시그니처는 `04_Phase4_Approval.md` §3 참조.

### 5.3 권한 이중 방어 (consumer 관점)

- **Veluga측 (A2 Knowledge Gate)**: 외부 KB 호출 *전*에 PolicyContext 기반 권한·정책·예산을 검증해 차단.
- **외부 KB측**: 외부 운영 주체가 자체 권한 검증을 수행한다고 가정 (PolicyContext 토큰 전달 방식은 `GAP-P3-04`).
- **Veluga측 안전망 (kb-redactor)**: 외부 KB가 over-classified chunk를 반환한 경우 응답에서 자동 redact + `kb.over_classification` audit 이벤트.

이 셋이 일치하지 않는 케이스(예: Gate 통과 + 외부 KB 권한 거부)는 즉시 GAP으로 등록.

---

## 6. LLM Gateway 인터페이스 (사내 게이트웨이)

### 6.1 추상 인터페이스

```ts
// packages/veluga-main/src/llm-gateway.ts
export interface LlmGateway {
  chat(req: ChatRequest): Promise<ChatResponse>;
  // 임베딩은 외부 KB가 자체 수행. Veluga LLM Gateway 에서는 chat 만 사용한다.
}

export interface ChatRequest {
  model: string;          // 사내 게이트웨이에서 매핑하는 모델 별칭
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  json_schema?: object;   // strict JSON 강제용
}

export interface ChatResponse {
  text: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  model: string;
}
```

### 6.2 환경변수

| 변수 | 의미 | Phase |
|---|---|---|
| `VELUGA_LLM_GATEWAY_URL` | 사내 게이트웨이 base URL (필수, 미설정 시 throw) | Phase 1 |
| `VELUGA_LLM_API_KEY` | 게이트웨이 인증 키 | Phase 1 |
| `VELUGA_LLM_DEFAULT_MODEL` | 기본 chat 모델 별칭 | Phase 1 |
| (`embed()` 인터페이스는 외부 KB가 자체적으로 임베딩을 수행하므로 Veluga LLM Gateway 에서는 사용하지 않는다 — Phase 3 범위 밖) | | |
| `VELUGA_POLICY_DIR` | mock 정책 YAML 디렉터리 | Phase 1 |
| `VELUGA_POLICY_SOURCE` | `mock` 또는 `rpc` | Phase 3 |
| `VELUGA_POLICY_SIMULATE_OUTAGE` | 장애 시뮬레이션 (테스트 전용) | Phase 1 |
| `VELUGA_KB_MCP_URL` | **외부** KB MCP 서버 URL (consumer 어댑터 연결용; 미설정 시 KB connector 비활성) | Phase 3 |
| `VELUGA_KB_MCP_CMD` | 예약 항목. stdio 기반 외부 KB connector가 필요한 기관용 후속 확장 후보이며, Phase 3 완료 구현은 URL 기반 `VELUGA_KB_MCP_URL` 또는 injected `KbMcpClient`를 사용한다. | Phase 3+ |
| `VELUGA_KB_TIMEOUT_MS` | 예약 항목. 현재 구현은 `KbMcpAdapter({ timeoutMs })` 옵션과 기본 1500ms timeout을 사용한다. 환경변수 wiring은 후속 운영 확장. | Phase 3+ |

### 6.3 호환성

게이트웨이가 **OpenAI 호환** 인터페이스를 노출하는 것을 가정. Anthropic 호환이라면 별도 어댑터 작성. → 정확한 결정은 GAP-P1-02.

---

## 7. 리포지토리 디렉터리 구조 (전체)

```
veluga/
├── README.md
├── docs/
│   ├── upstream-base.md            # Open Cowork 베이스 commit
│   ├── upstream-sync-<date>.md     # 매 Phase 종료 시 diff 리포트
│   ├── cowork-hooks.md             # 실제 발견된 hook 매핑
│   ├── whiteout-endpoints.md       # White-out 변경 위치 카탈로그
│   ├── whitelabel-screens.md       # 화이트라벨링 검수
│   ├── open-questions.md           # 임의 결정 금지 — 질문 누적
│   ├── connector-approval-spec.md  # Phase 4 결재시스템 connector 표준
│   ├── sandbox-ops.md              # Phase 4 Docker 운영
│   └── architecture-diagrams/
├── packages/
│   ├── cowork-core/                # [PROTECTED] Open Cowork fork 본체
│   ├── veluga-main/                # Electron Main Process 어댑터
│   │   ├── src/
│   │   │   ├── policy-injector.ts
│   │   │   ├── ipc-middleware.ts
│   │   │   ├── tool-interceptor.ts
│   │   │   ├── project-reentry.ts
│   │   │   ├── audit-logger.ts
│   │   │   ├── llm-gateway.ts
│   │   │   ├── whiteout-endpoints.ts
│   │   │   ├── kb/                  # 외부 KB MCP/API consumer 어댑터 (Phase 3+)
│   │   │   │   ├── kb-mcp-adapter.ts    # connector 등록·헬스체크·재시도·fallback
│   │   │   │   ├── kb-contract.ts       # Zod 입출력 스키마 (런타임 검증)
│   │   │   │   └── kb-redactor.ts       # over-classification 안전망
│   │   │   ├── sandbox/
│   │   │   │   ├── docker-runner.ts
│   │   │   │   └── spec.yaml
│   │   │   └── agents/
│   │   │       ├── intent-router.ts
│   │   │       ├── knowledge-gate.ts
│   │   │       ├── skill-resolver.ts
│   │   │       ├── policy-guard.ts
│   │   │       ├── general-planner.ts
│   │   │       └── general-responder.ts
│   ├── veluga-renderer/            # React 컴포넌트 어댑터
│   │   ├── src/
│   │   │   ├── PolicyProvider.tsx
│   │   │   ├── policy-bindings.ts
│   │   │   ├── project-reentry-banner.tsx
│   │   │   ├── VelugaModeToggle.tsx
│   │   │   ├── ExternalDataBanner.tsx
│   │   │   └── artifacts/
│   │   │       └── approval-queue.tsx
│   ├── veluga-ui/                  # 화이트라벨링 자산 분리
│   │   ├── theme.ts
│   │   ├── assets/                 # logo, icon, splash, installer-bg
│   │   ├── i18n/                   # ko.json, en.json
│   │   └── credits/
│   │       ├── CreditsPage.tsx
│   │       └── LICENSES.md         # license-checker 자동 생성
│   ├── shared-types/               # Zod schemas, TS types
│   │   ├── policy.ts
│   │   ├── intent.ts
│   │   ├── audit.ts
│   │   ├── citation.ts
│   │   └── index.ts
│   # NOTE: 외부 KB MCP 서버 패키지는 본 PRD 범위 밖이다.
│   #       Veluga측 consumer 어댑터는 packages/veluga-main/src/kb/ 에 있다.
│   #       Phase 3 완료 구현은 URL 기반이며, stdio connector는 후속 확장 후보이다.
│   ├── policy-service/             # mock + RPC 서버
│   │   ├── src/
│   │   │   ├── mock-server.ts
│   │   │   ├── rpc-client.ts       # Phase 3 client contract
│   │   │   ├── sso/
│   │   │   │   ├── saml.ts
│   │   │   │   ├── oidc.ts
│   │   │   │   └── internal.ts
│   │   │   └── merge.ts
│   │   └── dev-policies/           # 샘플 YAML
│   └── connectors/                 # 사이트별 결재시스템 어댑터 (Phase 4+)
│       └── approval-mock/
├── skills/
│   ├── core/
│   │   ├── citation-verifier/
│   │   ├── citation-tracer/        # Phase 4 — 외부 KB graph traversal consumer
│   │   ├── compliance-checker/
│   │   ├── style-card/
│   │   └── system-self-help/
│   ├── domain/                     # 모두 외부 KB consumer Skill
│   │   ├── gov-proposal/
│   │   ├── policy-research/
│   │   ├── legal-opinion/
│   │   └── budget-review/
│   ├── format/
│   │   ├── docx/
│   │   ├── pptx/
│   │   ├── xlsx/
│   │   └── pdf/
│   └── user/
│   # NOTE: kb-ingest Skill 은 본 PRD에서 제거되었다.
│   #       KB 적재 게이트는 외부 KB 운영 주체 책임이며 Veluga가 노출하지 않는다.
├── policies/                       # 운영용 정책 샘플
│   ├── institution.example.yaml
│   ├── org.example.yaml
│   ├── project.example.yaml
│   └── user.example.yaml
├── prompts/                        # LLM 시스템 프롬프트 (i18n 가능)
│   ├── intent-router.ko.md
│   ├── general-planner.ko.md
│   └── general-responder.ko.md
├── tests/
│   ├── e2e/
│   ├── regression-cowork-original/
│   ├── policy-merge/
│   ├── intent-router/
│   ├── fast-path/
│   ├── kb-contract/                # Zod 검증, redactor, fallback (외부 KB consumer 회귀)
│   ├── fixtures/
│   │   └── kb-mcp-mock/            # 외부 KB가 부재한 dev/CI 환경용 mock 서버 픽스처
│   ├── knowledge-gate/
│   ├── citation-verifier/
│   ├── citation-tracer/
│   ├── compliance-full/
│   ├── approval-queue/
│   ├── sandbox/
│   ├── seal/
│   ├── whiteout/
│   └── whitelabel/
└── build/
    ├── icons/                      # .ico, .icns, .png
    ├── installer-background.png
    ├── dmg-background.png
    └── license.ko.txt
```

---

## 8. SQLite 스키마 (전체)

### 8.1 audit_log (Phase 1)

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
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

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(FAIL, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(FAIL, 'audit_log is append-only'); END;
```

### 8.2 approvals (Phase 4)

```sql
CREATE TABLE approvals (
  approval_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL,             -- submitted|ready_for_review|approved|rejected|revising
  compliance_verdict TEXT,          -- green|yellow|red
  comment TEXT,
  sealed_path TEXT
);
CREATE INDEX idx_approvals_approver ON approvals(approver_id);
CREATE INDEX idx_approvals_status ON approvals(status);
```

### 8.3 citations (Phase 2 → Phase 4 확장)

```sql
CREATE TABLE citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  output_artifact_id TEXT NOT NULL,
  citation_tag TEXT NOT NULL,
  kind TEXT NOT NULL,               -- kb|nb|parametric
  doc_id TEXT,                       -- kb 인 경우
  file_id TEXT,                      -- nb 인 경우
  as_of_date TEXT,
  verified BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX idx_citations_artifact ON citations(output_artifact_id);
CREATE INDEX idx_citations_kind ON citations(kind);
```

---

## 9. Cowork 변경 금지 영역 (CI 보호)

```yaml
# .github/workflows/protected-paths.yml
on: [pull_request]
jobs:
  protected-paths:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Reject changes in cowork-core
        run: |
          if git diff --name-only origin/main...HEAD | grep -E "^packages/cowork-core/"; then
            echo "::error::packages/cowork-core/ is protected."; exit 1; fi
      - name: Reject telemetry packages
        run: |
          if grep -rE "(posthog|@sentry|@vercel/analytics|datadog|@segment|mixpanel|react-ga)" packages/*/package.json; then
            echo "::error::Telemetry package forbidden."; exit 1; fi
      - name: Reject hardcoded external LLM URLs
        run: |
          if grep -rE "api\.(anthropic|openai)\.com" packages/veluga-*; then
            echo "::error::Use VELUGA_LLM_GATEWAY_URL."; exit 1; fi
      - name: Reject Cowork MIT LICENSE deletion
        run: |
          if [ ! -f packages/cowork-core/LICENSE ]; then
            echo "::error::Open Cowork LICENSE must be preserved."; exit 1; fi
```

---

## 10. 글로벌 결정 로그 (Phase 1~4 누적)

| 결정 | 사유 | 도입 시점 |
|---|---|---|
| Open Cowork fork (vs from scratch) | 설계안 v1.2 L1 100% 일치 | Overview |
| Open Cowork MIT 라이선스 확정 | 화이트라벨링 완전 허용 | Overview |
| Kuse Cowork는 fork 아닌 벤치마킹 | 보안 패턴만 필요 | Overview |
| **기관 KB는 외부 시스템 — Veluga는 MCP/API consumer만** | "안 만들기" 원칙, 운영 책임 분리, 권한 이중 방어 | Overview (v1.1) |
| 외부 KB consumer 어댑터(`packages/veluga-main/src/kb/`) — 권한 머지·redact·fallback 책임만 | 외부 KB 인터페이스 변경 흡수, 폐쇄망 안정성 | Phase 3 |
| Veluga Mode Feature Toggle Phase 1부터 | 회귀 안전망 | Overview |
| Phase 1에 General Planner/Responder 포함 | 빈 시스템 막막함 회피 + 신뢰도 태그 인프라 | Overview |
| Project tier 추가 (5-tier 정책) | 사용성 점검 G9 | Overview |
| `approval-queue`는 Artifact (세션 아님) | 결재자 다중 세션 회피 | Overview |
| `last_session_summary`는 Audit Logger 부수효과 | 별도 에이전트 추가 회피 | Overview |
| 화이트라벨링 자산 `packages/veluga-ui/` 분리 | upstream 머지 안전 | Overview |
| 외부 텔레메트리 전수 제거 | 보안 감사 통과 | Overview |
| Phase 1에 자동 업데이트 비활성화 (옵션 A) | 가장 안전 | Phase 1 |
| Policy Guard Phase 1~2 dry-run → Phase 3+ enforce | 정책 누락 우회 회피 | Phase 1 |
| LLM Gateway = OpenAI 호환 가정 (chat 전용; 임베딩은 외부 KB 책임) | 표준 인터페이스 + 인프라팀 확정 대기 | Phase 1 |
| Skill Resolver 카탈로그+룰 우선, LLM 후순위 | 폐쇄망 결정성 | Phase 3 |
| docx footnote default citation style | 결재용 가독성 | Phase 2 |
| compliance-checker basic = 10룰, full = 25+ | 점진적 도입 | Phase 3/4 |
| Docker rootless + cap_drop=ALL + network none | Kuse 패턴 보안 강도 보존 | Phase 4 |
| 봉인 파일은 결재 통과 시점에 생성 (사후 변조 검증) | 결재 신뢰 계약 | Phase 4 |
| kb-ingest Skill 제거 — KB 적재 게이트는 외부 운영 주체 책임 | "안 만들기" 원칙 강화 | Phase 3 (v1.1) |
| Phase 3 KB consumer는 URL 기반 `KbMcpClient` + mock client contract로 완료 처리 | Veluga는 외부 KB 서버를 소유하지 않으므로 실서비스 SLA는 Gap으로 분리 | Phase 3 구현 완료 |
| Phase 4 approval-line은 mock approval connector + HMAC seal + Docker args hardening으로 1차 완료 | 기관별 결재시스템·PKI·base image 승인은 운영 인수 항목 | Phase 4 구현 완료 |
| approval-queue 기본 정렬은 녹색 먼저, 제출일 오름차순 | 오래된 결재 대기를 먼저 해소하고 위험 항목은 별도 집중 검토 | Phase 4 구현 완료 |
| **KB 연결을 `KbConnectorPlugin` 플러그인 패턴으로 추상화 — 기본값 OFF** | 외부 KB API 미확정 상태에서도 Veluga 실행 가능, API 변경 시 플러그인만 교체, 기관별 다른 백엔드 수용 | Phase 3 이후 (2026-05-23) |

신규 결정은 본 카탈로그에 추가.

---

## 11. Skill SKILL.md 템플릿

```markdown
---
id: gov-proposal
version: 1.0.0
category: domain                     # core | domain | format | user
required_clearance: internal
required_scopes: [law:public]
depends_on: [style-card]
hitl: false
inputs:
  - name: project_files
    type: file[]
outputs:
  - name: draft
    type: text+citation_tags
---

# gov-proposal

(시스템 프롬프트 + 도구 호출 방식 명세)
```

Skill 핸들러:

```ts
// skills/<id>/handler.ts
export async function handle(ctx: SkillContext): Promise<SkillOutput> {
  // ctx.policyContext, ctx.mcp, ctx.llmGateway, ctx.project ...
}
```

---

## 12. 페르소나·시나리오 → Phase·AC 매핑

| 페르소나 | 시나리오 | 도입 Phase | 핵심 AC |
|---|---|---|---|
| P1 | Project 자료 요약 | Phase 2 | AC-2.3 |
| P1 | KB 근거 보고서 작성 | Phase 3 | AC-3.9 |
| P1 | 결재 직전 점검 (개정 발견) | Phase 4 | AC-4.3, AC-4.4 |
| P2 | 신입 첫 사용 (system-self-help) | Phase 1 | AC-1.12 |
| P2 | 일반 챗 (외부 자료 0) | Phase 1 | AC-1.11 |
| P2 | 시점 의존 자동 에스컬레이션 | Phase 1 + 3 | AC-1.10, AC-3.13 |
| P3 | 결재자 단일 Artifact 8건 일괄 | Phase 4 | AC-4.7, AC-4.14 |
| P3 | 반려 + 작성자 notification | Phase 4 | AC-4.10 |
| P4 | 사용자 등록 + 권한 가시화 | Phase 1 | AC-1.2 |
| P4 | 외부 KB 운영팀과 연동 점검 (Veluga 어댑터 + 외부 KB SLA 검증) | Phase 3 | AC-3.1, AC-3.2 |

---

## 13. 회귀 테스트 카탈로그

| 테스트 군 | 도입 | 회귀 대상 Phase |
|---|---|---|
| Cowork 원본 E2E | Phase 1 | 모든 Phase (Veluga Mode OFF) |
| Policy 머지 unit | Phase 1 | 모든 Phase |
| Intent Router golden | Phase 1 (100), Phase 2 (+30), Phase 3 (+50) | 모든 Phase |
| Fast-path 정규식 | Phase 1 | 모든 Phase |
| Audit append-only | Phase 1 | 모든 Phase |
| White-out external traffic | Phase 1 | 모든 Phase (특히 Phase 4 sandbox) |
| Whitelabel screens | Phase 1 | 모든 Phase (UI 변경 시) |
| Citation verifier (NB) | Phase 2 | Phase 3, 4 |
| Style card cache | Phase 2 | Phase 3, 4 |
| docx watermark / footnote | Phase 2 | Phase 3, 4 |
| Project reentry banner | Phase 2 | Phase 3, 4 |
| KB contract (Zod + redactor + fallback) | Phase 3 | Phase 4 |
| Knowledge gate cases | Phase 3 | Phase 4 |
| Skill resolver dependency | Phase 3 | Phase 4 |
| Citation tracer revision (외부 KB graph consumer) | Phase 4 | — |
| Compliance full rules | Phase 4 | — |
| approval-queue E2E | Phase 4 | — |
| Sandbox escape | Phase 4 | — |
| Seal verify | Phase 4 | — |

---

## 14. 환경변수 카탈로그 (전체)

| 변수 | 도입 | 의미 |
|---|---|---|
| `VELUGA_LLM_GATEWAY_URL` | Phase 1 | 사내 LLM 게이트웨이 base URL |
| `VELUGA_LLM_API_KEY` | Phase 1 | 게이트웨이 인증 |
| `VELUGA_LLM_DEFAULT_MODEL` | Phase 1 | chat 기본 모델 별칭 |
| `VELUGA_POLICY_DIR` | Phase 1 | mock 정책 YAML 디렉터리 |
| `VELUGA_POLICY_SOURCE` | Phase 3 | `mock` 또는 `rpc` |
| `VELUGA_POLICY_RPC_URL` | Phase 3 | RPC PolicyService URL |
| `VELUGA_POLICY_SIMULATE_OUTAGE` | Phase 1 | 장애 시뮬레이션 |
| `VELUGA_KB_MCP_URL` | Phase 3 | `HttpKbConnectorPlugin` 생성 시 사용할 외부 KB MCP 서버 URL. **미설정이면 `KbConnectorRegistry`에 플러그인이 등록되지 않아 KB가 완전 비활성화됨.** |
| `VELUGA_KB_MCP_CMD` | Phase 3+ | 예약 항목. stdio 기반 외부 KB connector 후속 확장 후보 |
| `VELUGA_KB_TIMEOUT_MS` | Phase 3+ | 예약 항목. 현재 구현은 `KbMcpAdapter({ timeoutMs })` 옵션과 기본 1500ms timeout 사용 |
| `VELUGA_SANDBOX_IMAGE` | Phase 4 | Docker 샌드박스 이미지 태그 |
| `VELUGA_SEAL_HMAC_KEY` | Phase 4 | 봉인 HMAC 키 (PKI 미도입 시) |
| `VELUGA_APPROVAL_CONNECTOR` | Phase 4 | 사용 중인 결재시스템 어댑터 식별자 |

> 임베딩 모델·Vector DB·RDB·Graph DB 환경변수는 **외부 KB 운영 주체의 인프라**이므로 Veluga 환경변수 카탈로그에서 제외한다.

---

## 15. 한 줄 요약 (다시)

> *L1은 Open Cowork fork로 무료로 얻고 Veluga로 화이트라벨링한다. Veluga가 만들 코드는 **L0 정책·L2 7개 에이전트·L4 Skill** — 이 셋에 집중. **L3 기관 KB는 외부 의존(MCP/API consumer)이며 본 PRD 범위 밖**. Veluga Mode 토글로 점진적·안전하게 도입한다.*
