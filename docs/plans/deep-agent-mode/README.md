# Deep Agent Mode (딥 에이전트 모드) — 설계·구현 계획

> Status: **📝 계획 초안 (Overview, rev.2)** · 작성 2026-06-03
> Scope: 입력창에서 사용자가 선택하는 **멀티에이전트 실행 모드**. [harness](https://github.com/revfactory/harness) / [harness-100](https://github.com/revfactory/harness-100)의 "다중 전문가 협업 팀" 패턴을 Veluga가 수용 가능하게 한다.
> 확정 결정(rev.2): **① 코어 선택 수정 — 네이티브 서브에이전트 primitive(`spawn_agent`)** · **② 기존 `agent-orchestration` 위에 정책·예산·내구성 가드로 확장** · **③ 하네스 = 마켓플레이스/활성화 기반(직접 이식 아님)** · **④ 멀티에이전트 기본 가용을 1순위 목표로**

이 폴더는 **개요(Overview)** 단계 산출물이다. 상세 구현은 후속 문서(`10-*` …)에서 단계적으로 작성한다.

---

## rev.1 → rev.2 핵심 변경

| 항목 | rev.1 | **rev.2** | 이유 |
|---|---|---|---|
| 엔진 | Hooks 전용(코어 비수정) | **코어 선택 수정 — 네이티브 primitive** | 비수정 원칙 해제 + upstream에 서브에이전트 primitive 부재 → 직접 추가가 더 효과적 |
| 하네스 | 스킬 즉시 이식 + 번역 | **마켓플레이스/활성화 기반** | 사용자가 켠 것만 로드. Cowork 기존 플러그인 인프라 재사용 |
| 목표 | 모드 동작 | **멀티에이전트 기본 가용** | 설치 없이도 위임 가능, 저마찰 |

---

## 왜 별도 계획인가

기존 [`agent-orchestration/`](../agent-orchestration/README.md)은 **단일 cowork 세션**에 컨텍스트를 넣는 **veluga-side I/O 워커**(LLM 아님)다. harness가 요구하는 건 그 위 — **여러 LLM 전문가가 역할을 나눠 협업**하는 구조. 조사 결과 upstream SDK엔 서브에이전트 primitive가 없어, Deep Agent Mode는 **코어에 절제된 `spawn_agent` primitive를 추가**하고 기존 오케스트레이션 인프라(예산·체크포인트·FSM·감사)로 **감싸서** 이 격차를 메운다.

---

## 문서 구성 (읽는 순서)

| # | 문서 | 내용 | 상태 |
|---|---|---|---|
| 00 | [개요 (Overview)](00-overview.md) | 목적·범위·확정결정·불변식/해제구분·엔진결정·하네스 마켓수용·6패턴·토폴로지·모드UX·로드맵·성공기준·변경이력 | 📝 본 단계 |
| 01 | 배경 & 조사 (예정) | upstream `pi-coding-agent` primitive 부재 정밀 확인, harness 6패턴·plugin 컴포넌트(agents/skills) 구조 분석 | ⏳ 후속 |
| 02 | 갭 분석 (예정) | 코어 수정 표면·타입 격차·마켓 카탈로그 화이트아웃 대체 지점 | ⏳ 후속 |
| 03 | 아키텍처 (예정) | `spawn_agent` 시그니처·persona contract·자식세션 스트리밍·예산/깊이/취소 전파 상세 | ⏳ 후속 |
| 10 | Phase 1 — 네이티브 primitive + 기본 가용 (예정) | agent-runner 절제 수정, 모드 셀렉터, 자식세션 UI, veluga 가드 결선 | ⏳ 후속 |
| 11 | Phase 2 — 마켓플레이스 수용 (예정) | Veluga 자체 카탈로그·설치 경로, 활성화 게이팅, agents→persona 번역, 스크럽 | ⏳ 후속 |
| 12 | Phase 3 — 검토 패턴·동적성 (예정) | Producer-Reviewer/Supervisor 게이트, 효과 입증 시 동적 위임 | ⏳ 후속 |
| 20 | 검증 (예정) | 모드 OFF 패리티·E2E·관측성·예산/깊이 가드·게이트웨이/화이트아웃 회귀 | ⏳ 후속 |

---

## 핵심 전제 (불변식 — 코어를 고쳐도 우회 불가)

> "Open Cowork 본체 비수정" 원칙은 **해제**되었다. 그러나 아래 보안·거버넌스 불변식은 **여전히 비협상**이며 서브에이전트/자식 세션에도 동일 적용된다. (해제/불변식 구분 표는 [00-overview.md §불변식 vs 해제된 제약](00-overview.md#불변식-vs-해제된-제약-중요).)

1. **게이트웨이 경유** — 모든 LLM(자식 세션 포함)은 `VELUGA_LLM_GATEWAY_URL`만. 공개 엔드포인트 하드코딩 금지(CI 강제).
2. **화이트아웃·텔레메트리 0** — 마켓 카탈로그/설치도 외부 송신 0. `claude.com/plugins` 공개 카탈로그·`claude plugin install` CLI 셸아웃은 **Veluga 자체 경로로 대체**.
3. **정책 우선** — persona가 권한 확대 불가. 자식 tool 스코프 ⊆ 정책 화이트리스트([tool-interceptor](../../../packages/veluga-main/src/tool-interceptor.ts)).
4. **감사·신뢰도 태그·컴플라이언스** — 자식 세션 산출도 audit·`compliance-checker`·태그 통과.
5. **`node:sqlite`·`server-event`·킬스위치** — 신규 플래그(예: `policy.veluga.deep_agent.enabled`) OFF 시 기존 동작 패리티. `enable_veluga_orchestration=true` 전제.

> 상위 제약은 [docs/README.md](../../README.md)의 문서 맵에 따라 `reference/`와 활성 계획을 기준으로 확인한다. 오케스트레이션 상속분은 [agent-orchestration/00-overview.md](../agent-orchestration/00-overview.md) 참조.

---

## 다음 단계

1. 본 Overview(rev.2) 검토·승인 — 특히 **엔진 반전(코어에 `spawn_agent` 추가)** 과 **마켓플레이스 수용** 방향 확인.
2. 승인 후 `01`(배경)·`02`(갭)·`03`(아키텍처) → `10`부터 단계별 상세.
3. 상세 확정 전 코드 변경 없음. 미결 항목은 [00-overview.md §미해결 및 후속 결정](00-overview.md#미해결-및-후속-결정).
