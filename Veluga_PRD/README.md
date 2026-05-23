# Veluga Agents — PRD 작업 폴더

> 본 폴더는 Veluga Agents (Open Cowork fork 기반, 폐쇄망 공공/금융 에이전틱 업무 시스템) 빌드를 위한 PRD 세트다. AI coding agent(Claude Code / Codex)가 Phase 단위로 픽업하여 작업할 수 있도록 분할되어 있다.
>
> **범위 선언 (v1.1)**: 본 PRD 세트는 **에이전트 시스템 자체**에만 집중한다. 기관 KB(Vector DB·RDB·Graph·임베딩·ingest·운영) 구현은 **외부 시스템**이며 본 PRD 범위 밖이다. Veluga는 외부 KB를 **MCP 또는 API의 consumer**로만 결합한다.

## 폴더 구성

```
Veluga_PRD/
├── README.md                       # 이 파일 (작업 가이드)
├── 00_Overview.md                  # 전체 미션 · 5대 원칙 · 아키텍처 · 페르소나
├── 01_Phase1_Foundation.md         # Phase 1 — 권한 있는 일반 챗봇 + 화이트라벨링
├── 02_Phase2_Project.md            # Phase 2 — NotebookLM Lite
├── 03_Phase3_KB.md                 # Phase 3 — 외부 KB MCP consumer + A2/A3
├── 04_Phase4_Approval.md           # Phase 4 — 결재 라인 진입 (citation-tracer = graph consumer)
├── 98_Gap_Analysis.md              # 누락·미해결 항목 점검 보고서 (PM 합의 필요)
└── 99_Appendix.md                  # 공유 스키마 · 디렉터리 · 결정 로그 · 카탈로그
```

## 읽는 순서 (AI agent 기준)

1. **`00_Overview.md`** — 항상 먼저. 미션·원칙·아키텍처·페르소나 한 번에 파악.
2. **`99_Appendix.md`** — 공유 스키마(PolicyContext, IntentPlan, Audit)와 디렉터리 구조. 작업 중 수시 참조.
3. **`98_Gap_Analysis.md`** — 빌드 시작 전 PM과 합의해야 할 항목 확인 (LLM 게이트웨이 명세, 코드 서명 등).
4. **`0X_PhaseN_*.md`** — 작업 중인 Phase 한 개만 픽업. **이전 Phase 산출이 머지된 상태**에서 시작한다.

## PRD 완성 기준

본 폴더는 2026-05-23 기준 **구현 착수 가능한 PRD 완성본**으로 정리되어 있다.

- `00_Overview.md`는 미션, Non-goal, 5대 원칙, Phase 의존성, 페르소나, 용어를 정의한다.
- `01`~`04` Phase PRD는 각 Phase별 Scope, Acceptance Criteria, 구현 명세, 데이터 흐름, 테스트 전략, 위험, 작업 순서, DoD를 포함한다.
- `01_Phase1_Foundation.md`~`04_Phase4_Approval.md`는 각 문서의 `PRD 완료 상태` 섹션에서 문서 완료 판정과 구현 검증 근거를 별도 명시한다. 외부 KB·결재시스템·운영 SLA처럼 Veluga가 소유하지 않는 항목은 구현 완료 후에도 `98_Gap_Analysis.md`의 운영 게이트로 추적한다.
- `99_Appendix.md`는 공유 타입, LLM Gateway, 외부 KB consumer contract, SQLite 스키마, 디렉터리 구조, 테스트 카탈로그를 포함한다.
- `98_Gap_Analysis.md`는 코드 작업 전 PM·보안·인프라·외부 KB 운영 주체와 합의해야 할 결정 항목을 추적한다. Gap은 PRD 미완성이 아니라 **의도적으로 남긴 의사결정 게이트**다.

## 작성 원칙 (이 PRD 세트가 따르는 규칙)

- **상위 문서 우선순위**: `오픈소스 이용한 방향.md` > `veluga_agentic_system_design.md v1.2` > `veluga_usability_review.md`.
- **수정 금지 영역**: Phase PRD는 절대 `Overview`의 5대 빌드 원칙을 위배하지 않는다. 위배 발견 시 PRD를 고치는 것이 아니라 `98_Gap_Analysis.md`에 이슈로 올린다.
- **각 Phase는 자기완결**: 한 Phase PRD에 그 Phase 빌드에 필요한 모든 Acceptance Criteria·작업 단계·테스트 케이스가 들어 있다. Overview/Appendix는 참조만.
- **결정 로그**: Phase 진행 중 새로 확정된 결정은 `99_Appendix.md`의 결정 로그에 추가한다.

## 한 줄 미션

> *Cowork(open source)가 골격을 주고, Skill이 능력을 주고, 정책이 권한을 주고, 시스템 에이전트 7개가 결정만 한다. **KB는 외부에서 빌려 쓴다.***

## 입력 문서 (이 PRD가 통합한 원본)

- `../veluga_agentic_system_design.md` v1.2 — 시스템 설계안
- `../veluga_usability_review.md` — 사용성 점검 (페르소나·시나리오)
- `../오픈소스 이용한 방향.md` — 오픈소스 활용 전략
- `../Veluga_PRD_v1.0.md` — 단일 파일 PRD (이 폴더의 통합 원본, **v1.1부터 deprecated** — KB 분리 정리는 본 폴더에만 적용됨)

## 버전

- v1.0 (2026-05-23) — 폴더 분할 초판
- v1.1 (2026-05-23) — **기관 KB 구현 분리**: KB 자체는 외부 시스템으로 범위 외 선언. Veluga는 MCP/API consumer만 책임. Phase 3·4·Overview·Appendix·Gap Analysis 일괄 정리.
- v1.2 (2026-05-23) — PRD 완성 점검: Phase 2/3 KB consumer 표현 정합성, Phase 4 작업 순서, Gap Analysis 우선순위 카운트, 완성 기준 문구 정리.
- v1.3 (2026-05-23) — Phase 1/2 문서 완료 상태 명시: 구현 AC 체크박스와 PRD 완료 판정을 분리하고, 각 문서에 구현 착수 전 필수 확인 항목 추가.
- v1.4 (2026-05-23) — **Phase 1·2 구현 완료 반영**: AC/DoD 체크박스 전수 완료 처리, 문서 상태 "구현 완료"로 갱신, Overview Phase 표에 상태 컬럼 추가, Gap Analysis Phase 1·2 항목 RESOLVED 처리.
- v1.5 (2026-05-23) — **Phase 3·4 구현 완료 반영**: KB consumer, approval line, compliance full, sandbox, seal 검증 결과를 Phase 문서·Overview·Gap Analysis·Appendix 결정 로그에 반영. 외부 KB SLA, 실제 결재시스템 어댑터, 코드 서명 등 운영 항목은 별도 미해결 Gap으로 유지.
