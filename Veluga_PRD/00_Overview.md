# 00 — Veluga Agents Overview

> **이 문서의 역할**: 모든 Phase PRD가 공통으로 의존하는 미션·원칙·아키텍처·페르소나·용어 정의. AI coding agent가 작업 시작 전 반드시 읽는다.
>
> **버전**: 1.1 (2026-05-23)
> **상위 문서**: `오픈소스 이용한 방향.md` / `veluga_agentic_system_design.md v1.2` / `veluga_usability_review.md`
>
> **본 PRD 세트의 범위 (Non-negotiable)**: Veluga Agents는 **에이전트 시스템**이다. 기관 KB(Vector DB, RDB, Graph, 임베딩 파이프라인, 문서 ingest)는 **외부에서 제공되는 시스템**이며 본 PRD 세트의 범위 밖이다. Veluga는 그 KB를 **MCP 도구 또는 API의 소비자(consumer)** 로만 결합한다.

---

## 1. 미션 & Goals

### 1.1 한 줄 미션
> *Cowork(open source)가 골격을 주고, Skill이 능력을 주고, 정책이 권한을 주고, 시스템 에이전트 7개가 결정만 한다.*

폐쇄망 공공기관·금융권 업무 담당자가 결재 라인까지 안전하게 흘려보낼 수 있는 agentic 작업 환경을 만든다. **Open Cowork(MIT)를 fork하여 'Veluga Agents'로 화이트라벨링**한 데스크톱 앱이 베이스다.

### 1.2 Success Goals

| ID | Goal | 측정 | Phase |
|---|---|---|---|
| G-1 | 폐쇄망 환경에서 Open Cowork fork가 안정 기동 + Veluga 브랜딩 완성 | SSO → 세션 → 채팅 → 종료 무결함 + 작업관리자/Dock에 "Veluga" 표시 | Phase 1 |
| G-2 | PolicyContext 단일 진실로 권한 통제 | 100%의 도구 호출이 Policy Guard 인터셉터 통과 | Phase 1 |
| G-3 | 신뢰도 태그 강제 | 모든 LLM 응답 문장에 4개 태그 중 하나 부착 (compliance-checker 자동 점검) | Phase 1 → 4 |
| G-4 | 결재자 동선 단일화 | P3 페르소나가 8건 결재를 세션 1개 + Artifact 1개로 처리 | Phase 4 |
| G-5 | 회귀 안전망 | Veluga Mode OFF 시 Open Cowork 원본 회귀 테스트 100% 통과 | Phase 1~4 상시 |
| G-6 | 보안 감사 통과 | 외부 트래픽 0 byte / 텔레메트리 패키지 0건 | Phase 1 |
| G-7 | 외부 KB consumer로서 인용 정합성 | KB scope 권한 ↔ 인용 자격 일치, 미매칭 인용 자동 차단 (KB 서비스 자체는 외부 의존) | Phase 3~4 |

### 1.3 Non-Goals (이 PRD 시리즈 범위 밖)

- **기관 KB 시스템 구현** — Vector DB·RDB·Graph 저장소, 임베딩 모델 호스팅, 문서 ingest 파이프라인, 메타데이터 거버넌스, 디스크 암호화·백업 — 모두 외부 운영 주체 책임. Veluga는 **MCP/ API consumer**.
- 팀 Project (다중 사용자 공유) — Phase 5+
- Compliance Checker의 LLM 의미 검증 — 인간 검토자 영역
- 실시간 SIEM 통합 — append-only DB만 (Phase 4 평가 후)
- 모바일/웹 클라이언트 — Electron 데스크톱만
- Cowork upstream에 기여(PR back) — 1차 출시 후 검토

---

## 2. 5대 빌드 원칙 (절대 위배 금지)

> 이 5개 원칙은 모든 Phase PRD가 따른다. 위배 발견 시 PRD를 고치는 것이 아니라 `98_Gap_Analysis.md`에 올린다.

1. **L1 (Open Cowork)은 fork만 한다. 본체 코드는 수정하지 않는다.** 모든 Veluga 로직은 미들웨어·인터셉터·MCP 도구·Skill로 *얹는다*.
2. **새 컴포넌트를 만들지 않는다.** Cowork·Skill·정책·Artifact·MCP로 풀 수 있으면 그걸로 푼다. **기관 KB도 Veluga가 만들지 않는다 — 외부 의존(MCP/API consumer)만.**
3. **권한이 자료보다 먼저다.** L0 (Identity/Policy)는 Phase 1에서 반드시 완성. 미완성 권한 위에 KB를 얹지 않는다.
4. **모든 출력 문장에 신뢰도 태그**: `[src:<id>|kb|as_of:<date>]` / `[src:<id>|nb]` / `[parametric:high]` / `[parametric:low]`. 결재 본문 정식 근거는 `|kb`만.
5. **Veluga Mode Feature Toggle**을 Phase 1부터 박는다 (`enable_veluga_orchestration: bool`). OFF일 때 Open Cowork 원본 동작이 살아 있어야 한다 — 회귀 안전망.

### 추가 운영 원칙

6. **화이트라벨링 자산은 별도 폴더 분리** (`packages/veluga-ui/`). 원본 수정 최소화 → upstream 보안 패치 머지 안전성. MIT 의무는 Credits 페이지 1개로 충족.
7. **임의 결정 금지**. PRD에 명세되지 않은 결정 필요 시 코드 멈추고 `98_Gap_Analysis.md`에 질문 등록.

---

## 3. 5-레이어 아키텍처

```
┌────────────────────────────────────────────────────────────────────┐
│  L0  Identity & Policy            [Veluga 자체 개발]               │
│      SSO/OAuth → IdentityResolver → PolicyService → PolicyContext  │
│      5-tier YAML: Institution > Org > Project > User > Session     │
└─────────────────────────┬──────────────────────────────────────────┘
                          │ 세션 시작 시 인메모리 주입
┌─────────────────────────▼──────────────────────────────────────────┐
│  L1  Cowork Foundation            [Open Cowork fork — 수정 금지]   │
│      Electron + React 19 + Tailwind / SQLite / MCP / HITL          │
│      세션·Project·파일 도구·Task 위젯·Artifact·Sub-agent           │
└─────┬──────────────────────────────┬──────────────────────────┬────┘
      │ 진입 미들웨어                │ 도구 인터셉터            │ MCP
┌─────▼──────────────────────────────▼──────────────────────────▼────┐
│  L2  Orchestration Agents (7개)   [Veluga 핵심 자산]               │
│      [시스템] A1 Intent Router(+fast-path) / A2 Knowledge Gate /   │
│               A3 Skill Resolver / A4 Policy Guard / A5 Audit Logger│
│      [일반]   A6 General Planner / A7 General Responder            │
└─────┬──────────────────────────────────────────────────────────────┘
      │ 자료원 분기
┌─────▼──────────────────────────────────────────────────────────────┐
│  L3  Knowledge Layer                                                │
│      [Project] Cowork 내장 — NotebookLM 컨테이너 (Veluga 어댑터)    │
│      [KB]     ────────── 외부 의존 ──────────                      │
│              Veluga는 KB MCP/API의 consumer 어댑터만 제공.         │
│              KB 인덱스·임베딩·ingest·운영은 본 PRD 범위 밖.        │
└─────┬──────────────────────────────────────────────────────────────┘
      │ Skill chain
┌─────▼──────────────────────────────────────────────────────────────┐
│  L4  Capability (Skills)          [Veluga 특화 + Cowork 기본]      │
│      core / domain / format / user 4 영역                          │
└────────────────────────────────────────────────────────────────────┘
```

### 3.1 결합 3패턴 (오픈소스 코드 비파괴 결합)

| 패턴 | 적용 에이전트 | Cowork 결합 위치 |
|---|---|---|
| ① 진입 미들웨어 | A1 Intent Router (+ fast-path), A6/A7 분기 | UI → Runtime IPC 경로 |
| ② 도구 인터셉터 | A4 Policy Guard, A5 Audit Logger | Cowork HITL hook (도구 실행 직전) |
| ③ MCP/API consumer | A2 Knowledge Gate, A3 Skill Resolver, **외부 KB MCP 어댑터** | Cowork MCP 클라이언트 + Veluga 어댑터(권한 머지·재검증·redact) |

### 3.2 프로세스 토폴로지

```
Electron Renderer (React 19 + Tailwind)
        ↑↓ preload bridge (IPC)
Electron Main Process
  ├ openCoworkRuntime (원본, 수정 금지)
  ├ velugaOrchestrator (Veluga 미들웨어)
  │   └ KbMcpAdapter (consumer)  ──── MCP/HTTP ─── ▶  [외부 KB MCP/API]  (본 PRD 범위 밖)
  └ SQLite (메시지/Project/감사 로그)
        ↓ stdio/socket MCP
   ┌─────────────────────────────────┐
   │ External MCP (결재시스템 등)     │
   └─────────────────────────────────┘
```

---

## 4. 페르소나 4명

| 코드 | 페르소나 | clearance | 메인 동선 | 가장 중요한 Phase |
|---|---|---|---|---|
| **P1** | 이지영 사무관 (실무자) | confidential | Project + KB로 보고서 작성 → 결재 상신 | Phase 2~4 |
| **P2** | 박민호 사무관 (신입) | internal | 첫 사용, 시스템 능력 탐색, 일반 챗으로 학습 | Phase 1 |
| **P3** | 김선영 과장 (결재자) | secret | `approval-queue` Artifact 1개로 부하 결재 8건 일괄 검토 | Phase 4 |
| **P4** | 정수민 주무관 (IT 관리자) | (관리권) | 사용자/정책/Skill 카탈로그 운영, 감사 쿼리 | Phase 1·4 |

### 4.1 운영 환경 제약 (Non-negotiable)

- **폐쇄망 / 외부 API 차단** — 모든 LLM 호출은 로컬 LLM 또는 통제된 사내 게이트웨이
- **데이터 residency**: on-premise
- **감사 로그 필수**: 모든 도구 호출·KB 조회·HITL 승인 append-only 영속화
- **결재 라인 인용 자격 강제**: parametric 태그는 결재 본문 정식 근거 진입 자동 차단

---

## 5. Phase 1~4 한눈에

| Phase | 기간 | 한 줄 | 주 산출 | 상태 |
| --- | --- | --- | --- | --- |
| **Phase 1** | 8~10주 | "권한 있는 일반 챗봇" + 화이트라벨링 완성 | Veluga 브랜딩 데스크톱 빌드 + SSO + PolicyContext + A1/A4/A5/A6/A7 + system-self-help Skill | ✅ 완료 |
| **Phase 2** | 4~6주 | "NotebookLM Lite" | Project 재진입 + style-card·citation-verifier·docx Skill | ✅ 완료 |
| **Phase 3** | 6~8주 | "외부 KB Consumer" | KB MCP **consumer 어댑터** + A2 Knowledge Gate + A3 Skill Resolver + gov-proposal Skill (외부 KB는 의존만) | 🔜 다음 |
| **Phase 4** | 6~8주 | "결재 라인 진입" | citation-tracer (graph consumer) + compliance-checker full + approval-queue Artifact + Docker 샌드박싱 | 미착수 |

### 5.1 Phase 의존 그래프

```
Phase 1 ─┬─► Phase 2 ─┬─► Phase 3 ─┬─► Phase 4
         │            │            │
       (L0+L1+L2 최소  (Project+    (KB MCP    (graph consumer +
        +화이트라벨)   core Skill)   consumer    approval+
                                    +A2/A3)     full compliance)
```

Phase N+1은 Phase N의 머지된 산출 위에서만 시작한다. **외부 KB의 가용성은 Phase 3·4의 외부 의존이며, Veluga의 빌드 일정과는 별도 트랙으로 관리된다.**

### 5.2 Phase별 PRD 파일

| 파일 | 내용 |
|---|---|
| `01_Phase1_Foundation.md` | L0 + L1 fork + L2 최소 + system-self-help + 화이트라벨링 5단계 |
| `02_Phase2_Project.md` | Project 재진입 + core Skill 3 (style-card, citation-verifier, docx) |
| `03_Phase3_KB.md` | **외부 KB MCP consumer 어댑터** + A2 Knowledge Gate + A3 Skill Resolver + domain Skill + Policy Guard enforce (KB 구현은 외부) |
| `04_Phase4_Approval.md` | citation-tracer (graph consumer) + compliance-checker full + approval-queue Artifact + Docker sandboxing |

---

## 6. 7개 시스템 에이전트 한눈에

| # | 에이전트 | 트리거 | 핵심 출력 | 도입 Phase |
|---|---|---|---|---|
| A1 | **Intent Router** (+fast-path) | 매 사용자 메시지 | `IntentPlan{ answer_mode, use_kb, suggested_skills }` | Phase 1 |
| A2 | **Knowledge Gate** | A1이 `use_kb=true` | `GateDecision{ allow, reason, alternatives }` — 외부 KB 호출 *전* 차단 | Phase 3 |
| A3 | **Skill Resolver** | A1이 Skill 후보 반환 | `SkillActivationPlan{ ordered_skills }` | Phase 3 |
| A4 | **Policy Guard** | 모든 도구 호출 전 (인터셉터) | `Allow / Deny / RequireApproval` | Phase 1 dry-run → Phase 3 enforce |
| A5 | **Audit Logger** | 백그라운드 모든 이벤트 | append-only SQLite | Phase 1 |
| A6 | **General Planner** | A1이 `answer_mode=general` | `GeneralPlan{ confidence, steps, escalate? }` | Phase 1 |
| A7 | **General Responder** | A6 plan 수신 | 신뢰도 태그 부착 답변 | Phase 1 |

> 어느 에이전트도 KB 인덱스·임베딩·ingest를 만들지 않는다. A2/A3 및 KB consumer Skill만 외부 KB MCP/API 응답을 *소비*한다.

자세한 명세는 각 Phase PRD 본문 참조.

---

## 7. 신뢰도 태그 4단계 (결재 인용 자격 표)

| 태그 | 의미 | 결재 본문 인용 자격 |
|---|---|---|
| `[src:<id>\|kb\|as_of:<date>]` | 기관 KB 인용 | ✅ 정식 근거 |
| `[src:<id>\|nb]` | Project 자료 인용 | ⚠️ 참고자료 섹션만 |
| `[parametric:high]` | LLM 일반 지식, 보편 상식 | ❌ 결재 본문 금지 |
| `[parametric:low]` | LLM 일반 지식, 검증 필요 | ❌ 결재 본문 금지 |

**3중 환각 방지 안전망**:
1. A6 confidence 평가 (사전)
2. A7 신뢰도 태그 강제 (실시간)
3. compliance-checker Skill의 parametric 차단 (사후, Phase 4)

---

## 8. Glossary

| 용어 | 정의 |
|---|---|
| **Open Cowork** | OpenCoworkAI/open-cowork. Electron + React 19 + Tailwind + SQLite + MCP 기반 MIT 오픈소스. Veluga의 L1 골격. |
| **Kuse Cowork** | kuse-ai/kuse_cowork. 외부 명령 실행을 Docker에 격리하는 변종. **벤치마킹용 참조**(fork 아님). |
| **PolicyContext** | 로그인 시 사전 로딩되어 세션 내 인메모리로 박히는 권한·정책·가용 리소스 카탈로그. |
| **Project** | Cowork Project = NotebookLM 컨테이너. 폴더 단위 자료·정책·Skill set·재진입 요약. |
| **Skill** | `SKILL.md` + 코드. 동적 로딩 능력 plug-in. core/domain/format/user 4 영역. |
| **MCP** | Model Context Protocol. 외부 도구·서버 연결 표준. **외부 기관 KB**는 별도 MCP 서버로 제공되며 Veluga는 consumer. |
| **외부 KB** | 기관이 제공하는 법령·가이드·정책 검색 시스템. Vector DB·RDB·Graph·임베딩·ingest 등 모든 구현은 외부 운영 주체 책임. Veluga는 MCP/API consumer로만 결합. |
| **KbMcpAdapter** | 외부 KB MCP/API를 Cowork connector로 등록·헬스체크·재시도·redact하는 Veluga측 어댑터. KB 서버 자체를 spawn하거나 데이터를 소유하지 않는다. |
| **Artifact** | Cowork의 라이브 영구 페이지. `approval-queue` 등 도메인 Artifact 정의 가능. |
| **신뢰도 태그** | `[src:_\|kb]`, `[src:_\|nb]`, `[parametric:high]`, `[parametric:low]`. 결재 인용 자격의 단일 진실. |
| **Veluga Mode** | `enable_veluga_orchestration` 토글. ON 시 Veluga 미들웨어 활성, OFF 시 Open Cowork 원본 회귀. |
| **White-out** | 폐쇄망용 외부 통신 제거 작업 (텔레메트리, 외부 API URL, 자동 업데이트). |
| **clearance** | 사용자 보안 등급. `public < internal < confidential < secret`. |
| **scope** | KB 자료 분류 식별자. 예: `law:public`, `audit:confidential`. 외부 KB가 정의·관리. |

---

## 9. 글로벌 결정 로그

| 결정 | 사유 |
|---|---|
| Open Cowork fork (vs from scratch) | 설계안 v1.2 L1 명세와 100% 일치, "안 만들기" 원칙 |
| Open Cowork **MIT 라이선스** 확정 | 화이트라벨링·상업 판매 완전 허용. 의무는 Credits 페이지 1개. |
| Kuse Cowork는 fork 아닌 벤치마킹 | 보안 패턴만 필요, 본체는 Open Cowork가 우월 |
| **기관 KB는 외부 시스템 — Veluga는 MCP/API consumer만** | "안 만들기" 원칙, 운영 책임 분리, 권한 이중 방어 (Veluga측 Gate + 외부 KB측 권한 검증) |
| Veluga Mode Feature Toggle Phase 1부터 | 회귀 안전망, 점진적 도입 |
| Phase 1에 General Planner/Responder 포함 | 빈 시스템에서 막막함 회피 + 신뢰도 태그 인프라 선구축 |
| Project tier를 5-tier 정책에 추가 | 사용성 점검 G9, 컨텍스트 무결성 |
| `approval-queue`는 Artifact (세션 아님) | P3 결재자 다중 세션 회피 |
| `last_session_summary`는 Audit Logger 부수효과 | 별도 에이전트 추가 회피 |
| 화이트라벨링 자산 `src/veluga-ui/` 별도 폴더 분리 | upstream 보안 패치 머지 안전 |
| 외부 텔레메트리 전수 제거 (Vercel/PostHog/Sentry 등) | 보안 감사 통과 / 공공·금융 납품 가능성 |
| Phase 1에 자동 업데이트 비활성화 (옵션 A) | 가장 안전. 사내 패치 서버는 운영 안정 후 검토 |
| Policy Guard Phase 1~2 dry-run → Phase 3+ enforce | 정책 누락 우회 회피 + 사용자 학습 곡선 |

신규 결정은 `99_Appendix.md`의 결정 로그에 누적.

---

## 10. AI Coding Agent 작업 시작 전 체크리스트

다음을 확인하지 않고 Phase 코드 작업에 들어가지 않는다:

- [ ] `00_Overview.md`(이 문서) 5대 원칙 숙지
- [ ] `99_Appendix.md` 공유 스키마(PolicyContext, IntentPlan, Audit) 시그니처 확인
- [ ] `98_Gap_Analysis.md` 본인 Phase 관련 미해결 항목 — PM에 합의 요청 후 진행
- [ ] 본인 Phase PRD (`0X_PhaseN_*.md`) 전 섹션 정독
- [ ] 이전 Phase 산출 머지 상태 확인 (Phase 2+의 경우)
- [ ] CI 보호 룰 활성 확인 (`packages/cowork-core/` protected)

---

## 11. 한 줄 결론

> *L1은 Open Cowork fork로 무료로 얻고 Veluga로 화이트라벨링한다. Veluga가 만들 코드는 **L0 정책·L2 7개 에이전트·L4 Skill** — 이 셋에 집중. L3 기관 KB는 외부 의존(MCP/API consumer)이며 본 PRD 범위 밖이다. Veluga Mode 토글로 점진적·안전하게 도입한다.*
