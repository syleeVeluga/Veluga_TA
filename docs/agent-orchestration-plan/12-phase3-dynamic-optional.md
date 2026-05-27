# 12 — Phase 3: 선택적 동적성 (조건부)

> 상위 인덱스: [README.md](README.md) · 이전: [11-phase2-durability-hitl.md](11-phase2-durability-hitl.md) · 검증: [20-verification.md](20-verification.md)

**✅ 구현 완료** (2026-05-28, 플래그 default OFF). 검증: [tests/phase3/phase3-dynamic-optional.test.ts](../../tests/phase3/phase3-dynamic-optional.test.ts).
산출물: [sub-session.ts](../../packages/veluga-main/src/orchestrator/sub-session.ts) · [worker-scope.ts](../../packages/veluga-main/src/orchestrator/worker-scope.ts) · [orchestrator.ts](../../packages/veluga-main/src/orchestrator/orchestrator.ts) · [planner.ts](../../packages/veluga-main/src/orchestrator/planner.ts) · [ipc-middleware.ts](../../packages/veluga-main/src/ipc-middleware.ts) · [policy-service/merge.ts](../../packages/policy-service/src/merge.ts) · [shared-types/policy.ts](../../packages/shared-types/src/policy.ts).
**결선 상태**: §1(조건부 엣지)은 라이브 경로에 결선(`dynamic_orchestration.conditional_edges`, default OFF). §2(bounded sub-session)·§3(동적 DAG)은 엔진/검증 + 테스트 완료, 라이브 요청 경로 결선 및 A/B 효과 측정은 운영 데이터 확보 후. 전 기능 플래그 default OFF — 킬스위치로 Phase 2 동작 복귀.

**원칙(Anthropic)**: *"복잡도는 결과를 입증 가능하게 개선할 때만 추가한다."* 이 단계는 **Phase 1/2 운영 데이터로 효과가 입증된 경우에만** 착수한다. 기본은 보류.

**전제 게이트(아래 중 하나 이상 충족 시에만 진행)**

- 정적 그래프로는 해결 못 하는 반복 패턴이 운영 로그에서 관측됨.
- 단일 cowork 세션 생성이 특정 작업에서 병목/품질 한계로 측정됨.
- 사용자/도메인 요구가 명확한 동적 분기를 요구.

---

## 1. 조건부 엣지 확장 (저위험)

- [x] 정적 그래프에 **조건부 엣지**를 추가(LangGraph 차용): 워커 결과 상태에 따라 후속 워커를 동적 선택(예: KB 결과 부족 시 file-analysis 범위 확대).
- [x] 엣지 조건은 **순수 함수(상태→다음)** 로 구현, LLM 자유 생성 토폴로지는 아직 도입하지 않음.
- [x] 재계획 전이 `RUNNING_PARALLEL → PLANNING` 활용(부분 실패/근거 부족 후 1회 재계획, 무한 루프는 스텝 예산으로 차단).
- **수용 기준**: 재계획이 스텝/토큰 예산 내에서 종료. 사이클 검증 유지.

---

## 2. Bounded 병렬 LLM sub-session (중위험)

진짜 병렬 생성이 입증된 경우에만:

- [x] cowork `AgentRuntimeExtension`로 **경계가 명확한 sub-session**만 기동(개수 상한, 토큰 예산 분할, 명시적 objective/boundaries).
- [x] sub-session 결과는 **요약만** 부모로 반환(컨텍스트 격리, Claude Agent SDK 모델).
- [x] 비용 가드 강화: 멀티에이전트 ~15× 토큰을 감안한 하드 상한 + 효과 측정(A/B). ⏳ 하드 상한(개수/토큰)은 구현·테스트 완료, **A/B 효과 측정은 운영 데이터 확보 후**.
- [x] 워커 간 비통신 원칙 유지(모든 조정은 오케스트레이터).
- **수용 기준**: sub-session 수/토큰 하드 상한 강제. 비활성 시 Phase 1 동작과 동일.

---

## 3. 동적 DAG (고위험 — 마지막 수단)

- [x] LLM이 토폴로지를 생성하는 경우에도 **반드시** `validate()`(사이클/누락/`toolScope` 검증)를 통과해야 실행.
- [x] 생성 plan은 정책 화이트리스트로 sanitize, 신뢰도 낮으면 정적 폴백.
- [x] 관측성/예산/체크포인트는 Phase 1/2 그대로 적용.
- **주의**: 신뢰성·비용 리스크가 크므로 강한 평가(eval) 통과 전까지 프로덕션 기본값 OFF.

---

## 4. 보류/후속 검토 항목

- 부분 부작용 **보상(saga) 패턴**(현재는 멱등 키로 중복 방지만).
- 연결망 전용 **managed durable execution**(Temporal Cloud 등) — 데스크톱/게이트웨이 제약상 현재는 로컬 `node:sqlite` 유지.
- self-hosted OTLP 외부 트레이싱(연결망, egress 허용목록) 정식화.

---

## 5. 롤백 전략

- 모든 Phase 3 기능은 정책/플래그로 **기본 OFF**. 문제가 관측되면 플래그만 끄면 Phase 2 동작으로 복귀.
- 킬스위치(`enable_veluga_orchestration=false`)는 전 단계 공통 최종 안전판.
