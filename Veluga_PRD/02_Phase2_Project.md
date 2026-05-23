# 02 — Phase 2: Project Layer (NotebookLM Lite)

> **목표 한 줄**: Project 자료(폴더 단위)에서 자료를 읽고 한국어 보고서 톤·인용 태그까지 강제한 초안을 만들 수 있는 단계. KB 없이도 "내 폴더 안 자료"만으로 작성 자동화가 동작.
>
> **기간**: 4~6주
> **선행**: Phase 1 머지 완료 (L0+L1 fork+L2 최소+화이트라벨링)
> **후속**: Phase 3 (외부 KB Consumer)
> **문서 상태**: ✅ 구현 완료 (2026-05-23 기준 Phase 2 구현·검증 완료)
>
> **이 PRD 단독으로 작업 가능**: ✅ (Phase 1 산출 + `99_Appendix.md` 시그니처 참조)

---

## 1. 범위

### 1.1 In-scope

| 영역 | 산출물 |
|---|---|
| **L3 Project 어댑터** | Cowork Project 컨테이너 위에 `project.yaml` 정책 tier 결합, `last_session_summary` 갱신 hook |
| **재진입 UI** | Project 클릭 → 상단 배너 1줄 자동 표시, "이어서 작업" 버튼 |
| **L4 core Skill — `style-card`** | Project 자료에서 사내 보고서 톤 1회 추출 → Project 메타 저장 |
| **L4 core Skill — `citation-verifier`** | Drafter 출력의 인용 태그 매칭 검증, 미매칭 `[unverified]` 마킹 |
| **L4 format Skill — `docx` 어댑터** | Cowork 기본 `docx` 위에 Veluga 인용 태그 강제 + 결재 부적합 워터마크 |
| **A1 확장** | `summarize_project`, `draft_with_grounding` (Project only) intent 분류 정확도 |
| **Audit Logger 확장** | `session.summary` 이벤트, `citation.linked` (Project 인용 한정) |

### 1.2 Out-of-scope (Phase 3+ 이관)

- 외부 KB MCP consumer 어댑터, KB 인용 (`|kb` 태그) → Phase 3 (KB 자체는 외부 시스템)
- A2 Knowledge Gate, A3 Skill Resolver → Phase 3
- domain Skill (`gov-proposal` 등) → Phase 3
- compliance-checker 결재 본문 검증 → Phase 4
- approval-queue Artifact → Phase 4
- Policy Guard `enforce` 모드 전환 → Phase 3

### 1.3 Phase 2가 해결하는 페르소나 빈틈

- **G1 (사용성)**: Project 재진입 시 "어제 어디까지" 1줄 요약 자동 표시.
- **P1 (실무자)**: Project 자료 4페이지 요약, Project 자료 기반 초안 작성 가능.
- **결재 부적합 인지**: 일반 응답이 본문에 박힌 보고서에 워터마크 자동 표시 (Phase 4 차단 룰 전 단계 학습).

---

## 2. Acceptance Criteria

### 2.1 기능 AC

- [x] **AC-2.1** Cowork Project 열기 → `project.yaml` 자동 로드 → PolicyContext에 project tier 머지
- [x] **AC-2.2** Project 첫 생성 시 소유자(현재 사용자) 자동 등록, 상위 org 정책에서 상속, `project.yaml` 디스크 영속
- [x] **AC-2.3** Project 자료 4페이지 요약 — A1 `summarize_project` intent 분류 ≥ 90%, 요약 결과에 `[src:nb_<file>#<chunk>|nb]` 인용 태그 ≥ 1개
- [x] **AC-2.4** `style-card` Skill — Project 자료 ≥ 3개 업로드 시 자동 추출, Project 메타에 저장 (재실행 시 캐시 사용)
- [x] **AC-2.5** `citation-verifier` — Drafter 출력 100문장 샘플에서 인용 태그 매칭 정확도 ≥ 95%, 미매칭은 `[unverified]` 마킹
- [x] **AC-2.6** `docx` 어댑터 — 출력 docx 파일에 인용 태그 footer 또는 endnote로 보존
- [x] **AC-2.7** parametric 태그 포함 보고서 → 워터마크 자동 표시 (PDF/docx 미리보기·인쇄 양쪽)
- [x] **AC-2.8** 세션 종료 시 Audit Logger가 `session.summary` 이벤트 발행 + `project.yaml.last_session_summary` 갱신
- [x] **AC-2.9** 재진입 시 Project 클릭 → 1초 내 배너 표시. 빈 Project는 배너 미표시.

### 2.2 비기능 AC

- [x] **AC-2.10** Phase 1 회귀 — Phase 1 AC 전체 재실행 통과 (Phase 2 변경이 Phase 1을 깨지 않음)
- [x] **AC-2.11** `style-card` 추출 — Project 자료 10MB 기준 ≤ 30초 (1회만, 캐시)
- [x] **AC-2.12** `citation-verifier` — 1000자 텍스트 검증 ≤ 2초

### 2.3 회귀 AC

- [x] **AC-2.13** Veluga Mode OFF — Cowork 원본 Project 동작 보존 (재진입 배너·워터마크 없음)
- [x] **AC-2.14** PolicyContext에 active_project 없을 때 — 모든 Phase 2 기능이 안전하게 비활성

---

## 3. L3 — Project 어댑터 구현

### 3.1 `project.yaml` 정책 tier 결합

#### 3.1.1 스키마 (Phase 2 정식)

```yaml
# project.yaml
project_id: project-abc
owner: sylee@veluga.io
purpose: "에너지 정책 검토 보고서"
created_at: 2026-05-22T16:00:00+09:00
overrides:
  external_apis: deny             # 상위가 allow여도 여기서 deny 가능
  active_skills: [docx, style-card, citation-verifier]
  pinned_kb_docs: []              # Phase 3부터 사용
shared_with: []                   # Phase 5+
style_card_id: null               # style-card Skill이 1회 추출 후 채움
last_session_summary: null        # Audit Logger가 세션 종료 시 1줄 작성
last_session_at: null
```

#### 3.1.2 로드·머지 흐름

```
[사용자가 좌측 Project 클릭]
  → Cowork Project Open 이벤트
  → ProjectReentryHook (packages/veluga-main/src/project-reentry.ts):
       1. project.yaml 디스크 읽기
       2. PolicyContext 에 project tier 머지 (5-tier 머지 엔진 재사용)
       3. Renderer broadcast — 좌측 Skill 카탈로그 재계산
       4. last_session_summary 가 있으면 상단 배너로 전달
  → Cowork Project Open 완료 → 사용자 작업 시작
```

#### 3.1.3 Project 생성 흐름

```
[Cowork 기본 Project 생성 UI]
  → Veluga: ProjectInitializer 가 hook 됨
       1. project_id 발급
       2. owner = 현재 PolicyContext.user.user_id
       3. 상위 org.default_skills + user.extra_skills 기반 active_skills 자동 설정
       4. project.yaml 디스크 저장
```

#### 3.1.4 파일 위치

- `packages/veluga-main/src/project-reentry.ts`
- `packages/veluga-main/src/project-initializer.ts`
- `packages/veluga-ui/i18n/ko.json` — Project 관련 한국어 라벨

### 3.2 `last_session_summary` 갱신

#### 3.2.1 트리거 — *언제* 1줄을 쓰는가

- Cowork 세션 종료 이벤트 (`session.onEnd` 또는 동등 hook)
- 단, 세션 turn 수 0 (빈 세션) — skip
- Veluga Mode OFF — skip

#### 3.2.2 생성 알고리즘 (LLM 1회)

```
입력: 세션의 마지막 5 turn 발화·응답 요약
프롬프트(요지): "다음 5개 turn을 한국어 1문장으로 요약. 작업 진행 상태·산출물·블로커 1개씩만 언급. 60자 이내."
출력 검증: 60자 초과 시 truncation
저장: project.yaml.last_session_summary = "{datetime} — {summary}"
```

이 1회 LLM 호출은 `llmGateway`를 통해 사내 게이트웨이에 가야 한다 (외부 API 0건 유지).

#### 3.2.3 부수효과 보장

`session.summary` 이벤트로 Audit Logger에 영속화 — 별도 에이전트 추가 없음 (원칙 2 준수).

### 3.3 재진입 배너 UI

```tsx
// packages/veluga-renderer/src/project-reentry-banner.tsx
export function ProjectReentryBanner({ project }: { project: ProjectMeta }) {
  if (!project.last_session_summary) return null;
  return (
    <div className="bg-primary/10 border border-primary/30 px-4 py-2 rounded">
      <span className="text-primary text-sm">{project.last_session_summary}</span>
      <button onClick={resumeSession}>이어서 작업</button>
    </div>
  );
}
```

"이어서 작업" 동작: 마지막 세션의 첨부 자료·활성 Skill state를 복원. (Cowork 세션 메타에서 복원 가능한 범위만)

---

## 4. L4 Skill — `style-card`

### 4.1 목적

Project 자료에서 사내 보고서 톤·구조 패턴을 *1회* 추출 → Project 메타에 카드(JSON)로 저장 → 이후 Drafter 호출 시 시스템 프롬프트에 자동 주입.

### 4.2 입력·출력

- 입력: Project root 의 모든 텍스트 추출 가능 자료 (docx/pdf/md/txt)
- 출력: `StyleCard` JSON, Project 메타에 저장

```ts
interface StyleCard {
  card_id: string;
  project_id: string;
  generated_at: string;
  patterns: {
    tone: string;                     // "공식·간결·문어체"
    sentence_style: string;           // "단문 위주, 어휘 정확"
    section_titles: string[];         // ["1. 개요", "2. 현황", ...]
    typical_sentence_examples: string[];  // 3~5개 예시
    avoided_phrases: string[];        // "감히", "주관적 견해" 등
  };
  source_files: string[];             // 추출에 사용한 파일들
  llm_invocations: number;            // 추출 비용 추적
}
```

### 4.3 알고리즘 (LLM 1회)

```
1. Project root에서 텍스트 추출 — 파일당 최대 N토큰 샘플링
2. LLM 프롬프트: "다음 사내 보고서 자료에서 톤·문체·섹션 구성 패턴을 JSON 5개 필드로 추출"
3. JSON schema 검증 (zod)
4. project.yaml.style_card_id 에 카드 ID 기록, 카드 본체는 별도 파일 `project/.veluga/style-cards/<card_id>.json`
5. 다음 호출 시 캐시 사용 (자료 변경 감지 시 재추출 옵션)
```

### 4.4 Drafter 통합 (Phase 2의 docx Skill에서)

Drafter Skill 시스템 프롬프트에 다음을 자동 주입:
```
[STYLE CARD]
{style_card.patterns_serialized}
이 톤과 구조를 따르라. 단, 인용 태그는 절대 누락하지 말 것.
```

### 4.5 Acceptance

- AC-2.4 — 자료 3개 이상 업로드 시 자동 추출
- 추출된 카드의 `patterns.tone` 필드가 비어있지 않아야 함 (unit test로 검증)

---

## 5. L4 Skill — `citation-verifier`

### 5.1 목적

Drafter Skill의 출력에서 모든 인용 태그(`[src:...]`)가 실제 자료에 매칭되는지 검증. 미매칭은 `[unverified]` 마킹 또는 본문 차단(정책에 따라).

### 5.2 인용 태그 문법 (Phase 2)

- Project 자료 인용: `[src:nb_<file>#<chunk>|nb]`
- (Phase 3에서 추가: `[src:<doc_id>|kb|as_of:<date>]`)

### 5.3 매칭 알고리즘

#### 5.3.1 Project 자료 인용 매칭 (Phase 2 범위)

```
1. 인용 태그 파싱 — 정규식 /\[src:([a-zA-Z0-9_#-]+)\|nb\]/g
2. 각 태그의 (file_id, chunk_id) 추출
3. Project root에서 해당 파일 존재 확인
4. chunk_id 가 파일 내 chunk 인덱스에 존재하는지 확인 (chunking 룰은 §5.3.2)
5. 본문 텍스트가 chunk 내용과 fuzzy match (Levenshtein 또는 embedding 코사인 ≥ 0.85)
6. 미매칭 — [unverified] 로 변환 또는 차단 (정책: institution.yaml.unverified_quotes)
```

#### 5.3.2 Chunk 룰 (Phase 2 단순)

- 파일을 ~800자 단위 청크로 분할 (한국어 기준)
- chunk_id = 0-based 인덱스
- chunk 경계는 문장 경계 우선 (KSS 같은 한국어 문장 분리기)

#### 5.3.3 정확도 목표

- AC-2.5 — 100문장 샘플 95% 정확도
- false positive (잘못 매칭) < 2% (overshooting 회피)

### 5.4 출력 형태

```ts
interface VerificationResult {
  total_citations: number;
  matched: number;
  unmatched: { tag: string; position: number; reason: string }[];
  modified_text: string;   // [unverified] 마킹 적용된 텍스트
}
```

### 5.5 정책 분기

- `institution.yaml.unverified_quotes: deny` → 미매칭 본문 자체를 차단, Drafter에게 재작성 요청
- `unverified_quotes: warn` → `[unverified]` 마킹만, 본문은 유지
- Phase 2 기본: `warn` (학습 단계). Phase 4부터 `deny` 권장.

---

## 6. L4 Skill — `docx` 어댑터

### 6.1 베이스: Cowork 기본 `docx` Skill 또는 사내 docx skill

> Cowork 기본 `docx` Skill을 *그대로* 활용. Veluga는 다음만 추가.

### 6.2 추가 기능

#### 6.2.1 인용 태그 자동 부착

Drafter Skill이 출력하는 텍스트에 `[src:...]` 태그가 자연어 중에 박혀 있음. docx 변환 시 다음 옵션 중 하나:

- **옵션 A (기본)**: footnote — 본문에서 인용 위치에 위첨자 번호, 페이지 하단에 출처 명시
- **옵션 B**: endnote — 문서 끝 "참고자료" 섹션에 일괄 정리
- **옵션 C**: inline — `[1]` 같은 간단 번호만, 별도 표 없음

설정: `project.yaml.docx_citation_style: footnote | endnote | inline` (기본 `footnote`).

#### 6.2.2 결재 부적합 워터마크

```
조건: 문서 내 parametric:high 또는 parametric:low 태그가 1개 이상 존재
워터마크: "결재 부적합 — 검토용" (회색 45° 대각선, 모든 페이지)
구현: python-docx 또는 동등 라이브러리로 워터마크 삽입
```

#### 6.2.3 신뢰도 태그 후처리

`[parametric:high]` / `[parametric:low]` 태그는 사용자가 보지 않게 처리:
- **본문에서는 제거** (UI에서는 색상으로 표시했지만 docx에는 제거된 형태가 결재용)
- 단, 워터마크 트리거는 유지 (제거 *전*에 검사)
- footnote/endnote 에 "이 단락은 LLM 일반 지식 기반 (검토 필요)" 같은 주석 자동 삽입

### 6.3 출력 위치

- 기본: Project 출력 폴더 (Cowork 컨벤션). `project/{project_id}/outputs/{timestamp}_{filename}.docx`
- Policy Guard가 외부 송신 시도 시 HITL 발동.

### 6.4 Acceptance

- AC-2.6, AC-2.7

---

## 7. A1 Intent Router 확장 (Phase 2)

### 7.1 새 intent_class 활성

Phase 1엔 fallback 처리되던 다음을 정식 분기:
- `summarize_project` → Project 자료만 읽고 요약
- `draft_with_grounding` (Project only) → Project 자료 인용하여 작성

### 7.2 골든셋 확장

`tests/intent-router/golden.jsonl` 에 Project 시나리오 30건 추가. 분류 정확도 ≥ 87% (Phase 1 85% 대비 향상).

### 7.3 use_kb 분기

Phase 2엔 `use_kb=true` 라도 KB가 없으므로 `Project only fallback + 친절 안내` 응답:
"이 작업은 KB 자료가 필요해 보입니다. Phase 3 KB 기능이 활성화되면 자동으로 사용됩니다. 지금은 Project 자료로 시도해보겠습니다."

---

## 8. Audit Logger 확장

### 8.1 새 이벤트

- `session.summary` — 세션 종료 시 1줄 요약 + 토큰 사용량 + Skill 사용 횟수
- `citation.linked` (Project 한정) — Drafter 출력의 인용 태그가 어떤 Project 파일에 매핑되었는지 (Phase 4 citation-tracer 결재 직전 점검에서 참조)
- `style_card.extracted` — style-card 추출 이벤트
- `unverified.detected` — citation-verifier가 미매칭 발견

### 8.2 페이로드 예시

```json
// session.summary
{
  "session_id": "...",
  "turn_count": 12,
  "last_summary": "보고서 초안 작성 중, 인용 12건 확보",
  "skills_invoked": { "style-card": 1, "citation-verifier": 3, "docx": 1 },
  "llm_invocations": { "intent": 8, "general": 3, "drafter": 2, "summary": 1 },
  "tokens_used": 14523
}
```

---

## 9. 데이터 흐름 (Phase 2 시나리오)

### 9.1 시나리오 — Project 자료 요약 (시나리오 1)

```
이지영, 좌측 Project "에너지 정책 검토" 클릭
  → ProjectReentryHook → project.yaml 머지 → 배너 "어제 09:30 — 인용 자료 정리 중"
  → "이어서 작업" 클릭

이지영: "방금 올린 사업계획서 4페이지 요약해줘"
  → A1 → intent_class='summarize_project', use_kb=false, suggested_skills=['docx' 읽기용]
  → docx Skill 읽기 모드 — Cowork Read tool 호출 → 파일 추출
  → LLM 요약 (게이트웨이 경유)
  → 응답: "이 사업의 핵심은 ... [src:nb_사업계획서.docx#3|nb]"
  → A5: tool.called, citation.linked
```

### 9.2 시나리오 — Project 자료 기반 초안

```
이지영: "이 자료들을 바탕으로 한 페이지 요약 보고서 초안 작성"
  → A1 → intent_class='draft_with_grounding', use_kb=false
  → suggested_skills=['style-card', 'docx', 'citation-verifier']
  → style-card 1회 추출 (캐시 없을 때) → Project 메타 저장
  → Drafter (docx Skill 작성 모드) — style-card + Project 자료 청크 주입
  → 출력: 본문 + [src:nb_*|nb] 태그
  → citation-verifier 자동 활성 → 미매칭 [unverified] 마킹
  → docx 어댑터 → footnote 자동 생성 → 출력 폴더 저장
  → 응답: "초안 작성 완료. /outputs/2026-05-23_보고서_v1.docx (참조 12건, 미검증 0건)"
```

### 9.3 시나리오 — Veluga Mode OFF 회귀

Phase 1 시나리오 8.4와 동일하게 작동. Phase 2 기능이 비활성, Open Cowork Project 기본 동작만.

### 9.4 시나리오 — 세션 종료·재진입

```
이지영, 작업 종료 (앱 종료 또는 다른 Project 전환)
  → 세션 onEnd → last_session_summary 갱신 LLM 1회 → project.yaml 디스크 쓰기
  → A5: session.summary 이벤트

다음 날 09:00
  → 이지영, Cowork 진입 → 좌측 Project 목록 → 클릭
  → 배너 "2026-05-23 17:30 — 보고서 초안 v1 작성, 미검증 인용 0건"
  → "이어서 작업"
```

---

## 10. 테스트 전략 (Phase 2)

### 10.1 새 테스트 모듈

- `tests/project-reentry/` — 배너 표시·미표시 조건
- `tests/style-card/` — 추출 결정성·캐시
- `tests/citation-verifier/` — 매칭 정확도 (100문장 골든셋)
- `tests/docx-adapter/` — footnote·워터마크·태그 제거 회귀
- `tests/intent-router-phase2/` — `summarize_project`, `draft_with_grounding` 분류

### 10.2 회귀

- Phase 1 전체 AC 재실행
- Veluga Mode OFF — Project 어댑터·배너 미작동 확인

---

## 11. 위험 & 완화 (Phase 2)

| 위험 | 완화 |
|---|---|
| Cowork Project 컨테이너 hook이 예상과 다름 | Phase 1 `docs/cowork-hooks.md` 에 Project hook 위치 검증, 누락 시 GAP-P2 등록 |
| style-card 추출 비결정성 (LLM 매번 다름) | 카드 한 번 추출 후 캐시, 자료 변경 감지 시에만 재추출 |
| citation-verifier false positive (잘못 unverified) | fuzzy threshold 튜닝, 최소 95% 정확도까지 골든셋 반복 |
| docx 워터마크 라이브러리 호환성 | python-docx 사이드카 또는 docx Skill에 의존 — 사전 PoC |
| last_session_summary 60자 초과 | LLM 출력 후 자동 truncation + ellipsis |
| Project 자료가 비어 있을 때 style-card 추출 실패 | "자료가 부족합니다. 최소 3개 이상 업로드" UI 경고 |

---

## 12. 작업 순서 (AI agent용 8단계)

1. Cowork Project hook 위치 실증 — `docs/cowork-hooks.md` 업데이트
2. `project.yaml` 스키마 + 머지 엔진 확장 (Phase 1 머지 코드 재사용)
3. `ProjectReentryHook` + `ProjectInitializer` 구현
4. `<ProjectReentryBanner>` UI + "이어서 작업" 동작
5. `style-card` Skill — LLM 1회 + 캐시 + Project 메타 저장
6. `citation-verifier` Skill — 매칭 알고리즘 + `[unverified]` 마킹 + 골든셋 정확도 검증
7. `docx` 어댑터 — footnote/endnote/inline 옵션 + parametric 워터마크 + 태그 제거 후처리
8. A1 Intent Router 확장 + `session.summary` 이벤트 + E2E 시나리오 자동화

---

## 13. Phase 2 산출물 (DoD)

- [x] AC-2.1 ~ AC-2.14 전수 통과
- [x] P1 페르소나 walkthrough — Project 재진입 → 자료 요약 → 초안 작성 → 미검증 인용 0건
- [x] `docs/cowork-hooks.md` Project 섹션 확정
- [x] `tests/citation-verifier/golden-citations.jsonl` 100건 골든셋
- [x] Phase 3 인계 자료 — Project 인용 태그 카탈로그 (Phase 3 KB 인용 태그와 통합 검증용)

---

## 14. Phase 2에서 발견한 Gap (`98_Gap_Analysis.md` 등록)

| Gap ID | 항목 | 해결 시점 |
|---|---|---|
| GAP-P2-01 | Cowork Project hook 함수 시그니처 확인 (open/close/save) | Phase 2 첫 주 |
| GAP-P2-02 | docx 워터마크 라이브러리 PoC (python-docx sidecar vs JS lib) | Phase 2 첫 주 |
| GAP-P2-03 | 한국어 chunking 라이브러리 선정 (KSS vs Kiwi vs 자체) | Phase 2 둘째 주 |
| GAP-P2-04 | citation-verifier fuzzy threshold 결정 (Levenshtein vs embedding) | Phase 2 셋째 주 PoC 결과 보고 |
| GAP-P2-05 | last_session_summary가 60자 외 단위로 의미 있는지 (UX 검증) | Phase 2 종료 직전 P1 페르소나 인터뷰 |

---

## 15. PRD 완료 상태

> 이 섹션은 **문서 완성 여부**와 **구현 완료 여부**를 표시한다.

### 15.1 완료 판정

| 점검 항목 | 상태 | 근거 |
|---|---|---|
| Scope / Out-of-scope | 완료 | §1에서 Project Layer 책임과 Phase 3+ KB 범위 분리 |
| Acceptance Criteria | 완료 | §2에 기능·비기능·회귀 AC 14개 정의 |
| Project 정책 tier | 완료 | §3에 `project.yaml` 스키마, 로드·머지, 생성 흐름, 파일 위치 포함 |
| Core Skill 명세 | 완료 | §4~§6에 `style-card`, `citation-verifier`, `docx` 어댑터 명세 포함 |
| Intent / Audit 확장 | 완료 | §7~§8에 Phase 2 intent class, KB fallback, 신규 audit event 포함 |
| 데이터 흐름 | 완료 | §9에 Project 요약, 초안 작성, Veluga Mode OFF, 세션 재진입 시나리오 포함 |
| 테스트 전략 | 완료 | §10에 신규 테스트 모듈과 Phase 1 회귀 기준 포함 |
| 위험·Gap | 완료 | §11, §14 및 `98_Gap_Analysis.md`에 Phase 2 블로커·주의 항목 연결 |
| 작업 순서 / DoD | 완료 | §12~§13에 AI agent 작업 순서와 Phase 3 인계 산출물 정의 |

### 15.2 구현 착수 전 필수 확인 (완료됨)

- [x] Phase 1 산출물 (`docs/cowork-hooks.md`, PolicyContext 타입, Audit Logger 이벤트 카탈로그) 머지 확인
- [x] GAP-P2-01 해소 완료 (Cowork Project hook 시그니처 확인)
- [x] docx 워터마크 (python-docx 사이드카) 및 한국어 chunking (KSS) PoC 완료

### 15.3 완료 선언

Phase 2는 2026-05-23 기준 구현·검증 완료되었다. AC-2.1 ~ AC-2.14 전수 통과, DoD 전 항목 완료. Phase 3 인계 준비 완료.
