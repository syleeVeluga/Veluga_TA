# 10 — Phase 1: 네이티브 primitive + 기본 가용

> 상위 인덱스: [README.md](README.md) · 아키텍처: [03-architecture.md](03-architecture.md) · 다음: [11-phase2-marketplace-intake.md](11-phase2-marketplace-intake.md)
> Status: **📝 구현 계획** · 2026-06-03

**목표**: 설치 없이도 사용자가 입력창에서 `딥 에이전트`를 선택하면 모델이 bounded `spawn_agent` primitive로 자식 LLM 세션에 위임할 수 있게 한다. 정책·예산·감사·게이트웨이 불변식은 부모와 자식 모두에 동일 적용한다.

**전제**: Phase 1은 마켓플레이스 persona 없이 내장 generic subagent만 사용한다. 플러그인 agents 수용은 [11-phase2-marketplace-intake.md](11-phase2-marketplace-intake.md)에서 한다.

**완료 정의(DoD)**: `deep_agent.enabled=false` 또는 기본 모드에서는 기존 단일 세션과 패리티를 유지하고, `딥 에이전트` 모드에서는 `spawn_agent` 호출, 자식 세션 스트리밍, 예산/깊이 차단, audit/checkpoint 기록, renderer 표시가 모두 검증된다.

---

## 0. 사전 검증

- [ ] `git status --short`로 작업 범위를 확인한다.
- [ ] 현재 [00-overview.md](00-overview.md), [02-gap-analysis.md](02-gap-analysis.md), [03-architecture.md](03-architecture.md)를 다시 읽고 미확정 항목을 구현으로 끌어오지 않는다.
- [ ] `npm run typecheck` 또는 현재 repo에서 가장 빠른 타입 검증 명령을 실행해 baseline을 기록한다.
- [ ] 기존 `agent-orchestration` 테스트가 통과하는지 확인한다.

---

## 1. shared-types 확장

대상: [packages/shared-types/src/intent.ts](../../../packages/shared-types/src/intent.ts), [packages/shared-types/src/index.ts](../../../packages/shared-types/src/index.ts)

- [ ] `DeepAgentExecutionMode`, `SubAgentPersona`, `SubAgentOutputContract` 타입을 추가한다.
- [ ] `BoundedSubSessionRequest`에 `parentSessionId`, `depth`, `persona`, `toolScope`, `outputContract`를 추가한다.
- [ ] `BoundedSubSessionResult`에 `parentSessionId`, `personaId`, `status`, `error?`를 추가한다.
- [ ] 기존 호출부가 깨지지 않도록 테스트 fixture를 함께 조정한다.

**수용 기준**: `@veluga/shared-types` import 경로에서 새 타입이 export되고, 기존 `BoundedSubSessionRunner` 테스트는 새 필드를 명시해 통과한다.

---

## 2. IPC 실행 옵션 추가

대상: [packages/cowork-core/src/renderer/types/index.ts](../../../packages/cowork-core/src/renderer/types/index.ts), [useIPC.ts](../../../packages/cowork-core/src/renderer/hooks/useIPC.ts), [main/index.ts](../../../packages/cowork-core/src/main/index.ts), [session-manager.ts](../../../packages/cowork-core/src/main/session/session-manager.ts)

- [ ] `SessionRunOptions` 타입을 추가하고 `session.continue` payload에 `options?: SessionRunOptions`를 추가한다.
- [ ] `useIPC.continueSession(sessionId, content, options?)`가 `options.executionMode`를 main으로 전달하게 한다.
- [ ] `main/index.ts`의 `session.continue` 라우팅이 options를 `SessionManager.continueSession`으로 넘기게 한다.
- [ ] `SessionManager.enqueuePrompt`까지 options를 보존해 `ClaudeAgentRunner` 실행 인자로 전달한다.
- [ ] Browser mock 경로는 options를 무시하되 타입은 유지한다.

**수용 기준**: 기존 호출부는 options 없이 그대로 컴파일되고, 딥 에이전트 모드 선택 시 main까지 `executionMode: 'deep_agent'`가 전달된다.

---

## 3. 정책 flag와 모드 게이팅

대상: policy/shared config 타입, renderer policy provider, main runtime option resolver

- [ ] 정책에 `veluga.deep_agent.enabled`를 추가한다. 기존 `enable_veluga_orchestration`이 false면 deep agent도 강제로 false다.
- [ ] flag 기본값은 false 또는 기관 정책값으로 둔다. 제품 default-ON 여부는 Phase 3 효과 측정 뒤 결정한다.
- [ ] main에서 `isDeepAgentAllowed(policy, runOptions)` helper를 만든다.
- [ ] 허용되지 않은 요청은 조용히 default mode로 degrade하거나 정책 deny notice를 반환한다. Phase 1 기본은 회귀 최소화를 위해 default degrade다.

**수용 기준**: flag false에서 `spawn_agent` 도구가 customTools에 포함되지 않는다.

---

## 4. `agent-runner.ts` 세션 생성 helper 추출

대상: [agent-runner.ts](../../../packages/cowork-core/src/main/claude/agent-runner.ts)

- [ ] 부모 세션 생성에 필요한 model, thinkingLevel, authStorage, modelRegistry, resourceLoader, wrapped tools, customTools, cwd, compaction settings 생성을 private helper로 분리한다.
- [ ] helper는 부모/자식 공용이지만 public API를 넓히지 않는다.
- [ ] parent cache key와 child cache key를 분리한다. child key에는 `parentSessionId`, `subSessionId`, `personaId`, `depth`, runtime signature를 포함한다.
- [ ] 자식 세션 transcript가 부모 Session DB message로 저장되지 않도록 저장 경로를 분리한다.

**수용 기준**: helper 추출 전후 기본 모드 세션 생성/재사용 동작이 동일하다.

---

## 5. `spawn_agent` custom tool 추가

대상: [agent-runner.ts](../../../packages/cowork-core/src/main/claude/agent-runner.ts)

- [ ] `buildSpawnAgentTool(context)`를 추가한다.
- [ ] tool input schema는 `objective`, `boundaries`, `personaId?`, `toolScope?`, `tokenBudget?`, `outputShape?`만 허용한다.
- [ ] 요청값을 `BoundedSubSessionRequest`로 변환하며, persona 미지정 시 `general_subagent`를 사용한다.
- [ ] toolScope는 부모 allowed tools, 정책 화이트리스트, 요청 toolScope의 교집합으로 축소한다.
- [ ] `BoundedSubSessionRunner.runAll([request], signal)`을 통해 실행한다. 직접 budget 검증을 중복 구현하지 않는다.
- [ ] 결과는 `SpawnAgentOutput` JSON 문자열 또는 SDK가 요구하는 tool result 형태로 반환한다.

**수용 기준**: 딥 모드에서 customTools 로그에 `spawn_agent`가 보이고, 기본 모드에서는 보이지 않는다.

---

## 6. BoundedSubSessionRunner 라이브 결선

대상: [sub-session.ts](../../../packages/veluga-main/src/orchestrator/sub-session.ts), [tool-interceptor.ts](../../../packages/veluga-main/src/tool-interceptor.ts), [audit-logger.ts](../../../packages/veluga-main/src/audit-logger.ts), [checkpoint-store.ts](../../../packages/veluga-main/src/orchestrator/checkpoint-store.ts)

- [ ] `maxDepth`, `parentSessionId`, `persona`, `toolScope`, `outputContract` 검증을 추가한다.
- [ ] `run` adapter는 런너 내부 child session helper를 호출한다.
- [ ] 시작/완료/실패/취소/예산 초과를 audit에 기록한다.
- [ ] checkpoint에는 subSessionId, parentSessionId, personaId, status, objective hash, tokensUsed를 저장한다.
- [ ] 부모 AbortSignal을 자식 AbortController에 전파한다.

**수용 기준**: depth 초과, tokenBudget 초과, toolScope empty, signal abort 케이스가 모두 구조화된 실패로 기록된다.

---

## 7. Renderer 모드 셀렉터와 활동 패널

대상: [ChatView.tsx](../../../packages/cowork-core/src/renderer/components/ChatView.tsx), [useIPC.ts](../../../packages/cowork-core/src/renderer/hooks/useIPC.ts), renderer store/selectors, i18n ko/en

- [ ] 입력창의 모델 스위처 인접 위치에 `기본`/`딥 에이전트` segmented control을 추가한다.
- [ ] 정책이 허용하지 않으면 control을 렌더링하지 않는다.
- [ ] submit 시 선택값을 `continueSession(..., { executionMode })`로 전달한다.
- [ ] 자식 세션 이벤트를 store에 저장하고, active session message list 주변에 접을 수 있는 활동 패널로 표시한다.
- [ ] 활동 패널은 카드 중첩을 피하고, objective/status/persona/tokens/error만 간결하게 표시한다.

**수용 기준**: 모바일/데스크톱에서 입력창 레이아웃이 깨지지 않고, 딥 모드 상태가 텍스트 prompt에 섞이지 않는다.

---

## 8. Compliance와 최종 응답 결선

- [ ] 자식 세션 summary에도 신뢰도 태그/citation 정보가 포함되도록 output contract를 강제한다.
- [ ] 부모 최종 답변은 기존 compliance-checker 경로를 통과한다.
- [ ] 자식 결과가 tag 없는 자유 텍스트이면 부모에게 "insufficient tagged evidence"로 반환하고 최종 답변에서 보수적으로 처리한다.

**수용 기준**: 자식 산출이 audit와 compliance trace에 남고, 최종 assistant message는 기존 태그 규칙을 유지한다.

---

## 9. 테스트

- [ ] shared-types: `BoundedSubSessionRequest` 필수 필드와 backward fixture 조정.
- [ ] IPC: `session.continue` options 전달, options 없는 기존 호출 패리티.
- [ ] runner: flag/mode에 따른 `spawn_agent` custom tool 포함/미포함.
- [ ] runner: `spawn_agent` input sanitize와 toolScope 교집합.
- [ ] sub-session: depth/token/session count 초과 거부.
- [ ] cancellation: 부모 cancel 시 active child abort.
- [ ] renderer: policy false control 미노출, policy true control 전달.
- [ ] integration: 딥 모드에서 fake child run result가 부모 tool result로 반환.

---

## 10. 검증 명령

- `npm run typecheck`
- 관련 Vitest: shared-types/sub-session/runner IPC/renderer 테스트
- `npm run verify`는 push 전 필수

---

## 리스크 / 주의

- `agent-runner.ts`는 넓은 파일이다. helper 추출은 `spawn_agent`에 필요한 범위로만 제한하고, provider/model switching 로직은 의미 변경하지 않는다.
- 자식 세션을 DB message로 직접 저장하면 사용자 transcript가 오염된다. Phase 1은 활동 event와 audit/checkpoint로 분리한다.
- mode가 session cache에 남아 다음 default turn에 `spawn_agent`가 노출되지 않게 runtime signature와 tool rebuild 조건을 확인한다.
