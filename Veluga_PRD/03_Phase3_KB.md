# 03 — Phase 3: Knowledge Integration (외부 KB Consumer)

> **목표 한 줄**: **외부에서 제공되는** 기관 KB(법령·가이드·정책)를 MCP 도구로 호출해 권한 기반 인용을 부착하고, KB 인용 태그(`|kb`)가 결재 정식 근거 자격을 갖춘 보고서 초안을 만들 수 있는 단계.
>
> **기간**: 6~8주
> **선행**: Phase 2 머지 완료
> **후속**: Phase 4 (결재 라인 + 그래프 트래버스 consumer)
>
> **이 PRD 단독으로 작업 가능**: ✅ (Phase 1/2 산출 + `99_Appendix.md` 시그니처 + `98_Gap_Analysis.md` PM 합의 사항 참조)

---

## 0. 범위 선언 — KB 구현은 본 PRD 범위 밖 (Non-negotiable)

> **본 PRD의 핵심 원칙**: 기관 KB(인덱스 저장소·임베딩 파이프라인·문서 적재·메타데이터 거버넌스)는 **외부에서 제공되는 시스템**이다. Veluga Agents는 그 KB를 **MCP 도구 또는 HTTP API의 소비자(consumer)** 로만 결합한다.

| 항목 | 범위 |
|---|---|
| KB 인덱스 저장소(Vector DB, RDB, Graph 등) 구현·운영 | ❌ 본 PRD 범위 밖 (외부 시스템) |
| 임베딩 모델 호스팅·파이프라인 | ❌ 본 PRD 범위 밖 |
| 문서 적재·ingest·메타데이터 거버넌스 | ❌ 본 PRD 범위 밖 (외부 운영 주체) |
| KB 디스크 암호화·백업·재해 복구 | ❌ 본 PRD 범위 밖 |
| **KB MCP 도구 호출 contract (Veluga가 호출하는 입출력 시그니처)** | ✅ 본 PRD 범위 (§3) |
| **A2 Knowledge Gate (Veluga측 권한·정책 차단 계층)** | ✅ 본 PRD 범위 (§4) |
| **A3 Skill Resolver (Veluga측 Skill 활성·의존성)** | ✅ 본 PRD 범위 (§5) |
| **gov-proposal 등 KB consumer Skill** | ✅ 본 PRD 범위 (§6) |
| **compliance-checker basic** | ✅ 본 PRD 범위 (§7) |
| **Policy Guard enforce 전환** | ✅ 본 PRD 범위 (§8) |
| **PolicyService mock → RPC 교체** | ✅ 본 PRD 범위 (§9) |

> KB 구현이 본 PRD에 다시 침투하려는 시도(예: "그래도 임시 ingest 한 줄 추가하자")는 즉시 reject. 필요하다면 `98_Gap_Analysis.md`에 외부 의존 GAP으로 올린다.

---

## 1. In-scope / Out-of-scope

### 1.1 In-scope (Veluga가 만들 것)

| 영역 | 산출물 |
|---|---|
| **L2 — A2 Knowledge Gate** | KB 사용 허용/차단/대안 제안 — 외부 KB 호출 *직전* 권한·정책 게이트 |
| **L2 — A3 Skill Resolver** | 활성 Skill 선정·의존성·순서 (명시 카탈로그 + 룰 우선, LLM 후순위) |
| **외부 KB MCP 어댑터** | 외부 KB MCP 서버를 Cowork connector로 등록·헬스체크·실패 fallback. **서버 자체는 외부 제공.** |
| **KB 도구 호출 contract** | `kb_search` / `kb_metadata` / `kb_hybrid` 입출력 시그니처(클라이언트측 Zod/Pydantic 검증만) |
| **L4 domain Skill** | `gov-proposal`, `policy-research` (기본 2개), `legal-opinion`, `budget-review` (선택) — 모두 KB consumer |
| **L4 format Skill 확장** | `pptx`, `xlsx` |
| **L4 core 확장** | `compliance-checker` basic (권한·보존기간·등급 점검만, parametric 차단은 Phase 4) |
| **인용 태그 통합** | `[src:<doc_id>\|kb\|as_of:<date>]` 정식 도입, citation-verifier 가 KB·NB 양쪽 검증 (KB는 contract 응답 기준) |
| **Policy Guard enforce 전환** | dry-run → enforce. Phase 1~2 로그 분석으로 false-positive 사전 제거 |
| **PolicyService 실제 RPC** | mock → 사내 RPC 서버 교체 (Phase 3 후반) |

### 1.2 Out-of-scope (본 PRD가 절대 만들지 않을 것)

- **KB MCP 서버 본체 구현** — Vector DB·RDB·Graph 저장소·임베딩·ingest 모두 외부 시스템
- **kb-ingest Skill** — KB 적재 게이트는 KB 운영 주체 책임 (Veluga UI에 노출되더라도 호출만)
- **KB Graph (Neo4j 등) 구축** — Phase 4도 graph traversal contract consumer만
- **임베딩 모델 호스팅·파인튜닝**
- **KB 코퍼스·골든셋 큐레이션** — 외부 KB 운영 주체 책임
- `citation-tracer` (그래프 트래버스 Skill, consumer) → Phase 4 이관
- `compliance-checker` full (parametric 차단 + nb/kb 섹션 분리) → Phase 4
- `approval-queue` Artifact → Phase 4
- Docker 샌드박싱 활성화 → Phase 4

### 1.3 Phase 3가 해결하는 페르소나 빈틈

- **P1 (실무자)**: "이 사업이 작년 가이드라인에 부합?" 류 KB 근거 작성 가능.
- **G6 (사용자 권한 가시화)**: 검색 0건이 권한 부족 때문이면 Gate가 대안 제안.
- **A6/A7 과잉 사용 회피 (사용성 점검)**: A6 confidence=low → A1이 Gate 우회로 KB 활성화 권유 흐름 정상화.

---

## 2. Acceptance Criteria

### 2.1 기능 AC

- [ ] **AC-3.1** 외부 KB MCP 서버가 사전 기동된 환경에서 Cowork이 connector로 인식 (도구 3개 listing 가능)
- [ ] **AC-3.2** 외부 KB MCP 응답 실패·timeout 시 Veluga는 *fallback* — A7이 "KB 일시 사용 불가, Phase 1/2 일반 답변으로 진행" 안내 (앱은 죽지 않는다)
- [ ] **AC-3.3** `kb_search(query, scopes, as_of_date)` contract — 호출 입출력 Zod/Pydantic 검증 통과율 100% (스키마 위반은 즉시 차단)
- [ ] **AC-3.4** `kb_metadata(filters)` contract — 권한 필터(scopes, clearance, as_of_date) 자동 부착 후 호출
- [ ] **AC-3.5** `kb_hybrid(query)` contract — 호출 시 `routing_explain` 필드를 응답에서 받아 audit_log에 보존
- [ ] **AC-3.6** A2 Knowledge Gate — 권한 부족 케이스 100건 샘플 100% 차단 + 70% 이상 alternative 제안 (Veluga측에서 KB 호출 *전*에 차단)
- [ ] **AC-3.7** A2 — 활성 Project가 `external_apis: deny` 시 KB MCP 호출 차단 가능
- [ ] **AC-3.8** A3 Skill Resolver — Phase 3 시나리오 (KB 기반 작성) 30건에서 의존성 그래프 정확도 100% (예: style-card → drafter → citation-verifier 순)
- [ ] **AC-3.9** `gov-proposal` Skill — KB 인용 ≥ 5건 자동 부착된 초안 생성, citation-verifier 검증 ≥ 95% 매칭 (KB 응답이 정상이라는 가정 하)
- [ ] **AC-3.10** `compliance-checker` basic — 보존기간·등급·권한 일관성 점검 룰 ≥ 10개 통과
- [ ] **AC-3.11** PolicyService — mock에서 RPC로 교체된 후에도 Phase 1/2 AC 모두 통과
- [ ] **AC-3.12** Policy Guard `enforce` 모드 — Phase 1 dry-run 로그 분석 후 false-positive 케이스 0건

### 2.2 비기능 AC

- [ ] **AC-3.13** Veluga측 Knowledge Gate 평가(권한·정책 머지) p99 ≤ 10ms (인메모리)
- [ ] **AC-3.14** KB MCP 호출 라운드트립 — Veluga측 어댑터 오버헤드 ≤ 50ms (외부 KB 서버 응답시간은 별도 SLA, Veluga 책임 밖)
- [ ] **AC-3.15** KB 권한 이중 방어 — A2 Gate가 통과시킨 호출이 외부 KB로부터 권한 거부 응답을 받는 케이스 0건 (불일치 시 즉시 GAP)
- [ ] **AC-3.16** Phase 1/2 회귀 — 전체 AC 재실행 통과

### 2.3 보안 AC

- [ ] **AC-3.17** 외부 KB MCP 호출은 PolicyContext 세션 토큰을 포함 (외부 KB 측 권한 검증 가능하도록)
- [ ] **AC-3.18** KB 응답에 `classification`이 PolicyContext 허용 범위를 초과하는 chunk가 포함된 경우 → Veluga측에서 자동 redact + audit_log `kb.over_classification` 이벤트 (안전망)

---

## 3. KB MCP 도구 호출 Contract (Veluga 클라이언트측만 명세)

> **다시 강조**: 본 절은 Veluga가 *호출하는* 시그니처와 *기대하는* 응답 형태를 정의한다. 서버 구현·인덱싱·임베딩·DB 스키마는 **본 PRD의 범위가 아니다**. 외부 KB 운영 주체가 별도 명세를 제공해야 한다 → `GAP-P3-01`.

### 3.1 토폴로지 (consumer 관점)

```
Electron Main Process
   ├─ openCoworkRuntime
   ├─ velugaOrchestrator
   │    ├─ A2 Knowledge Gate
   │    ├─ A3 Skill Resolver
   │    └─ KbMcpAdapter (이 PRD가 만드는 클라이언트측 어댑터만)
   └─ Cowork MCP 클라이언트
              │ stdio/socket 또는 HTTP
              ▼
      [외부 KB MCP 서버]  ← 본 PRD 범위 밖
```

### 3.2 클라이언트측 어댑터 (이 PRD가 만들 것)

```
packages/veluga-main/src/kb/
├── kb-mcp-adapter.ts     # MCP connector 등록, 헬스체크, 재시도, fallback
├── kb-contract.ts        # 입출력 Zod 스키마 (런타임 검증)
└── kb-redactor.ts        # 응답 redact (over-classification 안전망)
```

- 외부 KB MCP 서버의 stdio/socket/HTTP 엔드포인트는 환경변수로만 주입(`VELUGA_KB_MCP_URL` 또는 `VELUGA_KB_MCP_CMD`). Veluga가 spawn하지 않는다.
- 외부 KB가 다운된 경우 — 어댑터는 max retry 후 connector를 `unavailable`로 마크. A7이 사용자에게 안내(§AC-3.2).

### 3.3 도구 시그니처 (입출력 contract만)

> 본 시그니처는 **Veluga가 외부 KB에 기대하는 형태**다. 외부 운영 주체가 다른 형태를 제공한다면 GAP-P3-01에서 협의 후 어댑터가 변환한다.

```python
# packages/veluga-main/src/kb/kb-contract.ts (TS 또는 동등 Zod)
# (의사 시그니처 — 실제 코드는 Zod로 표현)

class KbSearchInput(BaseModel):
    query: str
    scopes: List[str]           # 호출 시 user.scopes ∩ requested.scopes
    as_of_date: Optional[str]   # ISO8601 YYYY-MM-DD
    top_k: int = 10
    min_score: float = 0.0

class DocChunk(BaseModel):
    doc_id: str
    chunk_id: str
    scope: str
    classification: Literal['public', 'internal', 'confidential', 'secret']
    text: str
    valid_from: str
    valid_to: Optional[str]
    score: float
    metadata: dict

class KbSearchOutput(BaseModel):
    chunks: List[DocChunk]

class KbMetadataInput(BaseModel):
    filters: dict
    limit: int = 50

class KbMetadataOutput(BaseModel):
    docs: List[dict]

class KbHybridInput(BaseModel):
    query: str
    scopes: List[str]
    as_of_date: Optional[str] = None

class KbHybridOutput(BaseModel):
    mixed: List[dict]
    routing_explain: str   # 외부 KB가 어떤 인덱스를 사용했는지 설명 (감사용)
```

**Veluga 책임 영역**:
- 호출 *전* 권한 머지(scopes 교집합, clearance 적용, as_of 정규화)
- 호출 *후* 응답 검증(스키마, classification ≤ clearance, valid 범위)
- 응답 chunk를 LLM 컨텍스트에 삽입 + 인용 태그 자동 부착

**Veluga 책임이 *아닌* 영역**:
- 인덱싱·임베딩·랭킹·청킹·하이브리드 라우팅 로직
- KB 코퍼스 큐레이션·메타데이터 거버넌스

### 3.4 호출 흐름

```
사용자 발화
  → A1 Intent Router → IntentPlan{ use_kb=true, kb_scopes=[...] }
  → A2 Knowledge Gate → GateDecision{ allow=true }  (이 시점에 권한 부족이면 외부 호출 안 함)
  → A3 Skill Resolver → SkillActivationPlan{ ordered_skills=[gov-proposal, ...] }
  → Skill chain 실행
    → gov-proposal Skill 내부에서 MCP 도구 호출:
       cowork.mcp.callTool('kb_hybrid', { query, scopes, as_of_date })
       → preload IPC → Electron Main → KbMcpAdapter → 외부 KB MCP 서버
       → 응답 수신 → kb-contract Zod 검증 → kb-redactor over-classification 차단
       → routing_explain 을 audit_log 로 보존
    → 결과를 LLM 컨텍스트에 삽입 + citation 태그 자동 부착
  → citation-verifier 자동 활성 → KB·NB 양쪽 매칭 검증
  → docx Skill (Phase 2) — footnote에 KB doc_id + valid_from 표시
```

### 3.5 외부 KB 부재(미준비) 시 동작

```
Electron Main 부트
  → process.env.VELUGA_KB_MCP_URL 미설정 또는 unreachable
  → KbMcpAdapter 가 connector 등록을 skip + audit_log 'kb.unavailable' 이벤트
  → PolicyContext.active_kb_scopes 는 외부 KB가 응답한 supported_scopes 와 무관하게
    PolicyService 로부터 채워지지만, Skill chain이 KB 호출 시 즉시 unavailable 응답 반환
  → A7: "현재 KB 사용 불가. 일반 답변으로 진행합니다." 안내
  → Phase 1/2 동작은 모두 정상 (회귀)
```

---

## 4. A2 — Knowledge Gate 명세

### 4.1 책임

KB 사용이 **정책상 허용**되고, **유익**(0건 응답 회피)하며, **대안 가능** 여부를 판단. **외부 KB를 호출하기 *전*에** 모두 결정 — 외부 호출은 게이트 통과 후에만 발생.

### 4.2 알고리즘

```typescript
async function knowledgeGate(intent: IntentPlan, policy: PolicyContext): Promise<GateDecision> {
  // 1. 외부 KB 가용성 검사
  if (!kbAdapter.isAvailable()) {
    return { allow: false, reason: 'KB 서비스가 일시 사용 불가합니다.', alternatives: suggestProjectAlternatives(policy) };
  }
  // 2. 정책 차단 사유 우선 검사
  if (policy.effective.external_apis === 'deny' && intent.kb_scopes.some(isExternalScope)) {
    return { allow: false, reason: '정책상 외부 KB 호출이 금지되어 있습니다.', alternatives: suggestProjectAlternatives(policy) };
  }
  // 3. clearance 검사
  for (const scope of intent.kb_scopes) {
    if (!hasAccess(policy.user.clearance, scope)) {
      return { allow: false, reason: `권한 부족: ${scope} 접근 불가`, alternatives: lowerScopes(scope) };
    }
  }
  // 4. Project tier override 검사
  if (policy.project?.overrides?.external_apis === 'deny') {
    return { allow: false, reason: '현재 Project가 KB 호출을 금지합니다.' };
  }
  // 5. 토큰 예산 검사 (Phase 3 단순 — 대형 쿼리는 경고만)
  if (estimateTokens(intent) > (policy.veluga.kb_token_budget ?? 50000)) {
    return { allow: true, reason: 'budget warning', scope_overrides: narrowScopes(intent.kb_scopes) };
  }
  return { allow: true, reason: 'ok' };
}
```

### 4.3 대안 제안 룰

차단 시 친절한 대안:
- 권한 부족 → "당신 등급에서 접근 가능한 비슷한 자료: {scope} (예: law:public)"
- Project 차단 → "현재 Project는 KB 차단입니다. Project 자료 안에 유사 파일이 있습니다: {file_id}"
- 토큰 예산 → "scope를 {좁은 scope}로 좁히면 응답 가능"
- KB unavailable → "일반 답변(Phase 1/2 동작)으로 진행 가능"

### 4.4 Acceptance

- AC-3.6, AC-3.7, AC-3.13

---

## 5. A3 — Skill Resolver 명세

### 5.1 책임

A1이 제시한 `suggested_skills`를 기반으로:
1. 실제 활성화할 Skill 선정 (PolicyContext 교집합)
2. 의존성 해결 (예: `gov-proposal` 은 `style-card`, `citation-verifier` 필요)
3. 실행 순서 결정
4. 데이터 전달 방식 결정 (Project 임시 파일 vs 메모리)

### 5.2 카탈로그 + 룰 우선 (LLM 후순위)

폐쇄망 안정성 — **명시 카탈로그 + 룰 우선**.

```typescript
// packages/veluga-main/src/agents/skill-resolver.ts
const SKILL_DEPENDENCIES: Record<string, string[]> = {
  'gov-proposal': ['style-card', 'docx'],
  'policy-research': ['style-card', 'citation-verifier', 'docx'],
  'legal-opinion': ['style-card', 'citation-verifier', 'compliance-checker'],
  'budget-review': ['style-card', 'xlsx'],
  // ...
};

const SKILL_ORDER: Record<string, number> = {
  'style-card': 1,
  'citation-tracer': 2,    // Phase 4
  'gov-proposal': 3,
  'policy-research': 3,
  'citation-verifier': 4,
  'compliance-checker': 5,  // 항상 마지막 직전
  'docx': 6,  // 최종 변환
  'pptx': 6,
  'xlsx': 6,
};

function resolve(suggested: string[], policy: PolicyContext): SkillActivationPlan {
  const allowed = suggested.filter(s => policy.active_skill_ids.includes(s));
  const withDeps = expandDependencies(allowed, SKILL_DEPENDENCIES);
  const ordered = sort(withDeps, SKILL_ORDER);
  return { ordered_skills: ordered.map(toSkillStep), data_passing: 'project_temp', rationale: '...' };
}
```

LLM 후순위 — 카탈로그에 없는 신규 Skill 발견 시에만 LLM에 묻기 (관리자가 Skill을 새로 등록한 경우).

### 5.3 Acceptance

- AC-3.8

---

## 6. L4 — Domain Skill: `gov-proposal` (KB Consumer)

### 6.1 목적

정부 R&D 사업·국가과제·공모사업 제안서 초안을 KB·Project 자료 기반으로 작성. 인용 태그 자동 부착. **KB는 외부 MCP 도구 호출로만 접근.**

### 6.2 입출력

- 입력: 사업공고문 (Project 자료) + 회사 내부자료 + 신청 양식
- 출력: 신청서 섹션별 서술 초안 (인용 태그 부착) + 출력 docx

### 6.3 흐름

```
1. 공고문 분석 — Project 자료에서 자격요건·평가지표 추출 (KB 호출 0회)
2. 내부자료 매핑 — 회사소개·인력·실적을 평가지표에 1:1 매핑
3. KB 검색 — 관련 가이드라인·기존 사례 (kb_hybrid 호출, contract 응답 신뢰)
4. 섹션별 초안 작성 (LLM)
   - 각 문단에 [src:<doc_id>|kb|as_of:<date>] 또는 [src:nb_*|nb] 태그 강제
5. citation-verifier 자동 활성 → 매칭 검증 (KB chunk 본문 ↔ 인용 본문)
6. compliance-checker basic — 권한·등급 일관성
7. docx 출력 — style-card 톤 적용 + 워터마크 검사
```

### 6.4 SKILL.md 메타

```yaml
---
id: gov-proposal
version: 1.0.0
category: domain
required_clearance: internal
required_scopes: [law:public, policy:internal]
depends_on: [style-card, citation-verifier, docx]
hitl: false
---
```

### 6.5 Acceptance

- AC-3.9

---

## 7. L4 — Core: `compliance-checker` basic (Phase 3)

### 7.1 Phase 3 범위 (부분 구현)

- 권한 일관성 — 인용된 KB doc의 classification ≤ 사용자 clearance
- 보존기간 일관성 — Project / 보고서 보존기간이 institution.yaml 기본 이상
- 등급 일관성 — 결재 라인의 보안 등급 ≥ 본문 내 최고 등급

### 7.2 Phase 4 본격 범위 (Phase 4 PRD 참조)

- parametric 태그 결재 본문 차단
- nb/kb 섹션 분리 검증
- citation-tracer 결과 결합 (개정 경고)

### 7.3 룰 카탈로그 (Phase 3 ≥ 10건)

```yaml
# skills/core/compliance-checker/rules.yaml
- id: clr-001
  name: clearance_vs_citation
  level: error
  description: 본문에 인용된 KB doc의 classification이 사용자 clearance를 초과
- id: clr-002
  name: clearance_vs_approval_line
  level: error
  description: 결재 라인 등급이 본문 최고 등급 미만
- id: ret-001
  name: retention_min
  level: warn
  description: 보존기간이 institution 기본값보다 짧음
# ... 10건 이상
```

### 7.4 Acceptance

- AC-3.10

---

## 8. Policy Guard `enforce` 전환

### 8.1 전환 절차

1. Phase 1 종료 직후 + Phase 3 초반에 dry-run 로그 분석 회의 (PM + 보안)
2. `policy.violation_detected` 이벤트 패턴 분석 → false positive 식별
3. 룰 보정 후 `policy_guard_mode: enforce` 토글
4. 초기 1주는 사용자 신고 모니터링 (예상치 못한 차단 케이스)
5. AC-3.12 통과 시 정식 enforce 모드 운영

### 8.2 회귀 안전

- Veluga Mode OFF — Policy Guard는 dry-run 처럼 동작 (Cowork 원본 회귀 보장)
- enforce 모드에서도 신규 도구는 audit_log 경고만 (Phase 1과 동일) — 운영 충격 최소화

---

## 9. PolicyService — mock에서 RPC로 교체

### 9.1 인터페이스 안정성

Phase 1 PolicyService mock의 인터페이스(`fetchAll(identity)`, `subscribe(listener)`)를 Phase 3 RPC 서버가 그대로 충족. 클라이언트(Electron Main)는 변경 불필요.

### 9.2 RPC 서버 스택 (제안)

- Python FastAPI 또는 Node Fastify (사내 인프라 합의 사항)
- 사내 데이터베이스에서 정책 YAML 읽기 + 변경 SSE/WebSocket push
- 인증: SSO 토큰 검증

> 본 PRD는 RPC 서버 구현 자체는 다루지 않는다. *클라이언트가 그 인터페이스를 충족하는 RPC 서버에 연결한다*는 contract만 본 Phase의 책임.

### 9.3 마이그레이션 절차

1. Phase 3 첫 주 — 인터페이스 stub 합의 (PM + 인프라)
2. mock과 RPC가 동일 인터페이스 충족하는지 자동 테스트
3. 환경변수로 토글: `VELUGA_POLICY_SOURCE=mock | rpc`
4. Phase 3 종료 전에 `rpc` 기본값으로 전환

### 9.4 Acceptance

- AC-3.11

---

## 10. 데이터 흐름 (Phase 3 시나리오)

### 10.1 시나리오 — KB 근거 보고서 작성 (P1)

```
이지영: "이 사업이 작년 산업부 가이드라인에 부합하는지 검토 의견 작성"
  → A1 → IntentPlan{ intent_class='compare_project_vs_kb',
                     answer_mode='mixed', use_kb=true,
                     kb_scopes=['policy:internal'],
                     suggested_skills=['gov-proposal', 'citation-verifier', 'docx'] }
  → A2 → GateDecision{ allow=true } (clearance=confidential ≥ policy:internal, KB available)
  → A3 → SkillActivationPlan{
         ordered_skills=[
           {id:'style-card', mode:'read'},
           {id:'gov-proposal', mode:'write'},
           {id:'citation-verifier', mode:'read'},
           {id:'compliance-checker', mode:'read'},
           {id:'docx', mode:'write'}
         ]}
  → Skill chain 실행
       1. style-card — 캐시 카드 사용 (Phase 2 산출)
       2. gov-proposal — kb_hybrid MCP 호출 → 외부 KB가 가이드 12건 + Veluga에서 Project 자료 4건 결합
                        → 응답 Zod 검증 + over-classification 안전망 통과
                        → 초안 작성, [src:doc_2024_0301|kb|as_of:2024-03-01],
                          [src:nb_사업계획서.docx#3|nb] 태그 부착
       3. citation-verifier — 양쪽 매칭 검증
       4. compliance-checker basic — 권한·보존기간·등급 OK
       5. docx — footnote 자동 생성, style-card 톤 반영
  → 응답: "/outputs/2026-05-23_검토의견_v1.docx (KB 인용 12건, NB 인용 4건, 미검증 0건)"
  → A4: 모든 도구 호출 enforce 통과
  → A5: citation.linked 12건 (KB), 4건 (NB), kb.queried 1건 (routing_explain 보존)
```

### 10.2 시나리오 — 권한 부족 차단 + 대안

```
박민호 (clearance=internal): "지난해 secret 등급 감사 자료 보여줘"
  → A1 → use_kb=true, kb_scopes=['audit:confidential']
  → A2 → GateDecision{ allow=false, reason='권한 부족: audit:confidential 접근 불가',
                       alternatives=['audit:internal (당신이 접근 가능)'] }
  → (외부 KB 호출 0회 — Veluga측에서 차단)
  → A7 친절 안내: "이 자료는 당신 권한으로 볼 수 없습니다. audit:internal scope의 비슷한 자료를 보시겠습니까?"
  → A5: gate.decided (deny + alternative 제안)
```

### 10.3 시나리오 — 외부 KB 일시 사용 불가

```
이지영: "올해 R&D 가이드 인용해서 보고서 초안"
  → A1 → use_kb=true
  → A2 → kbAdapter.isAvailable() == false → GateDecision{ allow=false, reason='KB 서비스 일시 사용 불가' }
  → A7: "현재 KB 사용 불가. 일반 답변(Project 자료 + parametric)으로 진행합니다."
  → 사용자, 동의 → answer_mode='project_only' fallback 으로 진행
  → A5: kb.unavailable + gate.decided (deny)
```

### 10.4 시나리오 — 시점 의존 자동 에스컬레이션 (Phase 1 시나리오 4 발전형)

```
이지영: "올해 R&D 세액공제 한도?"
  → A1 → answer_mode=general (Phase 1과 동일)
  → A6 → confidence='low', escalate_to_kb={ suggested_scopes:['tax:public'] }
  → A7: 일반 답변 + "▶ KB 활성화 권유"
  → 이지영, UI 토글로 KB 활성 → kb_scopes=['tax:public']
  → 같은 발화 재실행 (또는 "위 KB 적용해서 다시")
  → A1 → answer_mode='kb_grounded'
  → A2 → allow (clearance=confidential ≥ tax:public, KB available)
  → Skill chain → 답변 with [src:tax_2026_0101|kb|as_of:2026-01-01]
```

---

## 11. 테스트 전략 (Phase 3)

### 11.1 KB Contract 테스트 (mock 외부 KB)

- `tests/kb-contract/` — Zod 스키마 검증, over-classification redact, fallback 동작
- 외부 KB가 없는 dev 환경에서는 mock MCP 서버 픽스처(`tests/fixtures/kb-mcp-mock/`)로 대체 → 본 PRD 범위에 외부 KB 실서버 통합은 없음
- KB 골든셋(recall, MRR 등) 검증은 외부 KB 운영 주체의 책임 — Veluga 회귀에서 다루지 않음

### 11.2 Knowledge Gate 케이스

- `tests/knowledge-gate/cases.jsonl` — 100건 (allow/deny/alternative)
- 권한·정책·예산·KB 가용성 차단 시나리오 망라

### 11.3 Skill Resolver 시나리오

- 30건 (의존성 그래프 정확도)

### 11.4 권한 이중 방어 (외부 KB와의 정합성)

- Gate 통과 + 외부 KB 응답 권한 거부 케이스 = 0 (불일치 시 즉시 GAP 등록)
- 외부 KB가 over-classified chunk를 반환한 경우 → Veluga redactor가 차단 + audit_log

### 11.5 회귀

- Phase 1, 2 전체 AC 재실행

---

## 12. 위험 & 완화 (Phase 3)

| 위험 | 완화 |
|---|---|
| 외부 KB MCP 명세(시그니처)가 본 PRD 가정과 다름 | Phase 3 첫 주 GAP-P3-01에서 확정. 차이 있을 시 어댑터가 변환 |
| 외부 KB가 Phase 3 종료 전까지 미준비 | mock 외부 KB(`tests/fixtures/kb-mcp-mock/`)로 통합 테스트, 운영 환경은 외부 일정에 종속 (별도 GAP) |
| Knowledge Gate false positive (잘못 차단) | 100건 케이스 + 사용자 피드백 채널, Phase 3 둘째 달 튜닝 |
| 외부 KB 응답 latency 폭증 | Veluga측 timeout + retry 정책, 실패 시 일반 답변 fallback |
| Skill Resolver LLM fallback이 느림 | 카탈로그 비결정성 검증 후 LLM 호출 비율 < 5% 목표 |
| PolicyService RPC 교체 시 인터페이스 변경 | 인터페이스 동결 + contract test |
| enforce 전환 운영 충격 | Phase 3 셋째 주에 dry-run 분석, 넷째 주 enforce 전환, 1주 모니터링 |
| 외부 KB가 over-classified chunk 반환 | kb-redactor 안전망 + `kb.over_classification` audit 이벤트 |

---

## 13. 작업 순서 (AI agent용 8단계)

1. 외부 KB MCP 명세 협의 — `GAP-P3-01` 해소, 응답 시그니처가 §3.3과 일치하는지 확인 (불일치 시 어댑터 변환 로직 결정)
2. `packages/veluga-main/src/kb/` — KbMcpAdapter, kb-contract Zod, kb-redactor
3. mock 외부 KB 픽스처(`tests/fixtures/kb-mcp-mock/`) — 외부 KB 부재 환경에서 contract 테스트
4. A2 Knowledge Gate + A3 Skill Resolver
5. `gov-proposal` Skill + `compliance-checker` basic
6. `policy-research` (선택), `legal-opinion`/`budget-review` (선택)
7. PolicyService RPC 교체 (인터페이스 동결 검증)
8. Policy Guard enforce 전환 + 회귀

각 단계 PR은 AC 항목 명시.

---

## 14. Phase 3 산출물 (DoD)

- [ ] AC-3.1 ~ AC-3.18 전수 통과
- [ ] `packages/veluga-main/src/kb/` — 어댑터·contract·redactor 완성
- [ ] mock 외부 KB 픽스처 — contract 회귀 통과
- [ ] P1 페르소나 walkthrough — KB 근거 보고서 작성 → 인용 정합성 OK (외부 KB 운영팀이 dev 환경 제공한 상태에서)
- [ ] 외부 KB 일시 사용 불가 시나리오 walkthrough — 앱 정상 동작 + fallback 안내
- [ ] PolicyService RPC 서버 운영 환경 기동 (외부 책임)
- [ ] Policy Guard enforce 모드 1주 운영 보고서

---

## 15. Phase 4 인계

- KB MCP 어댑터(consumer)는 Phase 4 `kb_traverse` 도구 추가 시 그대로 재사용 (어댑터 안정 인터페이스)
- citation.linked / kb.queried 이벤트 누적 (Phase 4 결재 직전 점검 시드)
- compliance-checker rule 카탈로그 (Phase 4 parametric 차단 룰 추가)
- A3 Skill Resolver 의존성 그래프 (Phase 4 citation-tracer 추가)

---

## 16. Phase 3에서 발견한 Gap

| Gap ID | 항목 | 해결 시점 |
|---|---|---|
| GAP-P3-01 | **외부 KB MCP 도구 명세** — Veluga가 호출할 시그니처가 §3.3과 일치하는지 / 차이 시 어댑터 변환 로직 | Phase 3 첫 주, 외부 KB 운영 주체와 합의 |
| GAP-P3-02 | **외부 KB 서비스 제공 시점·SLA** (Veluga 통합 일정에 영향) | Phase 3 첫 주, 외부 운영 주체 |
| GAP-P3-03 | **PolicyService RPC 인터페이스 동결** (mock 호환성) | Phase 3 첫 주 |
| GAP-P3-04 | **외부 KB 인증·세션 토큰 전달 방식** (PolicyContext 토큰을 외부 KB에 어떻게 전달?) | Phase 3 첫 주, 외부 운영 주체 + 보안 |
| GAP-P3-05 | enforce 전환 후 신규 도구 화이트리스트 운영 절차 | Phase 3 셋째 주 |
| GAP-P3-06 | KB consumer 어댑터의 fallback UX 디자인 (KB unavailable 안내 카피) | Phase 3 둘째 주 디자인 |
