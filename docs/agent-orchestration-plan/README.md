# Veluga 오케스트레이션 & 상태 관리 — 설계·구현 계획

> Status: **Phase 1·2 구현 완료** · 최종 개정 2026-05-28
> Scope: 오케스트레이터-워커 워크플로우 + 태스크별 FSM + `node:sqlite` 내구성 체크포인트
> 확정 결정: 오케스트레이터-워커로 재정의 · 직접 구현 + 검증 패턴 차용 · SQLite 체크포인트 포함 · 폐쇄망/연결망 양쪽 배포 프로파일 인식

이 폴더는 단일 문서였던 `docs/agent-orchestration-plan.md`를 **개요 / 배경·조사 / 갭 분석 / 아키텍처 / 단계별 상세 구현 / 검증**으로 분리한 것이다.

---

## 문서 구성 (읽는 순서)

| # | 문서 | 내용 |
|---|---|---|
| 00 | [개요 (Overview)](00-overview.md) | 목표·범위·확정 결정·현재 vs 목표 상태·하드 제약 |
| 01 | [배경 & 조사 요약](01-background-research.md) | Anthropic/LangGraph/Temporal/OpenAI/OWASP 등 검증된 아키텍처·프롬프트·프로덕션 패턴 조사 결과 |
| 02 | [갭 분석 (원안 ↔ 실제 시스템)](02-gap-analysis.md) | 원안의 가정과 실제 코드베이스 간 불일치 및 결함 |
| 03 | [하드닝 아키텍처 (참조)](03-architecture.md) | 토폴로지·타입·엔진·FSM·IPC·프로덕션 계층·배포 프로파일 |
| 10 | [Phase 1 — 오케스트레이터-워커 MVP](10-phase1-orchestrator-worker.md) | 파일별 상세 구현 작업·시그니처·완료 기준 |
| 11 | [Phase 2 — 내구성 & HITL](11-phase2-durability-hitl.md) | 체크포인트/재개·승인 payload 고정·취소 정리 |
| 12 | [Phase 3 — 선택적 동적성](12-phase3-dynamic-optional.md) | 조건부 엣지 확장·bounded 병렬 sub-session (효과 입증 시) |
| 20 | [검증 방법](20-verification.md) | 테스트 매트릭스·E2E·관측성·회귀 가드 |

---

## 핵심 전제 (반드시 준수)

1. LLM 에이전트 루프는 upstream `pi-coding-agent`(cowork-core 포크, 수정 금지)가 소유한다. Veluga는 `AgentRuntimeExtension` 훅 + `ToolDefinition.execute` 래퍼로만 끼어든다.
2. 모든 LLM은 `VELUGA_LLM_GATEWAY_URL` 경유(공개 엔드포인트 하드코딩 금지, CI 강제). 텔레메트리 SaaS SDK 금지, 화이트아웃 유지.
3. 영속 계층은 Node 내장 `node:sqlite`(`DatabaseSync`).
4. Main→Renderer 상태 전파는 기존 `server-event` 채널.
5. 킬스위치 `policy.veluga.enable_veluga_orchestration=false`면 바닐라 Open Cowork로 바이패스.

자세한 근거는 [00-overview.md](00-overview.md) §하드 제약 참조.

---

## 적용 상태

- [x] **Phase 0** — 본 계획 문서화/개정 (이 폴더)
- [x] **Phase 1** — 오케스트레이터-워커 MVP (`184fcdf`, [tests/phase1/orchestrator-worker.test.ts](../../tests/phase1/orchestrator-worker.test.ts))
- [x] **Phase 2** — 내구성 & HITL (`426fae4`, [tests/phase2/phase2-durability-hitl.test.ts](../../tests/phase2/phase2-durability-hitl.test.ts))
- [ ] **Phase 3** — 선택적 동적성 (조건부, 진행 중 — `sub-session.ts`/`worker-scope.ts`)

> **잔여 후속 작업**: Phase 1 §7의 렌더러 Zustand 반영(`agentStatus`/`tasks[]`)은 미구현. 메인 측 `veluga.orchestration.state` 발행은 완료되었으나 렌더러 store 소비는 후속 처리.
