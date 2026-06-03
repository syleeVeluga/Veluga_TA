# 네트워크 무한대기·오류 처리 보완 계획 (main 기준)

## Context (왜 하는가)

수동 테스트 중 네트워크가 끊기거나 응답이 안 올 때, main 브랜치는 주 에이전트 경로(`pi-coding-agent` SDK)에 자동 재시도(2회) + 5분 활동 워치독 + 에러 메시지 한·영 매핑이 있어 브랜치(codex CLI 위임)보다는 낫지만, 다음 세 갭으로 **사용자가 멈춤을 인지하지 못하거나 오래 hang**한다:

1. **스트림 중간 `error` 이벤트가 로그만 되고 UI에 안 뜸** — `message_end`로 떨어지지 않는 스트림 에러는 사용자가 못 본다.
2. **워치독이 5분 단일 타이머로 거침** — 응답이 아예 안 와도 5분, half-open 소켓/`message_end` 미수신 시에도 최대 5분 hang.
3. **`llm-gateway` / KB HTTP 호출 / policy rpc는 타임아웃·취소가 없어 무한 대기** 가능.

목표: **(a)** 무한대기를 유한 시간 내에 끊고, **(b)** 무슨 상황인지 명확한 한·영 메시지로 사용자에게 알리며, **(c)** 직접 API 클라이언트에 타임아웃/취소를 추가한다. 기존 에러 카탈로그·유틸을 최대한 재사용한다.

> 구현 대상은 main. 단, `agent-runner.ts`는 main과 `feat/subscription-login`이 크게 다르므로(브랜치 +336줄) 아래 라인 번호는 **main 기준**이며, 실제 작업 브랜치에서 동일 블록을 찾아 적용한다.

---

## Part 1 — 에이전트 파이프라인 (주 채팅 경로)

대상: `packages/cowork-core/src/main/claude/agent-runner.ts`, `packages/cowork-core/src/main/claude/agent-runner-message-end.ts`

### 1a. 스트림 `error` 이벤트를 사용자에게 노출
- 현재 `ame.type === 'error'` 분기(agent-runner.ts:2230)는 `logCtxError`만 한다.
- `message_end`의 에러-emit 블록(agent-runner.ts:2306-2331)과 동일한 로직을 **공용 헬퍼 `emitTerminalError(errorText)`** 로 추출하고, `error` 분기에서도 호출한다.
  - `hasEmittedError` 가드 유지(중복 방지), `terminalErrorText` 설정, `toUserFacingErrorText` + `getAgentErrorFollowupText`로 메시지 구성, 이후 `break`로 스트림 종료.
  - 메시지 문구는 `ame.reason` + `ame.error?.content`를 `toUserFacingErrorText`에 넘겨 분류되게 한다.

### 1b. 단일 5분 워치독 → 2단 워치독
현재 `PROMPT_TIMEOUT_MS = 5*60*1000` 단일 타이머가 모든 이벤트마다 reset(agent-runner.ts:2128-2137). 이를 분리:

- **첫 응답 타임아웃** `firstResponseTimeoutMs` (기본 90s, 설정): prompt 시작 시 무장, 첫 스트림 이벤트(`receivedFirstStreamEvent`) 도착 시 해제. 발화 시 `abortedByTimeout=true` + `controller.abort()` → 기존 `first_response_timeout` 메시지.
  - **provider === 'ollama'** 는 콜드스타트가 길 수 있으므로 더 큰 값(기본 300s) 적용 — 기존 10초 안내 트레이스(agent-runner.ts:2091)는 그대로 둔다.
- **스트림 정체 타임아웃** `activityTimeoutMs` (기본 300s, 설정): 첫 이벤트 이후 적용, 이벤트마다 reset(기존 동작 유지). `message_end` 미수신/half-open도 이 타이머가 커버.
  - 첫 이벤트 이후 발화한 경우 새 사유 `stream_stalled`로 abort하여 메시지를 구분한다(아래 1c).
- 첫 이벤트 도착 시 첫-응답 타이머를 끄고 정체 타이머로 전환하는 분기를 `markFirstStreamEvent`/이벤트 핸들러(agent-runner.ts:2155) 근처에 추가.

### 1c. 에러 카탈로그 확장 + 매핑
agent-runner-message-end.ts:21-62 `ERROR_TEXT`에 키 추가(ko/en):
- `streamStalled`: "응답이 시작됐지만 도중에 멈췄습니다(연결 불안정 가능). 잠시 후 다시 시도하세요." / 영문 동등.
- `unreachable`: "게이트웨이/엔드포인트에 연결하지 못했거나 시간 내 응답이 없습니다. 네트워크와 endpoint를 확인하세요." / 영문 동등.

`toUserFacingErrorText`(agent-runner-message-end.ts:78)에 매칭 추가:
- `stream_stalled` 센티넬 → `streamStalled`.
- `timed out` / `aborterror` / `the operation was aborted` / `etimedout` 부분일치 → `unreachable` (AbortSignal.timeout 에러가 명확히 읽히도록). 기존 network 분기(connection refused/fetch failed 등)는 유지.

---

## Part 2 — 직접 API 클라이언트 타임아웃/취소

공통 패턴: 기존 `packages/cowork-core/src/main/config/ollama-api.ts`에서 쓰는 `AbortSignal.timeout(ms)`를 재사용.

### 2a. LLM Gateway
`packages/veluga-main/src/llm-gateway.ts:31-50`: `fetch(...)`에 `signal: AbortSignal.timeout(timeoutMs)` 추가.
- `timeoutMs`는 `env.VELUGA_LLM_GATEWAY_TIMEOUT_MS` (기본 120000) — `createOpenAICompatibleGateway`가 이미 `env`를 받으므로 거기서 읽는다.
- try/catch로 abort/timeout을 잡아 `LLM gateway timed out after {ms}ms`, 네트워크 오류는 `LLM gateway unreachable: {cause}` 로 명확히 throw(현재 `!response.ok`만 처리).
- (선택) 타임아웃/5xx에 한해 1회 재시도 — 최소화. cowork-core의 `utils/retry.ts` `withRetry`는 패키지가 달라 직접 import하지 않고 로컬 소규모 재시도로 둔다.

### 2b. KB HTTP 클라이언트
`packages/veluga-main/src/kb/kb-mcp-adapter.ts` `HttpKbClient`(227행~): `listTools`/`callTool`의 `fetch`에 `signal: AbortSignal.timeout(timeoutMs)` 추가.
- 오늘은 `withTimeout` race(1.5s)가 reject돼도 **하위 fetch는 취소되지 않고 누수**된다 — signal로 실제 취소.
- `HttpKbClient` 생성자에 `timeoutMs` 추가하고 `KbMcpAdapter`가 자신의 `timeoutMs`(기본 1500)를 전달. abort → `KbUnavailableError('KB service timed out')` 매핑.

### 2c. Policy RPC
`packages/policy-service/src/rpc-client.ts` `fetchAll`(15행~): `RpcPolicyClientOptions`에 `timeoutMs?`(기본 10000) 추가, fetch에 `signal: AbortSignal.timeout(timeoutMs)`. 타임아웃 시 `PolicyService RPC timed out after {ms}ms`로 명확히 throw.

---

## Config 노브
- cowork-core `config-store.ts`: `agentRuntime.firstResponseTimeoutMs`(기본 90000), `agentRuntime.activityTimeoutMs`(기본 300000) 추가. `memoryRuntime.llm.timeoutMs` 패턴을 따른다. ollama 한정 첫-응답 기본값은 코드에서 300000로 분기.
- veluga-main/policy-service는 Electron config가 없으므로 env: `VELUGA_LLM_GATEWAY_TIMEOUT_MS`, `VELUGA_KB_TIMEOUT_MS`, `VELUGA_POLICY_TIMEOUT_MS`.

## 재사용하는 기존 자산
- `toUserFacingErrorText`, `getAgentErrorFollowupText`, `ERROR_TEXT` (메시지 한·영 카탈로그)
- 기존 `abortedByTimeout` / `first_response_timeout` 흐름 (agent-runner.ts:2523,2550)
- `AbortSignal.timeout()` (ollama-api.ts 선례)
- pi-ai SDK 내부 재시도(`retry:{enabled:true,maxRetries:2}`, agent-runner.ts:2006)는 **변경하지 않음**

---

## 검증 (Verification)

**단위 테스트** (기존 vitest + mocked fetch 패턴, `packages/cowork-core/tests/`, `packages/.../src/tests/`):
- `agent-runner-message-end` 테스트에 `stream_stalled`, `unreachable`, abort/timeout 부분일치 매핑 케이스 추가.
- llm-gateway: 응답 안 오는 fetch mock + fake timers/AbortSignal로 타임아웃 throw 및 메시지 확인. 재시도 도입 시 재시도 횟수 확인.
- kb-mcp-adapter: 느린 client mock으로 `KbUnavailableError('... timed out')` 및 signal abort 확인.
- rpc-client: 타임아웃 throw 확인.
- agent-runner: 첫-응답 타이머/정체 타이머가 각각 올바른 메시지로 abort하는지(가짜 타이머 + 스트림 이벤트 시뮬레이션), `error` 이벤트가 사용자 메시지로 emit되는지.

**수동 E2E** (앱 실행 후 네트워크 차단):
1. 첫 응답 전에 endpoint 차단 → ~90s 내 "모델 응답 시간 초과" 메시지 + trace "Request timed out".
2. 응답 중간에 연결 끊기 → 정체 타임아웃 발화, "도중에 멈췄습니다" 메시지.
3. SDK 스트림 error 유발 → 사용자에게 분류된 에러 메시지 노출(로그만 X).
4. llm-gateway/KB/policy 경로 차단 → 무한 hang 없이 유한 시간 내 명확한 에러.

## 범위 밖 (Out of scope)
- pi-ai SDK 내부 재시도 정책 변경.
- orchestrator(`intent-router`/planner/responder)가 실제 실행 앱에 연결되는지 여부 자체(별도 확인 필요 시 후속).
- 새 토스트/알림 UI 컴포넌트 신설(기존 메시지 카드 경로로 노출).
