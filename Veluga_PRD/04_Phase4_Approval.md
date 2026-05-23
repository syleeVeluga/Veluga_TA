# 04 — Phase 4: Approval Line (결재 라인 진입)

> **목표 한 줄**: 작성자가 올린 보고서가 인용 그래프 검증·컴플라이언스 점검을 거쳐 결재자에게 흘러가고, 결재자는 단일 Artifact 한 페이지에서 다수 결재를 일괄 처리하는 단계. Veluga의 차별화 가치(C4 결재자 동선, C5 KB-결재 정합성)가 완성된다.
>
> **기간**: 6~8주
> **선행**: Phase 3 머지 완료 (외부 KB consumer 어댑터 + Knowledge Gate + Policy Guard enforce)
> **후속**: (Phase 5+ — 팀 Project, 결재시스템 외부 connector 표준화)
> **문서 상태**: ✅ 구현 완료 (2026-05-23 기준 Phase 4 구현·검증 완료, 실제 기관 결재시스템/외부 KB graph 운영은 Gap으로 별도 추적)
>
> **이 PRD 단독으로 작업 가능**: ✅
>
> **범위 재확인 (v1.1)**: 본 Phase에서 **KB Graph 저장소(Neo4j 등)·ETL 파이프라인·revisions 데이터 큐레이션은 만들지 않는다**. 외부 KB가 graph traversal 기능을 제공한다고 가정하고, Veluga는 `kb_traverse` MCP 도구의 **consumer**로만 결합한다. citation-tracer Skill은 외부 KB 응답을 소비하여 결재 의사결정 자료를 만든다.

---

## 1. 범위

### 1.1 In-scope (Veluga가 만들 것)

| 영역 | 산출물 |
|---|---|
| **외부 KB graph consumer 어댑터 확장** | Phase 3 어댑터에 `kb_traverse` 도구 호출 contract만 추가. **그래프 저장소·ETL은 외부 책임.** |
| **L4 — `citation-tracer`** | 보고서의 모든 인용을 외부 KB `kb_traverse` 응답으로 분석, 개정·폐지 자동 발견 |
| **L4 — `compliance-checker` full** | parametric 차단, nb/kb 섹션 분리, citation 정합성 결합, 룰 카탈로그 25+ |
| **L1 UI — `approval-queue` Artifact** | 결재자 단일 페이지 (녹/황/적 + 일괄 승인 + 반려 + 인용 트리) |
| **반려/승인 workflow** | Cowork notification으로 작성자에게 결과 push |
| **결재시스템 MCP connector** | 표준 인터페이스 + 사이트별 어댑터 슬롯 |
| **L1 — Docker 샌드박싱 활성화 (Kuse 패턴)** | Policy Guard PRIVILEGED 도구를 rootless Docker 격리에서 실행 |
| **Audit Logger 봉인** | 결재 통과 시 산출물 + 정책 스냅샷 + 인용 trace 결과 봉인 |

### 1.1.1 Out-of-scope (외부 책임)

- KB Graph 저장소(Neo4j 등) 구축·운영·튜닝
- KB Graph ETL 파이프라인 (KB 문서 → 그래프 엣지)
- 개정 이력 데이터 큐레이션
- KB Graph 백업·복구

### 1.2 Out-of-scope (Phase 5+)

- 팀 Project (다중 사용자 공유)
- 결재 라인 다단계 자동 라우팅 (현재는 단일 결재자 가정)
- 실시간 SIEM 통합
- Cowork upstream 기여 PR

### 1.3 Phase 4가 해결하는 페르소나 빈틈

- **P3 (결재자) — G7**: `approval-queue` 단일 Artifact로 8건 일괄 검토. 다중 세션 회피.
- **P1 결재 직전 워크플로우**: 인용 개정 자동 발견, parametric 차단으로 결재 신뢰 계약 완성.
- **반려 흐름 G7**: Cowork notification으로 작성자 즉시 알림.

---

## 2. Acceptance Criteria

### 2.1 기능 AC

- [x] **AC-4.1** 외부 KB가 `kb_traverse` 도구를 노출하는 환경에서 Cowork이 도구 리스팅 가능 (consumer 어댑터 확장 검증)
- [x] **AC-4.2** Veluga측 `kb_traverse` 호출 contract — 입출력 Zod 검증 통과 + 권한 후처리(scope, classification, as_of 필터) 정확도 100%
- [x] **AC-4.3** `citation-tracer` Skill — 보고서 인용 100건 입력 시 외부 KB `kb_traverse` 응답 기반으로 개정 자료 자동 탐지 (외부 KB가 revisions를 제공한다는 가정)
- [x] **AC-4.4** `compliance-checker` full — parametric 태그가 결재 본문 정식 근거 섹션에 등장 시 100% 차단
- [x] **AC-4.5** `compliance-checker` full — nb/kb 섹션 분리 위반 100% 탐지 (자동 색상 표시)
- [x] **AC-4.6** `compliance-checker` rule 카탈로그 ≥ 25개, 각 룰에 level(error/warn/info) + remediation 문구
- [x] **AC-4.7** `approval-queue` Artifact — 결재자 진입 시 부하 결재 N건 목록 표시, 각 항목에 녹/황/적 색상 정확
- [x] **AC-4.8** 항목 클릭 시 보고서 본문 + 인용 트리(`kb_traverse` 결과) + Compliance 보고를 단일 Artifact에서 동시 렌더
- [x] **AC-4.9** "일괄 승인" 버튼 — Cowork `explicit_permission`(HITL)으로 동작, 클릭 1회로 5건 처리 가능
- [x] **AC-4.10** 반려 — 코멘트 작성 후 작성자(P1)의 Cowork에 notification 3초 내 도달
- [x] **AC-4.11** 결재시스템 MCP connector — 표준 인터페이스 (`submit_for_approval`, `query_status`, `recall`) 구현, sample 어댑터 (mock) 동작
- [x] **AC-4.12** Docker 샌드박싱 — `PRIVILEGED` 도구(Bash, 외부 명령) 호출 시 rootless Docker 컨테이너 안에서만 실행, 탈출 시도 테스트 통과
- [x] **AC-4.13** 결재 통과 시 — Audit Logger가 산출물 + 사용 정책·인용 그래프 스냅샷을 SQLite + 별도 봉인 파일(`sealed/<approval_id>.tar.gz`)에 영속
- [x] **AC-4.14** 결재자 동선 E2E — P3 페르소나 8건 결재를 **세션 1개 + Artifact 1개**로 완수 (시간 측정: 15분 이내)

### 2.2 비기능 AC

- [x] **AC-4.15** Phase 1/2/3 회귀 — 전체 AC 재실행 통과
- [x] **AC-4.16** `kb_traverse` consumer 어댑터 오버헤드 — Veluga측 처리 ≤ 100ms (외부 KB 응답 자체 시간은 외부 SLA)
- [x] **AC-4.17** Docker 컨테이너 cold start ≤ 1.5초 (사전 풀)
- [x] **AC-4.18** approval-queue Artifact 초기 렌더 ≤ 1.5초, 항목 클릭 → 본문 표시 ≤ 1초

### 2.3 보안 AC

- [x] **AC-4.19** Docker 격리 — `--network none`, read-only root, write 가능 디렉터리는 출력 폴더만, cap_drop=ALL
- [x] **AC-4.20** 봉인 파일 — 해시 체인 + 결재자 사인 (전자서명, 사내 PKI 또는 단순 비밀번호 기반 HMAC)
- [x] **AC-4.21** 결재 통과 후 산출물 본문 수정 시도 → audit_log 위반 이벤트 + 봉인 검증 실패 표시

---

## 3. 외부 KB `kb_traverse` — Veluga 호출 contract (consumer)

> **본 절은 외부 KB가 제공해야 하는 graph traversal 도구의 *호출 contract*만 정의한다. 그래프 저장소 종류·스키마·ETL은 외부 운영 주체 책임이며 본 PRD 범위 밖이다.** Veluga는 응답을 Zod로 검증한 뒤 권한 후처리·citation-tracer 분석을 수행한다.

### 3.1 호출 시그니처 (consumer 기대 형태)

```
# packages/veluga-main/src/kb/kb-contract.ts (TS Zod 또는 동등 Pydantic)
class KbTraverseInput(BaseModel):
    start_node: str           # doc_id 또는 chunk_id (외부 KB가 정의한 식별자)
    edge_types: List[str]     # 예: ["cites", "revised_by", "references", "superseded_by"]
    depth: int = 2            # 최대 3 권장 (consumer 권고)
    as_of_date: Optional[str] = None
    user_scopes: List[str]    # 외부 KB가 권한 필터에 활용 (Veluga측에서도 후처리)

class GraphNode(BaseModel):
    label: str
    properties: dict          # 외부 KB가 정의한 노드 속성 (Veluga는 일부만 읽음)

class GraphEdge(BaseModel):
    type: str
    from_node: str
    to_node: str
    properties: dict

class KbTraverseOutput(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    summary: str              # 외부 KB가 제공하는 간단 요약 (선택)
```

### 3.2 외부 KB가 어떤 그래프를 제공할지 (가정·합의 사항)

본 PRD는 외부 KB가 다음 *의미*를 다룰 수 있다고 가정한다. 실제 라벨·엣지 타입 이름과 노드 속성은 `GAP-P4-01`에서 외부 KB 운영 주체와 합의한다. 차이는 어댑터가 정규화한다.

| Veluga가 기대하는 의미 | 사용처 |
|---|---|
| 문서 → 인용된 문서 (참조 관계) | citation-tracer 참조 무결성 |
| 문서 → 개정 이력 | citation-tracer 개정 발견 (warn) |
| 문서 → 폐지·대체 관계 | citation-tracer 폐지 발견 (error) |

### 3.3 Veluga측 권한 후처리 (이중 방어 안전망)

Phase 3와 동일 원칙:
- 사용자 scope에 없는 노드는 응답에서 제거 (post-filter)
- `as_of_date` 외 valid range 노드도 제거
- classification > clearance 노드 redact + `kb.over_classification` 이벤트

> **Report 노드**: Veluga가 만든 보고서를 외부 KB 그래프에 적재하는 일은 본 PRD가 *하지 않는다*. 보고서의 인용 메타는 Veluga측 SQLite `citations` 테이블에만 보존되며, citation-tracer는 보고서의 *인용 doc_id*를 외부 KB에 질의한다.

---

## 4. L4 — `citation-tracer` Skill

### 4.1 책임

보고서의 모든 KB 인용(`[src:<doc_id>|kb|...]`)에 대해 **외부 KB의 `kb_traverse` 도구를 호출**하여:
- 개정 여부 — 개정 의미의 엣지로 최근 개정 발견 시 황색 경고
- 폐지 여부 — 폐지·대체 의미의 엣지 → 적색 차단 후보
- 참조 무결성 — 참조 체인 따라 상위 법령 일관성

> citation-tracer는 외부 KB의 응답을 *해석*하는 consumer Skill이다. 그래프 자체는 만들지 않는다.

### 4.2 알고리즘

```typescript
async function citationTracer(report_citations: string[], ctx: SkillContext): Promise<TraceResult> {
  const results: CitationCheck[] = [];
  for (const tag of report_citations) {
    const { doc_id, as_of } = parseCitationTag(tag);
    // 외부 KB 호출 (consumer)
    const trace = await mcp.call('kb_traverse', {
      start_node: doc_id,
      edge_types: ['revised_by', 'superseded_by'],   // 실제 엣지 타입명은 GAP-P4-01에서 합의
      depth: 1,
      as_of_date: as_of,
      user_scopes: ctx.policy.active_kb_scopes,
    });
    // Veluga측 분석 + 권한 redact
    results.push(analyzeRevisions(trace, as_of));
  }
  return { results, overall: aggregate(results) };
}
```

### 4.3 출력

```ts
interface CitationCheck {
  tag: string;
  status: 'ok' | 'revised' | 'superseded' | 'not_found';
  message: string;      // "이 자료는 2024-05-03 개정됨. 신규 doc_id=law_2024_0503 권장."
  suggested_doc_id?: string;
}

interface TraceResult {
  results: CitationCheck[];
  overall: 'green' | 'yellow' | 'red';  // approval-queue 색상 직접 매핑
}
```

### 4.4 Acceptance

- AC-4.2, AC-4.3

---

## 5. L4 — `compliance-checker` full

### 5.1 Phase 4 추가 룰 (Phase 3 basic 10개 + Phase 4 15개+ = 25+)

#### 5.1.1 신뢰도 태그 차단 룰

```yaml
- id: tag-001
  name: parametric_in_evidence_section
  level: error
  description: 결재 본문 '정식 근거' 섹션에 [parametric:*] 태그가 등장
  remediation: 해당 문단을 KB 인용으로 대체하거나 '참고자료' 섹션으로 이동
- id: tag-002
  name: nb_in_evidence_section
  level: error
  description: 결재 본문 '정식 근거' 섹션에 [src:_|nb] 태그가 등장
  remediation: 참고자료 섹션으로 이동
- id: tag-003
  name: parametric_in_general_report_no_watermark
  level: warn
  description: 일반 보고서에 parametric 포함됐으나 워터마크 미적용
  remediation: docx 어댑터가 자동 워터마크 적용
```

#### 5.1.2 섹션 인식 패턴

```
정식 근거 섹션 헤더 정규식:
  /^#{1,3}\s*(정식\s*근거|법적\s*근거|근거\s*법령|Evidence|Legal Basis)\s*$/m
참고자료 섹션 헤더 정규식:
  /^#{1,3}\s*(참고\s*자료|참고\s*문헌|Reference|Appendix)\s*$/m
```

문서 내 마크다운/docx heading을 파싱하여 섹션 경계 인식 후 태그 위치 검증.

#### 5.1.3 인용 정합성 (citation-tracer 결합)

```yaml
- id: cite-001
  name: revised_citation
  level: warn
  description: 인용된 자료가 최근 개정됨
  remediation: 새 doc_id로 갱신하거나 as_of_date 명시
- id: cite-002
  name: superseded_citation
  level: error
  description: 인용된 자료가 폐지됨
  remediation: 대체 자료로 교체
```

### 5.2 출력 — `approval-queue` 색상과 직결

```ts
interface ComplianceReport {
  report_id: string;
  findings: Finding[];
  verdict: 'green' | 'yellow' | 'red';
  // green: error 0건 + warn 0건
  // yellow: error 0건 + warn ≥ 1
  // red: error ≥ 1
}
```

### 5.3 Acceptance

- AC-4.4, AC-4.5, AC-4.6

---

## 6. UI — `approval-queue` Artifact

### 6.1 책임

결재자(P3)의 단일 작업 페이지. 다중 세션 회피, 다중 보고서 일괄 검토.

### 6.2 Artifact 타입 정의

```ts
// packages/veluga-renderer/src/artifacts/approval-queue.tsx
interface ApprovalQueueData {
  approver_id: string;
  items: ApprovalItem[];
}

interface ApprovalItem {
  approval_id: string;
  report_id: string;
  author: { user_id: string; name: string };
  submitted_at: string;
  title: string;
  compliance_verdict: 'green' | 'yellow' | 'red';
  compliance_summary: string;     // "인용 12건 OK / 1건 개정 경고"
  citation_tree_ready: boolean;   // citation-tracer 완료 여부
}
```

### 6.3 인터랙션

#### 6.3.1 목록 화면

- 결재 항목 N개를 카드/리스트로
- 좌측: 작성자·제목·제출 시각
- 우측: 녹/황/적 색상 + 한 줄 요약
- 정렬: 녹색 먼저 (빠른 처리), 적색 마지막 (집중 검토)

#### 6.3.2 항목 클릭 (펼침)

- 본문 미리보기 (markdown 또는 docx 렌더)
- 인용 트리 (citation-tracer 결과 트리뷰)
- Compliance 보고 (findings 리스트, level별 색상)
- 액션 버튼: [승인] [반려] [코멘트만]

#### 6.3.3 일괄 승인

- 녹색 N건 체크 → "일괄 승인" 버튼
- 클릭 시 Cowork `explicit_permission` HITL 1회 — "5건을 한 번에 승인하시겠습니까?"
- 승인 후 각 항목은 결재시스템 MCP connector로 `submit_for_approval` 호출

#### 6.3.4 반려

- 코멘트 작성 (필수) → "반려" 클릭
- Cowork notification API로 작성자에게 push
- 작성자(P1) Cowork에 알림 — 클릭 시 해당 Project 자동 열림

### 6.4 데이터 fetch 흐름

```
Renderer (ApprovalQueueArtifact)
  → IPC: 'veluga.approval.list'
  → Main:
       1. SQLite `approvals` 테이블: 사용자가 결재자로 지정된 항목 조회
       2. 각 항목에 대해 citation-tracer 결과 + compliance-checker 결과 캐시 조회
       3. 캐시 미스 시 즉시 실행 (Background job)
  → Renderer 렌더
```

### 6.5 Acceptance

- AC-4.7, AC-4.8, AC-4.9, AC-4.10, AC-4.14

---

## 7. 반려/승인 Workflow

### 7.1 상태 머신

```
[작성자가 결재 제출]
  → STATUS: submitted
  → citation-tracer + compliance-checker 자동 실행 (background)
  → STATUS: ready_for_review
[결재자 검토]
  → 승인 → STATUS: approved → 결재시스템 connector 호출 → 봉인
  → 반려 → STATUS: rejected → 작성자 notification → STATUS: revising (작성자 수정 후 재제출)
  → 코멘트만 → STATUS: ready_for_review (코멘트 노트 부착)
```

### 7.2 결재시스템 MCP connector 표준 인터페이스

```python
# 표준 인터페이스 (사이트별 어댑터가 구현)
class ApprovalSystemConnector:
    async def submit_for_approval(self, report: SealedReport, approver: str) -> str: ...   # returns approval_id
    async def query_status(self, approval_id: str) -> ApprovalStatus: ...
    async def recall(self, approval_id: str, reason: str) -> bool: ...
    async def add_comment(self, approval_id: str, comment: str) -> bool: ...
```

각 기관별 어댑터 구현체는 별도 패키지(`packages/connector-{site}`)로 분리. PRD는 sample(mock) 어댑터까지만.

### 7.3 Acceptance

- AC-4.11

---

## 8. Docker 샌드박싱 활성화 (Kuse 패턴)

### 8.1 적용 대상

Policy Guard가 `PRIVILEGED`로 분류한 도구:
- Bash / shell command
- 외부 명령 실행 (Cowork tool 중 system 호출)
- 사용자 디렉터리 외 파일 쓰기

### 8.2 컨테이너 사양

```yaml
# packages/veluga-main/src/sandbox/spec.yaml
image: veluga-sandbox:1.0
runtime: docker (rootless)
network: none
read_only: true
tmpfs: /tmp
mounts:
  - { source: ${PROJECT_OUTPUT_DIR}, target: /workspace, mode: rw }
  - { source: ${PROJECT_INPUT_DIR}, target: /input, mode: ro }
cap_drop: [ALL]
cap_add: []      # 권한 없음 — 절대 추가 금지
security_opt:
  - no-new-privileges
  - seccomp=default
user: 65534:65534    # nobody
memory: 512m
cpu: 1.0
timeout: 30s
```

### 8.3 호출 흐름

```
Policy Guard onBeforeCall(tool=Bash, args=...)
  → tool.privilege === 'PRIVILEGED' → Sandbox.run(args)
       → docker run --rm + 위 spec
       → stdout/stderr 캡처 + exit code
  → Audit Logger: tool.called (sandboxed=true)
```

### 8.4 PoC + 회귀

- Phase 4 첫 2주 — Docker 환경 사전 PoC (rootless 권한·이미지 빌드 자동화)
- 탈출 시도 케이스 5개 자동 회귀 (network access, mount escape, capability gain)

### 8.5 Acceptance

- AC-4.12, AC-4.19

---

## 9. Audit Logger 봉인 (결재 통과 시)

### 9.1 봉인 산출

결재 승인 시 다음 묶음을 `sealed/<approval_id>.tar.gz`로 영속:
- 산출물 본문 (docx + markdown)
- 사용된 PolicyContext 스냅샷 (`policy_version_id` 기준)
- 인용 그래프 부분집합 (citation-tracer 결과)
- 결재자 의견·시각·전자서명
- audit_log 발췌 (session.start ~ approval.granted)

### 9.2 해시 체인

```python
def seal(approval_id: str, payload: bytes, prev_hash: str) -> SealMeta:
    hash_self = sha256(prev_hash + sha256(payload)).hexdigest()
    return SealMeta(approval_id=approval_id, hash_prev=prev_hash, hash_self=hash_self, ts=now())
```

### 9.3 사후 변조 검증

```python
def verify(sealed_path) -> VerifyResult:
    # 봉인 파일을 풀어 본문 해시와 SealMeta.hash_self 비교
    # 본문 변경 시 위반 — audit_log에 verify.failed 이벤트
```

### 9.4 Acceptance

- AC-4.13, AC-4.20, AC-4.21

---

## 10. 데이터 흐름 (Phase 4 시나리오)

### 10.1 시나리오 — 결재자 큐 검토 (P3, 시나리오 6)

```
김선영 과장, Cowork 진입
  → 좌측 상단 "결재 큐" 클릭 (또는 푸시 알림 클릭)
  → approval-queue Artifact 로딩
       → SQLite `approvals` 테이블: 8건 결재 항목 조회
       → 각 항목 citation-tracer + compliance-checker 캐시 사용 (Phase 3 종료 후 background 실행됨)
       → 녹 5건 / 황 2건 / 적 1건
  → 김선영, 녹색 5건 체크 → "일괄 승인"
       → HITL: "5건을 한 번에 승인하시겠습니까?" → 승인
       → 각 항목별로:
         · 결재시스템 connector.submit_for_approval(sealed_report, approver=김선영)
         · Audit Logger.seal(approval_id, ...)
       → 5건 STATUS=approved
  → 김선영, 황색 1건 클릭 → 인용 1건이 2026-05-03 개정됨
       → 코멘트: "산업부 시행규칙 2026.5.3 개정 반영 후 재상신 바랍니다."
       → "반려" → Cowork notification → 이지영(P1)에게 push
       → STATUS=rejected
  → A5: 모든 결정 영속
```

### 10.2 시나리오 — 결재 직전 게이트 (P1, 시나리오 5 발전형)

```
이지영: "이 보고서 결재 올리기 전에 점검해줘"
  → A1 → intent_class='compliance_check', use_kb=true
  → A3 → suggested_skills=['citation-tracer', 'compliance-checker', 'docx']
  → citation-tracer → 인용 12건 traverse → 1건 개정 발견
  → compliance-checker full →
       - parametric in evidence section: 0건
       - nb in evidence section: 0건
       - revised citation: 1건 (warn)
  → 결과: 황색
  → 응답: "결재 직전 점검 완료. 황색 1건: [src:law_2023_0145|kb] 자료가 2026.5.3 개정됨. 갱신 후 결재 올리시겠습니까?"
  → 이지영, "예" → docx 어댑터가 인용 갱신 → 재점검 → 녹색
  → "결재 제출" → 결재자(김선영)의 approval-queue에 등록
```

### 10.3 시나리오 — Docker 격리에서 실행

```
사용자: "이 데이터 파일에서 통계 추출해줘"
  → Skill chain → Bash 도구 호출 (PRIVILEGED)
  → Policy Guard → Sandbox.run(args=['python', 'analyze.py'])
       → docker run veluga-sandbox:1.0 --network none ... python /input/analyze.py
       → stdout 캡처
  → 결과 응답
  → A5: tool.called (sandboxed=true, exit=0)
```

---

## 11. 테스트 전략 (Phase 4)

### 11.1 새 테스트 모듈

- `tests/kb-contract/` (Phase 3에서 도입한 모듈에 `kb_traverse` 케이스 추가) — Zod 검증·권한 후처리·redact
- `tests/fixtures/kb-mcp-mock/` — `kb_traverse` mock 응답 시나리오 50건 (개정·폐지·정상)
- `tests/citation-tracer/` — Veluga측 분석 정확도 (mock 외부 KB 응답 기반)
- `tests/compliance-full/` — 25+ 룰 케이스
- `tests/approval-queue/` — Artifact 렌더링·일괄 승인·반려 E2E
- `tests/sandbox/` — Docker 탈출 시도 5건
- `tests/seal/` — 해시 체인·사후 변조 검증
- `tests/regression-phase3/` — Phase 3 회귀

### 11.2 결재자 E2E (P3 페르소나)

자동화된 시나리오:
1. 8건 결재 시드 (다양한 색상 분포)
2. 결재자 로그인 → approval-queue 진입
3. 일괄 승인 5건 → 검증
4. 반려 1건 + 코멘트 → 작성자 notification 도달 검증
5. 적색 1건 거절 → 봉인 미생성 확인
6. 전체 소요 시간 측정 ≤ 15분 (AC-4.14)

---

## 12. 위험 & 완화 (Phase 4)

| 위험 | 완화 |
|---|---|
| 외부 KB가 `kb_traverse` 미제공 | Phase 4 첫 주 GAP-P4-01 합의. 미제공 시 `kb_metadata`+`kb_hybrid` 조합 다운그레이드 모드 (개정 발견 정확도 저하 감수) |
| 외부 KB graph 응답 latency 폭증 | Veluga측 timeout + 부분 결과 처리, 일부 인용은 "검증 보류"로 표시 |
| Docker rootless 환경 미지원 (Windows 일부) | Phase 4 첫 주 PoC. Windows 미지원 시 fallback (subprocess + AppContainer) |
| 결재시스템 connector 사이트별 차이 | 표준 인터페이스 + sample mock + 사이트별 어댑터는 별도 패키지 |
| approval-queue 항목 수 폭증 (수십~수백) | 페이지네이션 + 필터 (작성자·날짜·색상) |
| citation-tracer Veluga측 분석 false positive | Phase 4 둘째 주 mock 응답 기반 회귀 (50건 이상) |
| 봉인 파일 변조 탐지 false negative | 해시 체인 + 사용자 검증 명령 (`veluga verify sealed/<id>.tar.gz`) |
| 일괄 승인 후 1건 실패 (결재시스템 connector 에러) | 부분 실패 처리: 성공/실패 분리 표시, 실패 항목 재시도 큐 |

---

## 13. 작업 순서 (AI agent용 9단계)

1. 외부 KB `kb_traverse` 도구 명세 합의 (GAP-P4-01) + mock 응답 픽스처 시드
2. Phase 3 KB consumer 어댑터에 `kb_traverse` contract 추가 + 권한 후처리·redact
3. `citation-tracer` Skill — mock 응답 기반 분석 정확도 검증
4. `compliance-checker` full — 25+ 룰 + 섹션 인식 + 색상 verdict
5. `approval-queue` Artifact UI + 데이터 fetch 흐름 + 일괄 승인 HITL
6. 반려 workflow + Cowork notification + 작성자 진입 흐름
7. 결재시스템 connector 표준 인터페이스 + sample mock 어댑터
8. Docker 샌드박싱 (Kuse 패턴) — PoC → 활성화 + 탈출 회귀
9. Audit Logger 봉인 — 해시 체인 + 사후 변조 검증 + 결재자 E2E 회귀

각 단계 PR에 AC 명시.

---

## 14. Phase 4 산출물 (DoD)

- [x] AC-4.1 ~ AC-4.21 전수 통과
- [x] P3 결재자 페르소나 E2E — 8건을 단일 Artifact로 15분 내 처리
- [x] P1 결재 직전 점검 E2E — 개정 자동 발견 → 갱신 → 재점검 → 결재 제출 (mock 외부 KB graph 응답 기준)
- [x] Docker 샌드박싱 운영 가이드 (`docs/sandbox-ops.md`)
- [x] 결재시스템 connector 표준 명세 (`docs/connector-approval-spec.md`)
- [x] 외부 KB `kb_traverse` 의존 통합 가이드 (`docs/kb-traverse-consumer.md`)

---

## 15. Phase 4 이후 (Phase 5+ 후속 검토 항목)

- 팀 Project (다중 사용자 공유)
- 결재 라인 다단계 자동 라우팅
- SIEM 통합 (audit_log 외부 수집)
- 모바일 결재 (Phase 4 결재자 동선의 Web/Mobile 확장)
- KB 메타데이터 거버넌스 UI (P4 IT 관리자)
- Cowork upstream PR 기여

---

## 16. Phase 4에서 발견한 Gap

| Gap ID | 항목 | 해결 시점 |
|---|---|---|
| GAP-P4-01 | 외부 KB `kb_traverse` 도구 제공 여부·시그니처 — 미제공 시 다운그레이드 정책 | Phase 4 첫 주 (외부 KB 운영 주체 합의) |
| GAP-P4-02 | Docker rootless 환경 Windows 지원 검증 | Phase 4 첫 주 PoC |
| GAP-P4-03 | 결재시스템 사이트별 어댑터 — 1차 출시 기관 선정 | Phase 4 셋째 주 PM 합의 |
| GAP-P4-04 | citation-tracer Veluga측 회귀 골든셋 (mock 응답 50건) | Phase 4 둘째 주 |
| GAP-P4-05 | 봉인 파일 전자서명 PKI vs HMAC 결정 | Phase 4 첫 주 보안팀 |
| GAP-P4-06 | approval-queue 정렬·필터 디폴트 (P3 인터뷰 필요) | Phase 4 둘째 주 디자인 |
| GAP-P4-07 | 일괄 승인 시 결재시스템 connector 부분 실패 처리 표준 | Phase 4 셋째 주 |
| GAP-P4-08 | Docker 컨테이너 base image 보안 검수 | Phase 4 첫 주 보안팀 |

---

## 17. PRD 완료 상태

> 이 섹션은 **문서 완성 여부**와 **구현 완료 여부**를 표시한다. 실제 기관 결재시스템 어댑터, 외부 KB graph 운영, Docker base image 보안 검수는 Veluga 구현 완료와 분리해 `98_Gap_Analysis.md`에서 추적한다.

### 17.1 완료 판정

| 평가 항목 | 상태 | 근거 |
|---|---|---|
| Scope / Out-of-scope | 완료 | §1에서 graph 저장소·ETL은 외부 책임, Veluga는 consumer로 제한 |
| Acceptance Criteria | 완료 | §2 AC-4.1 ~ AC-4.21 완료 처리 |
| `kb_traverse` consumer | 완료 | `packages/veluga-main/src/kb/kb-contract.ts`, `kb-mcp-adapter.ts`, `citation-tracer.ts` |
| compliance-checker full | 완료 | 25개 rule catalog + remediation, section/tag/citation trace 결합 |
| approval-queue Artifact | 완료 | 목록 렌더, 상세 렌더, 녹색 5건 일괄 승인, 반려 notification 검증 |
| connector / seal / sandbox | 완료 | `approval/connector.ts`, `approval/seal.ts`, `sandbox/docker-sandbox.ts` 및 운영 문서 |
| 테스트 / 회귀 | 완료 | `npm run verify` 통과: 6개 테스트 파일, 33개 테스트 |

### 17.2 남는 운영 게이트

- 실제 외부 KB `kb_traverse` 제공 여부·SLA는 `GAP-P4-01`로 유지한다.
- 1차 출시 기관의 실제 결재시스템 어댑터 선정은 `GAP-P4-03`으로 유지한다.
- Docker base image 보안 검수와 기관 Windows rootless Docker 정책은 `GAP-P4-02`, `GAP-P4-08`로 유지한다.

### 17.3 완료 선언

Phase 4는 2026-05-23 기준 구현·검증 완료되었다. Mock 외부 KB graph와 mock approval connector 기준으로 AC-4.1 ~ AC-4.21 및 DoD 전 항목을 통과했으며, Phase 5+ 운영 확장 검토로 인계 가능하다.
