# 02 — 갭 분석

> 상위 인덱스: [README.md](README.md) · 이전: [01-background-research.md](01-background-research.md) · 다음: [03-architecture.md](03-architecture.md)
> Status: **📝 구현 전 갭 분석 계획** · 2026-06-03

**목표**: [00-overview.md](00-overview.md)의 목표 상태와 현재 코드 사이의 차이를 파일 단위로 정리하고, 각 gap을 어느 Phase에서 닫을지 결정한다.

**완료 정의(DoD)**: Phase 1에서 반드시 닫을 gap, Phase 2에서 닫을 마켓플레이스 gap, Phase 3에서 효과 입증 후 닫을 동적성 gap이 분리된다. 미확정 결정은 구현 항목으로 섞지 않는다.

---

## 1. 핵심 gap 표

| 영역 | 현재 상태 | 목표 상태 | 처리 단계 |
|---|---|---|---|
| 런타임 primitive | [agent-runner.ts](../../../packages/cowork-core/src/main/claude/agent-runner.ts)는 단일 `PiAgentSession` 생성/재사용 중심. `customTools`는 있지만 네이티브 자식 세션 primitive 없음 | 모델이 호출 가능한 `spawn_agent` 도구가 부모 세션에 노출되고, 자식 `PiAgentSession`을 제한된 persona/toolScope/budget으로 실행 | Phase 1 |
| 세션 생성 재사용성 | 모델/도구/리소스 로더/게이트웨이/스트리밍 결선이 런너 내부에 집중 | 부모/자식 세션 생성이 같은 안전 경로를 쓰도록 런너 내부 helper로 추출 | Phase 1 |
| IPC 실행 옵션 | `session.continue` payload는 `prompt`/`content` 중심 | `executionMode: 'default' | 'deep_agent'` 같은 실행 옵션이 renderer→main→runner로 전달 | Phase 1 |
| shared-types | `BoundedSubSessionRequest`는 `id/objective/boundaries/tokenBudget`만 보유 | `persona`, `systemPrefix`, `toolScope`, `parentSessionId`, `depth`, `outputContract`, `policyContextRef` 추가 | Phase 1 |
| 예산/깊이 가드 | `BoundedSubSessionRunner`는 세션 수와 합산 토큰 중심 | depth, parent-child lineage, per-child budget, total budget, max concurrent child 세션 강제 | Phase 1 |
| 정책 스코프 | [tool-interceptor.ts](../../../packages/veluga-main/src/tool-interceptor.ts)는 기존 도구 호출 정책 집행 | 자식 세션 도구 목록이 정책 화이트리스트와 persona toolScope의 교집합으로만 구성 | Phase 1 |
| UI 모드 | 입력창에 딥 에이전트 실행 모드 없음 | 정책 허용 시 `기본`/`딥 에이전트` segmented control 노출 | Phase 1 |
| 자식 활동 표시 | trace/message는 부모 세션 중심 | 자식 세션 시작/도구/완료/실패를 접을 수 있는 활동 패널 또는 trace group으로 표시 | Phase 1 |
| 체크포인트 | 오케스트레이션 checkpoint는 작업 plan 중심 | 자식 세션 lineage, 상태, token usage, final artifact summary 저장 | Phase 1 |
| 플러그인 agents | `agents` component count/materialize는 가능하지만 persona registry가 없음 | 활성화된 `agents/*.md`를 `SubAgentPersona`로 변환하고 runtime pool에 등록 | Phase 2 |
| 카탈로그/설치 | 기존 서비스는 공개 카탈로그/Claude CLI 경로를 포함할 수 있음 | Veluga 자체 카탈로그, 내부 번들/디렉터리 설치, 외부 송신 0 | Phase 2 |
| 가드레일 스크럽 | 플러그인 설치물의 외부 호출/트레이서 검사 계약 없음 | 설치 전후 직접 LLM endpoint, SaaS telemetry, network tracer, hooks 위험 요소 검사 | Phase 2 |
| 검토 패턴 | Producer-Reviewer/Supervisor가 실행 primitive로 표현되지 않음 | persona pool과 `spawn_agent` 체인을 이용한 검토 게이트/재계획 가드 | Phase 3 |

---

## 2. Phase 1에서 반드시 닫을 gap

- [ ] `spawn_agent` 도구가 없는 gap. 모델이 직접 위임할 정식 경로가 없으면 Deep Agent Mode가 성립하지 않는다.
- [ ] 자식 세션이 부모 런너의 게이트웨이/도구 래핑/스트리밍/감사 경로를 벗어날 위험. 런너 내부 helper를 추출해 같은 경로를 재사용해야 한다.
- [ ] 실행 모드 전달 gap. 모드를 `ContentBlock` 텍스트에 섞지 말고 IPC payload의 명시 옵션으로 전달한다.
- [ ] 타입 gap. `BoundedSubSessionRequest` 확장 없이 persona/toolScope/depth/outputContract를 안전하게 전달할 수 없다.
- [ ] kill switch gap. `policy.veluga.deep_agent.enabled=false`에서 UI와 런타임 모두 기존 단일 세션 패리티가 필요하다.
- [ ] 자식 활동 관측 gap. 사용자가 자식 세션 진행을 볼 수 있어야 취소/실패/예산 초과를 이해할 수 있다.

---

## 3. Phase 2로 미루는 gap

- [ ] harness/harness-100 대량 이식. 이번 기능의 전제는 직접 이식이 아니라 수용 계약이다.
- [ ] Veluga 자체 카탈로그 호스팅. Phase 1은 설치 없이 기본 generic subagent가 동작해야 하므로 카탈로그가 선결이 아니다.
- [ ] `agents/*.md` persona registry. Phase 1은 내장 generic persona만으로 구현하고, 활성화된 플러그인 persona는 Phase 2에서 추가한다.
- [ ] 플러그인 스크럽 검사기. Phase 2 설치 파이프라인에 넣되 Phase 1 런타임 primitive와 분리한다.

---

## 4. Phase 3로 미루는 gap

- [ ] Producer-Reviewer 자동 재시도/반려 정책.
- [ ] Supervisor 동적 재계획과 조건부 추가 위임.
- [ ] Hierarchical Delegation의 깊은 재귀. Phase 1은 conservative default로 1단계 또는 매우 낮은 depth만 허용한다.
- [ ] A/B 효과 측정 기반 default-ON 판단.

---

## 5. 미확정 결정과 기본 제안

| 결정 | 기본 제안 | 이유 |
|---|---|---|
| `spawn_agent` 노출 범위 | 정책 허용 + 사용자가 `딥 에이전트` 선택한 turn에서만 | 기본 단일 세션 회귀 위험 최소화 |
| 모드 적용 단위 | 메시지별 payload 옵션 | 같은 세션에서 task 성격별로 전환 가능, 저장 스키마 변경 최소화 |
| 기본 depth | 1 | Phase 1에서 무제한 재귀 금지. Phase 3에서 입증 후 확대 |
| 기본 maxSubSessions | 3 | Fan-out 유용성을 남기되 게이트웨이/비용 폭주 억제 |
| 기본 total token budget | 정책값 우선, 없으면 보수적 상한 | 기관/배포 프로파일 차이를 정책으로 흡수 |
| 기본 persona | 내장 `general_subagent` | 마켓 설치 없이 기본 가용 목표 충족 |
| 자식 toolScope | 부모 허용 도구 ∩ 정책 화이트리스트 ∩ 요청 toolScope | persona 권한 확대 금지 |
| 카탈로그 source | Veluga 자체 manifest 또는 오프라인 bundle | 화이트아웃·폐쇄망 유지 |

---

## 6. 구현 순서 영향

1. Phase 1은 타입/IPC/런너 primitive/가드/UI/검증을 한 묶음으로 구현한다. primitive만 있고 UI나 budget guard가 없으면 완료로 보지 않는다.
2. Phase 2는 플러그인 런타임 보강이다. Phase 1의 `SubAgentPersona` contract를 변경하지 않고 persona provider만 추가한다.
3. Phase 3은 제품 효과를 확인하는 단계다. 패턴 라이브러리와 reviewer gate를 추가하되, Phase 1의 기본 generic 위임 경로는 유지한다.

---

## 리스크 / 주의

- `PluginRuntimeService.install()`의 공개 카탈로그/CLI 의존은 Deep Agent Mode 수용 경로에서 그대로 쓰면 안 된다. Phase 2에서 명시적으로 대체한다.
- shared-types 확장은 Veluga 소유지만 cowork-core renderer/main 타입과도 맞물린다. 배럴 export와 import 경로를 함께 확인한다.
- UI 모드는 설정 저장값이 아니라 turn execution option으로 시작한다. 영속 설정은 default-ON 정책이 확정될 때 별도 검토한다.
