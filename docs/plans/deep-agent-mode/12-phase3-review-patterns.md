# 12 — Phase 3: 검토 패턴·동적성

> 상위 인덱스: [README.md](README.md) · 이전: [11-phase2-marketplace-intake.md](11-phase2-marketplace-intake.md) · 다음: [20-verification.md](20-verification.md)
> Status: **📝 구현 계획** · 2026-06-03

**목표**: Phase 1의 `spawn_agent` primitive와 Phase 2의 persona registry 위에서 Producer-Reviewer, Supervisor, bounded hierarchical delegation 같은 고급 패턴을 검증된 범위로 추가한다.

**전제**: 기본 딥 에이전트 모드는 이미 설치 없이 동작하며, 활성화된 plugin persona를 선택적으로 사용할 수 있다. Phase 3는 품질·안전 효과를 측정한 뒤 default 확대 여부를 판단하는 단계다.

**완료 정의(DoD)**: Producer-Reviewer와 Supervisor 패턴이 정책/예산/깊이 상한 안에서 동작하고, reviewer 반려·재시도·HITL 결합이 audit/checkpoint에 남으며, A/B 평가에서 기본 단일 세션 대비 개선 또는 미개선이 판단 가능하다.

---

## 1. 패턴 라이브러리 contract

신규 대상 예시: `packages/veluga-main/src/orchestrator/deep-agent-patterns.ts`

- [ ] 패턴은 새 "시스템 에이전트"가 아니라 `spawn_agent` 호출 계획을 만드는 lightweight contract로 정의한다.
- [ ] 지원 패턴은 처음에 `producer_reviewer`, `supervisor`, `fanout_summarize` 세 가지로 제한한다.
- [ ] 각 패턴은 required persona role, maxSubSessions, maxDepth, maxReplans, outputContract를 선언한다.
- [ ] 정책이 패턴을 deny하면 generic single subagent 또는 default mode로 degrade한다.

**수용 기준**: 패턴 추가가 7 system agents 고정 파이프라인을 변경하지 않는다.

---

## 2. Producer-Reviewer 게이트

흐름:

```text
parent
  -> spawn_agent(producer, objective)
  -> spawn_agent(reviewer, objective + producer result)
  -> reviewer pass: parent final synthesis
  -> reviewer fail: bounded retry or HITL/parent conservative response
```

- [ ] reviewer output contract는 `review_verdict`로 고정한다.
- [ ] verdict는 `pass | revise | reject`와 reasons, policy concerns, missing citations를 포함한다.
- [ ] 자동 재시도는 기본 1회로 제한한다.
- [ ] `reject` 또는 approval-required verdict는 [approval-queue](../../../packages/veluga-main/src/approval/approval-queue.ts)와 결합 가능한 event로 변환한다.
- [ ] 모든 producer/reviewer result hash를 checkpoint에 남긴다.

**수용 기준**: reviewer가 citation/tag 부족을 지적하면 parent가 그대로 최종 답변하지 않는다.

---

## 3. Supervisor bounded replanning

- [ ] Supervisor는 부모 모델이 담당한다. 별도 무제한 supervisor agent를 만들지 않는다.
- [ ] parent가 `spawn_agent` 결과를 보고 추가 위임할 수 있지만 `maxReplans`를 넘으면 중단한다.
- [ ] 기존 [DynamicWorkPlan](../../../packages/shared-types/src/intent.ts)의 `conditionalEdges` 개념을 재사용하되, LLM 자식 세션에는 depth/session/token 상한을 추가 적용한다.
- [ ] replanning event는 `deep_agent.replan.requested/completed/denied`로 audit에 남긴다.

**수용 기준**: 모델이 무한히 자식 세션을 만들 수 없고, maxReplans 초과 시 명확한 tool error를 받는다.

---

## 4. Fan-out/Fan-in 요약 패턴

- [ ] 여러 독립 범위를 동시에 분석할 때 bounded 병렬 `spawn_agent`를 허용한다.
- [ ] fan-out 크기는 `maxSubSessions` 이하로 강제한다.
- [ ] fan-in은 parent가 수행하되, 각 child result의 citation/token/status를 유지한다.
- [ ] 일부 optional child 실패는 전체 실패로 처리하지 않고 parent에게 degraded result로 반환한다.

**수용 기준**: 3개 이하 병렬 자식 세션의 부분 실패가 구조화되어 parent synthesis에 반영된다.

---

## 5. HITL 결합

- [ ] reviewer가 `requires_approval` verdict를 낸 경우 승인 큐 payload에 producer result hash, reviewer result hash, proposed action을 포함한다.
- [ ] 승인 후 재개 시 payload hash drift를 검사한다.
- [ ] 사용자가 반려하면 parent는 child retry를 하지 않고 보수적 응답 또는 질문으로 마무리한다.

**수용 기준**: approval payload 변조 시 실행이 거부되고 audit에 남는다.

---

## 6. 효과 측정

평가 대상:

- 복합 코드 분석
- 정책/KB/파일 혼합 질의
- 장문 요약 + 검토
- 불충분 근거를 가진 답변 방지

측정 항목:

- task success/pass rate
- citation/tag completeness
- policy violation count
- total tokens / latency
- reviewer rejection rate
- user-visible failure/degrade rate

작업:

- [ ] 단일 세션 baseline과 deep agent pattern run을 같은 fixture로 비교한다.
- [ ] A/B 결과가 없으면 default-ON 결정을 하지 않는다.
- [ ] 비용/latency가 큰 패턴은 수동 선택 또는 정책 allowlist로 제한한다.

---

## 7. 테스트

- [ ] producer pass → reviewer pass → final synthesis.
- [ ] producer result missing citations → reviewer revise/reject.
- [ ] retry 1회 초과 시 중단.
- [ ] supervisor maxReplans 초과 거부.
- [ ] fan-out partial failure degrade.
- [ ] HITL payload hash drift 거부.
- [ ] pattern deny 시 default/generic fallback.

---

## 리스크 / 주의

- Phase 3는 기능 확장이 아니라 효과 입증 단계다. 품질 개선이 증명되지 않으면 default-ON 또는 깊이 확대를 하지 않는다.
- reviewer도 persona일 뿐 정책 권한을 넓히지 않는다.
- 패턴 prompt가 복잡해져도 최종 사용자에게 UI 설명문을 늘리지 않는다. 상태와 결과만 간결히 보여준다.
