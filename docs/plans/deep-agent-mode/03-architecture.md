# 03 — 아키텍처

> 상위 인덱스: [README.md](README.md) · 이전: [02-gap-analysis.md](02-gap-analysis.md) · 다음: [10-phase1-native-primitive.md](10-phase1-native-primitive.md)
> Status: **📝 구현 전 아키텍처 계획** · 2026-06-03

**목표**: Deep Agent Mode의 런타임 경로, 타입 계약, 예산/정책 가드, UI 이벤트 흐름을 Phase 1 구현 전에 확정한다.

**핵심 방향**: `spawn_agent`는 우회 도구가 아니라 부모 `ClaudeAgentRunner` 안에서 생성되는 1급 custom tool이다. 자식 세션도 동일한 게이트웨이, 도구 래핑, 정책, audit, checkpoint 경로를 지난다.

---

## 1. 런타임 흐름

```text
ChatView
  -> useIPC.continueSession(sessionId, content, { executionMode: 'deep_agent' })
  -> session.continue ClientEvent
  -> SessionManager.enqueuePrompt(...)
  -> ClaudeAgentRunner.run(...)
  -> create/reuse parent PiAgentSession
  -> parent customTools includes spawn_agent when policy+mode allow
  -> model calls spawn_agent
  -> BoundedSubSessionRunner validates count/depth/token/toolScope
  -> child PiAgentSession created by runner-owned helper
  -> child activity streamed to renderer + audit/checkpoint
  -> child structured result returned to parent tool result
  -> parent final answer passes compliance/tag checks
```

**불변식**:

- 자식 세션은 별도 LLM endpoint를 직접 만들지 않는다.
- 자식 세션은 부모보다 넓은 toolScope를 가질 수 없다.
- 자식 세션 결과는 부모에게 tool result로 돌아오며, 에이전트 간 직접 메시징은 없다.
- `deep_agent.enabled=false` 또는 executionMode 기본값이면 `spawn_agent` 도구 자체를 노출하지 않는다.

---

## 2. 타입 계약

### 2.1 shared-types 확장

[packages/shared-types/src/intent.ts](../../../packages/shared-types/src/intent.ts)에 아래 타입을 추가한다.

```typescript
export type DeepAgentExecutionMode = 'default' | 'deep_agent';

export interface SubAgentPersona {
  id: string;
  name: string;
  description: string;
  systemPrefix: string;
  defaultToolScope: string[];
  source: 'builtin' | 'plugin';
  pluginId?: string;
}

export interface SubAgentOutputContract {
  shape: 'summary_with_citations' | 'review_verdict';
  schemaRef: string;
}

export interface BoundedSubSessionRequest {
  id: string;
  parentSessionId: string;
  objective: string;
  boundaries: string[];
  tokenBudget: number;
  depth: number;
  persona: SubAgentPersona;
  toolScope: string[];
  outputContract: SubAgentOutputContract;
}

export interface BoundedSubSessionResult {
  id: string;
  parentSessionId: string;
  personaId: string;
  summary: string;
  citations: CitationTag[];
  tokensUsed: number;
  status: 'completed' | 'failed' | 'aborted';
  error?: string;
}
```

기존 `BoundedSubSessionRequest`/`Result`를 대체 확장하되, 기존 테스트가 기대하는 필드는 유지한다.

### 2.2 cowork-core IPC 타입

[packages/cowork-core/src/renderer/types/index.ts](../../../packages/cowork-core/src/renderer/types/index.ts)의 `ClientEvent` 계열에 실행 옵션을 추가한다.

```typescript
export interface SessionRunOptions {
  executionMode?: 'default' | 'deep_agent';
}
```

`session.continue` payload에는 `options?: SessionRunOptions`를 추가한다. `ContentBlock`에는 모드 정보를 넣지 않는다.

---

## 3. `spawn_agent` 도구 계약

도구명: `spawn_agent`

입력:

```typescript
interface SpawnAgentInput {
  objective: string;
  personaId?: string;
  boundaries: string[];
  toolScope?: string[];
  tokenBudget?: number;
  outputShape?: 'summary_with_citations' | 'review_verdict';
}
```

출력:

```typescript
interface SpawnAgentOutput {
  subSessionId: string;
  personaId: string;
  status: 'completed' | 'failed' | 'aborted';
  summary: string;
  citations: CitationTag[];
  tokensUsed: number;
}
```

런타임 규칙:

- `objective`와 `boundaries`는 필수다.
- `personaId`가 없으면 내장 `general_subagent`를 쓴다.
- `toolScope`는 요청값이 있어도 정책과 부모 허용 도구의 교집합으로 축소한다.
- `tokenBudget`은 정책 상한과 remaining parent budget을 넘을 수 없다.
- `depth + 1 > maxDepth`면 실행하지 않고 tool error를 반환한다.

---

## 4. 런너 내부 구조

[agent-runner.ts](../../../packages/cowork-core/src/main/claude/agent-runner.ts)는 아래처럼 절제해서 바꾼다.

1. 현재 부모 세션 생성 로직에서 모델/도구/리소스 로더/compaction/settings를 만드는 부분을 private helper로 추출한다.
2. helper는 부모/자식 모두에 같은 gateway auth, model registry, resource loader, wrapped tools, custom tools merge 규칙을 적용한다.
3. 부모 세션에는 mode/policy가 허용할 때만 `spawn_agent` custom tool을 추가한다.
4. `spawn_agent.execute`는 직접 자식 세션을 난립시키지 않고 `BoundedSubSessionRunner` adapter를 호출한다.
5. 자식 세션은 `parentSessionId`, `depth`, `personaId`, `runtimeSignature`를 별도 cache key에 포함한다. 부모 세션 cache를 오염시키지 않는다.

---

## 5. 정책·예산·내구성 가드

[BoundedSubSessionRunner](../../../packages/veluga-main/src/orchestrator/sub-session.ts)를 다음 책임으로 확장한다.

- `enabled`, `maxSubSessions`, `tokenBudget` 기존 가드 유지.
- `maxDepth`, `parentSessionId`, `depth` 검증 추가.
- `toolScope`가 비어 있거나 정책 밖이면 실행 거부.
- 요청 전 budget reserve, 완료 후 actual usage reconcile.
- 실패/취소/예산 초과를 `BoundedSubSessionResult.status`로 구조화.

[checkpoint-store](../../../packages/veluga-main/src/orchestrator/checkpoint-store.ts)는 자식 세션 lineage와 상태 snapshot을 저장한다.

감사 이벤트:

- `deep_agent.spawn.requested`
- `deep_agent.spawn.started`
- `deep_agent.spawn.completed`
- `deep_agent.spawn.failed`
- `deep_agent.spawn.aborted`
- `deep_agent.budget.exceeded`
- `deep_agent.policy.denied`

---

## 6. persona registry

Phase 1:

- 내장 `general_subagent`만 제공한다.
- persona는 권한을 부여하지 않고 systemPrefix와 기본 toolScope hint만 제공한다.

Phase 2:

- 활성화된 플러그인의 `agents/*.md`를 `SubAgentPersona`로 변환한다.
- 변환 결과는 pluginId, sourcePath hash, component enabled state를 포함해 캐시한다.
- 비활성 플러그인 persona는 pool에서 제거한다.

---

## 7. UI 이벤트와 렌더링

Renderer 상태:

- 입력창 하단 또는 모델 스위처 인접 위치에 `기본`/`딥 에이전트` segmented control을 둔다.
- 정책이 허용하지 않으면 control을 렌더링하지 않는다.
- 선택값은 `session.continue` payload의 `options.executionMode`로만 전달한다.

Server event:

- 기존 `server-event` 채널을 유지한다.
- 이벤트 타입은 `deepAgent.subSession` 또는 trace group 확장 중 하나를 Phase 1에서 선택한다.
- UI에는 자식 세션 카드/패널을 별도 assistant message로 저장하지 않는다. 활동 표시와 최종 답변은 분리한다.

권장 payload:

```typescript
interface DeepAgentSubSessionEvent {
  sessionId: string;
  subSessionId: string;
  parentSessionId: string;
  personaName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
  objective: string;
  tokensUsed?: number;
  summary?: string;
  error?: string;
}
```

---

## 8. 취소와 재시작

- 부모 세션 취소는 모든 active child AbortController에 전파한다.
- 자식 세션 취소는 tool result error로 부모에 반환하되, 부모 전체를 반드시 실패시키지는 않는다. 정책 deny나 예산 초과는 부모에 명확히 알린다.
- 앱 재시작 시 Phase 1은 미완 자식 세션을 안전 정리하고 사용자에게 통지한다. 자동 재개는 checkpoint 결정성이 확보된 항목부터 확장한다.

---

## 9. 기본값

| 항목 | Phase 1 기본값 |
|---|---|
| `executionMode` | `default` |
| `deep_agent.enabled` | 정책 false면 완전 미노출 |
| `maxDepth` | 1 |
| `maxSubSessions` | 3 |
| per-child token budget | 정책값 또는 런너 보수 기본값 |
| persona | `general_subagent` |
| plugin persona | Phase 2까지 미사용 |

---

## 리스크 / 주의

- `spawn_agent` custom tool이 부모 세션 reuse 시 stale mode로 남지 않게 runtime signature에 executionMode/policy flag를 포함한다.
- 자식 세션이 부모와 같은 message persistence path를 쓰면 transcript가 오염될 수 있다. 자식 활동은 별도 event/audit/checkpoint로 보관하고, 부모 transcript에는 tool result summary만 남긴다.
- Phase 1은 품질 개선을 가능하게 하는 primitive와 관측성을 만드는 단계다. complex workflow 자동화는 Phase 3에서 A/B 후 강화한다.
