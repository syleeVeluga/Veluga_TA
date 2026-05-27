# 10 — Phase 1: 오케스트레이터-워커 MVP (상세 구현)

> 상위 인덱스: [README.md](README.md) · 아키텍처: [03-architecture.md](03-architecture.md) · 다음: [11-phase2-durability-hitl.md](11-phase2-durability-hitl.md)

**✅ 구현 완료** (commit `184fcdf` · 2026-05-28). 검증: [tests/phase1/orchestrator-worker.test.ts](../../tests/phase1/orchestrator-worker.test.ts).
산출물: [orchestrator.ts](../../packages/veluga-main/src/orchestrator/orchestrator.ts) · [agent-state-manager.ts](../../packages/veluga-main/src/orchestrator/agent-state-manager.ts) · [planner.ts](../../packages/veluga-main/src/orchestrator/planner.ts) · [worker-bridge.ts](../../packages/veluga-main/src/orchestrator/worker-bridge.ts) · [ipc-middleware.ts](../../packages/veluga-main/src/ipc-middleware.ts) · [shared-types/intent.ts](../../packages/shared-types/src/intent.ts).
**잔여**: §7 렌더러 Zustand 반영(`agentStatus`/`tasks[]`)은 미구현 — 메인 측 `veluga.orchestration.state` 발행만 완료.

**목표**: 정적 그래프 + 제한 병렬(KB·파일·정책·스타일) 컨텍스트 수집 → 단일 cowork 세션 생성. 엔진 하드닝 + FSM 가드 + 스텝/토큰 예산 + audit 스팬. **생성은 단일 세션 유지, 체크포인트/재개는 Phase 2.**

**완료 정의(DoD)**: 킬스위치 ON에서 KB+파일 혼합 질의가 병렬 게이트로 처리되고, optional 게이트 실패가 응답을 막지 않으며, 불법 FSM 전이가 거부되고, `npm run verify`가 통과한다. 킬스위치 OFF는 upstream 패리티.

---

## 0. 사전 작업

- [x] 분기 생성(예: `feat/orchestrator-phase1`). cowork-core 파일은 **수정 금지** 재확인.
- [x] `policy.veluga.enable_veluga_orchestration` 동작/바이패스 경로 회귀 확인([tests/phase1](tests/phase1)).

---

## 1. 타입 추가 — [packages/shared-types/src/intent.ts](packages/shared-types/src/intent.ts)

- [x] `WorkerType`, `ContextFragment`, `WorkerTask`, `WorkPlan` 추가([03 §3.1](03-architecture.md) 그대로). `CitationTag` 재사용.
- [x] `index.ts` 배럴에서 export 되는지 확인(다른 패키지가 `@veluga/shared-types`로 import).
- **수용 기준**: `any` 미사용, `tsc --noEmit` 통과.

---

## 2. 엔진 — `packages/veluga-main/src/orchestrator/orchestrator.ts` (신규)

[03 §4](03-architecture.md)의 불변식을 구현. 참조 골격:

```typescript
import type { WorkPlan, WorkerTask, ContextFragment } from '../../../shared-types/src/index.js';

const TERMINAL: ReadonlySet<WorkerTask['status']> = new Set(['completed', 'failed', 'aborted', 'skipped']);

export interface OrchestratorOptions {
  maxConcurrency?: number;     // I/O 게이트웨이 동시 한도 (기본 3)
  defaultTimeoutMs?: number;   // 기본 30000
  maxAttempts?: number;        // 기본 3
  retryBaseMs?: number;        // 기본 250
  retryCapMs?: number;         // 기본 4000
  maxSteps?: number;           // 런어웨이 가드
  tokenBudget?: number;        // 세션 토큰 예산
}

export type RunWorker = (task: WorkerTask, signal: AbortSignal) => Promise<ContextFragment>;

export class VelugaOrchestrator {
  constructor(private readonly runWorker: RunWorker, private readonly opts: OrchestratorOptions = {}) {}

  validate(plan: WorkPlan): { ok: true } | { ok: false; reason: string } { /* Kahn 위상정렬 + 의존성 존재 검증 ([10 §2.1]) */ }

  async executePlan(
    plan: WorkPlan,
    onTaskUpdate: (task: WorkerTask) => void,
    signal: AbortSignal
  ): Promise<{ results: Record<string, ContextFragment>; failedRequired: WorkerTask[]; tokensUsed: number }> {
    /* [10 §2.2] 스케줄링 루프 */
  }

  private runWithRetry(task: WorkerTask, signal: AbortSignal): Promise<ContextFragment> { /* [10 §2.3] */ }
  private withTimeout(task: WorkerTask, signal: AbortSignal): Promise<ContextFragment> { /* [10 §2.4] */ }
}
```

### 2.1 `validate()` — 정적 검증

- [x] 모든 `dependencies` ID가 `tasks`에 존재하는지 검사 → 없으면 `{ok:false}`.
- [x] Kahn 위상정렬: 진입차수 0부터 큐, 방문 수 ≠ 태스크 수면 사이클.
- **수용 기준**: 사이클/누락 의존성 입력에 `{ok:false, reason}` 반환.

### 2.2 `executePlan()` — 스케줄링 루프

- [x] 루프 조건: `terminalCount() < tasks.length`.
- [x] runnable = `pending` && 모든 dep `completed`.
- [x] **막힌 pending 처리**: dep 중 비-completed 터미널이 있으면 `optional?skipped:aborted`.
- [x] 동시성: `active.size < maxConcurrency`인 동안만 기동.
- [x] 태스크 완료 시 `.then/.catch/.finally`로 상태 갱신, `onTaskUpdate` 호출, `active.delete`.
- [x] `optional` 실패 → `skipped`(degrade), 필수 실패 → `failed`(의존 체인은 다음 루프에서 cascade).
- [x] `active.size===0 && 미완` → 잔여 강등/취소 후 break(데드락 방지).
- [x] `active.size>0`일 때만 `await Promise.race(active.values())`.
- [x] 토큰/스텝 예산 초과 시 `signal.abort()` 유도 + `CRITICAL_ERROR` 신호.
- **수용 기준**: 단일 optional 실패가 전체를 막지 않음. 필수 실패 시 의존 태스크 `aborted`.

### 2.3 `runWithRetry()` — 재시도+지터

- [x] `isRetryable(err)`(타임아웃/게이트웨이 5xx 등) && !aborted && attempt<max일 때만 재시도.
- [x] `delay = min(cap, base·2^(n-1)) + random()·base`, `sleep(delay, signal)`(abort 시 즉시 reject).
- [x] 비재시도 오류(정책 deny)는 즉시 throw.

### 2.4 `withTimeout()` — 타임아웃 + 취소

- [x] `setTimeout`으로 reject, `signal`에 `{once:true}` abort 리스너.
- [x] **`finally`에서 `clearTimeout` + `removeEventListener`** (누수 방지).

---

## 3. FSM — `packages/veluga-main/src/orchestrator/agent-state-manager.ts` (신규)

- [x] 세션 상태 enum + [03 §5.2](03-architecture.md) 전이 매트릭스를 `Record<State, State[]>`로.
- [x] `transition(to)`: 허용 목록에 없으면 throw + `audit.append({event_type:'orchestration.illegal_transition', ...})`.
- [x] 태스크 라이프사이클은 `WorkerTask.status`로 별도 관리(세션 FSM과 분리).
- [x] 상태 변경 시 콜백으로 IPC 발행(§5)에 연결.
- **수용 기준**: 불법 전이 시 throw + audit 기록 테스트.

---

## 4. 플래너 — `packages/veluga-main/src/orchestrator/planner.ts` (신규)

- [x] `buildWorkPlan(message, intent: IntentPlan, policy): WorkPlan`.
- [x] `IntentPlan`(use_kb/kb_scopes/answer_mode/suggested_skills)을 기반으로 워커 태스크 생성(조건부): `use_kb`→kb-retrieval, project/파일 신호→file-analysis, 항상 policy-preaudit, draft 계열→style-card-load.
- [x] 각 태스크에 **4요소(objective/outputContract/toolScope/boundaries)** 채움.
- [x] `effortTier` 결정(단순=single, 비교/혼합=small, 광범위=broad)으로 동시성/예산 스케일.
- [x] **sanitize**: [intent-router.ts](packages/veluga-main/src/agents/intent-router.ts)의 `sanitizePlan`과 동형 — `toolScope`/`kbScopes`/skills를 정책 화이트리스트와 교집합. LLM 경로면 JSON 파싱 실패 시 휴리스틱 폴백.
- **수용 기준**: 미허가 스코프/스킬이 plan에서 제거됨. 사이클 없는 유효 plan 생성.

---

## 5. 워커 실행 브리지 (`runWorker`)

- [x] `kb-retrieval`: [knowledge-gate.ts](packages/veluga-main/src/agents/knowledge-gate.ts) 게이트 통과 후 kb-mcp-adapter 검색 → `ContextFragment{summary, citations}`.
- [x] `file-analysis`: project/workspace 파일 파싱 → 요약 fragment.
- [x] `policy-preaudit`: [policy-guard.ts](packages/veluga-main/src/agents/policy-guard.ts) dry-run 결과 fragment(승인 필요 항목 표시).
- [x] `style-card-load`: style-card fragment.
- [x] 각 워커는 `toolScope` 밖 도구 호출 금지, `signal` 준수.
- **수용 기준**: 워커는 풀 컨텍스트가 아닌 **요약 fragment만** 반환(context rot 회피).

---

## 6. 진입점 결선 — [packages/veluga-main/src/ipc-middleware.ts](packages/veluga-main/src/ipc-middleware.ts)

- [x] `handleUserMessage`에서 fast-path 처리 이후, 비-fast-path 경로를 Orchestrator로 라우팅(현재는 `fallback` 위임).
- [x] 흐름: `IntentRouter.classify` → `planner.buildWorkPlan` → `orchestrator.validate` → FSM `PLANNING→RUNNING_PARALLEL` → `executePlan` → 컨텍스트 융합 → `AgentRuntimeExtension.beforeSessionRun`로 융합 컨텍스트/프롬프트 prefix 주입 → 단일 cowork 세션(`fallback`) 생성 → compliance-checker → STREAMING.
- [x] 세션별 `AbortController` 생성·소유, 취소 IPC에 연결.
- [x] `enable_veluga_orchestration=false` 바이패스 **유지**.
- **수용 기준**: 킬스위치 OFF 패리티, ON에서 병렬 게이트 동작.

---

## 7. IPC 상태 발행 (server-event)

- [x] FSM/태스크 업데이트를 `server-event`의 타입드 이벤트 `veluga.orchestration.state`로 발행(읽기전용 스냅샷). 새 채널 금지.
- [ ] 렌더러 [packages/veluga-renderer/src/](packages/veluga-renderer/src/) Zustand store에 `agentStatus`, `tasks[]` 반영(진행 표시). ⏳ **미구현(후속)** — 메인 발행은 완료, 렌더러 소비 미연결.

---

## 8. 관측성 (audit 스팬)

- [x] [audit-logger.ts](packages/veluga-main/src/audit-logger.ts)에 `orchestration.task_transition` + 세션/태스크 스팬 속성 적재(OTel GenAI: `gen_ai.usage.*`, `workerType`, `attempts`, `latency_ms`, `from/to_status`). 기존 스키마 호환 유지(payload_json에 적재).

---

## 9. 예산 가드

- [x] `maxSteps`/`tokenBudget` 초과 시 실행 중단 + `CRITICAL_ERROR`. `effortTier`로 기본값 스케일. `policy.veluga.kb_token_budget` 연계.

---

## 10. 테스트 (`tests/` 신규, [20-verification.md](20-verification.md) 매트릭스 참조)

- [x] validate: 사이클/누락 의존성 거부.
- [x] executePlan: optional degrade vs 필수 cascade, 동시성 한도, 재시도+지터, 데드락 break.
- [x] withTimeout: 타임아웃 reject + 리스너 해제.
- [x] FSM: 불법 전이 throw + audit.
- [x] planner: 미허가 스코프/스킬 제거.
- [x] ipc-middleware: 킬스위치 OFF 패리티.
- [x] `npm run verify` 통과.

---

## 11. 리스크 / 주의

- `beforeSessionRun` 컨텍스트 주입량이 단일 세션 토큰을 압박할 수 있음 → 워커 요약 길이 상한.
- 병렬 게이트웨이 호출이 레이트리밋 유발 가능 → `maxConcurrency` 보수적 시작(3) + 회로차단기.
- cowork-core 시그니처 변경 위험 → 통합은 문서화된 훅에만 의존, upstream 커밋 고정 확인.
