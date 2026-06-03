# 01 — 배경 & 조사 요약

> 상위 인덱스: [README.md](README.md) · 다음: [02-gap-analysis.md](02-gap-analysis.md)

이 문서는 본 설계를 뒷받침하기 위해 조사한 **검증된 아키텍처·프롬프트·프로덕션 운영 패턴**을 요약한다. 각 결정의 근거이며, 출처 URL은 문서 말미에 있다.

---

## 1. Anthropic 공식 가이드 (1차 근거)

### 1.1 Building Effective Agents

- **워크플로우 vs 에이전트 구분**: *워크플로우* = LLM/도구가 미리 정해진 코드 경로를 따름. *에이전트* = LLM이 스스로 프로세스/도구 사용을 결정. 잘 정의된 문제는 워크플로우, 단계 수를 예측 못 하는 개방형 문제만 에이전트.
- **5가지 워크플로우 패턴**: ① 프롬프트 체이닝 ② 라우팅 ③ 병렬화(sectioning/voting) ④ **오케스트레이터-워커** ⑤ 평가자-최적화자.
- **단순성 원칙(가장 강한 권고)**: *"복잡도는 결과를 입증 가능하게 개선할 때만 추가하라."* 대부분은 단일 LLM 호출 최적화로 충분.

→ **본 설계 반영**: 범용 동적 DAG 대신 **오케스트레이터-워커(워크플로우)** + 정적 그래프 + 조건부 엣지로 시작.

### 1.2 How we built our multi-agent research system

- **오케스트레이터-워커 토폴로지**: 리드 에이전트가 전략 수립 후 서브에이전트를 병렬 기동. **워커는 서로 대화하지 않고, 모든 결정/상태는 오케스트레이터가 보유.** 별도 citation 패스로 인용 검증.
- **서브에이전트 계약(4요소)** — 빠지면 drift: ① **목표(objective)** ② **출력 형식** ③ **도구 가이드** ④ **범위 경계(out-of-scope)**.
- **노력 스케일링**: 규칙이 없으면 단순 질의에 50개 서브에이전트를 띄움 → 단순 사실=1, 비교=2~4, 광범위=10+ 식으로 명문화 필요.
- **비용**: 멀티에이전트는 단순 챗 대비 **~15× 토큰**. 고가치 작업에만. (토큰 사용량이 성능 변동의 80% 설명.)
- **프로덕션 신뢰성 교훈**: stateful 장기 실행 에이전트는 **체크포인트 기반 복구**, 전구간 **트레이싱**, **레인보우 배포**(실행 중 세션 중단 없이 신버전 전환), context 관리(context rot 회피)가 필수.

→ **본 설계 반영**: `WorkerTask`에 4요소(objective/outputContract/toolScope/boundaries) 필드화. `effortTier`로 노력 스케일링. 토큰/스텝 예산. 체크포인트·스팬·레인보우 배포·킬스위치.

### 1.3 Effective context engineering

- **Context rot**: 토큰이 늘수록 회수 정확도 하락. → 고신호 토큰 최소화, **JIT(just-in-time) 검색**(식별자만 로드 후 필요 시 확장), 서브에이전트로 컨텍스트 격리·요약.

→ **본 설계 반영**: 워커는 풀 컨텍스트가 아니라 **요약된 `ContextFragment`만** 오케스트레이터로 반환.

### 1.4 Claude Agent SDK — 서브에이전트

- 각 서브에이전트는 격리된 컨텍스트 윈도에서 실행, **최종 메시지만** 부모로 반환(중간 도구 호출/결과는 격리). 병렬화 + 컨텍스트 격리에 유효.

---

## 2. 프로덕션 오케스트레이션 프레임워크 (패턴 차용)

### 2.1 LangGraph

- **그래프/노드 상태 분리**: 공유 상태 + 노드(계산) + 엣지(라우팅). 키별 **reducer**로 상태 병합(단순 덮어쓰기/연결이 아닌 의미 기반 병합, 메시지 중복 제거 등).
- **조건부 엣지**: 런타임 상태 기반 동적 라우팅(정적 하드코딩 아님).
- **체크포인팅/영속**: 매 스텝 체크포인트(thread 단위) → 크래시 시 재개. **time-travel**(replay/fork)로 비결정 디버깅.
- **interrupt 기반 HITL**: 상태 손실 없이 일시정지 후 정확히 재개.

→ **본 설계 반영**: 세션 FSM + 태스크 상태 분리, `node:sqlite` 체크포인트, 조건부 엣지(use_kb 등).

### 2.2 Temporal (durable execution)

- **결정적 워크플로 / 비결정 액티비티 분리**: 오케스트레이션 로직은 순수·결정적, 부작용(API/DB/LLM)은 액티비티로 격리 + 재시도.
- **멱등성 키**: 액티비티는 at-least-once 실행 → 외부 부작용은 idempotency key로 중복 방지.
- **재시도+백오프(+지터)**, 워크플로/액티비티/하트비트 **중첩 타임아웃**, **신호(signal)** 기반 장기 HITL 대기.
- **안티패턴**: 결정성 위반, 비멱등 액티비티, 히스토리 한도 무시.

→ **본 설계 반영**: 멱등성 키(재개 캐시), 지수 백오프+지터, 중첩 타임아웃, 비재시도/재시도 오류 구분.

### 2.3 OpenAI Agents SDK / Swarm

- **단순성 철학**: 에이전트=프롬프트+도구, 핸드오프=다른 에이전트 반환, **guardrails**(입출력 검증), **내장 트레이싱**.

→ **본 설계 반영**: guardrail = 도구 출력 신뢰성 검증(B/§보안), 트레이싱 = audit 스팬.

---

## 3. 프로덕션 운영 관심사 (검증된 베스트프랙티스)

### 3.1 직접 구현 DAG가 흔히 틀리는 것

- 런타임이 아닌 **정적 사이클 검출**(위상정렬), 데드락 처리, **부분 실패 vs 전체 중단** 의미론, 재시도+지터, 멱등성, 동시성 한도, 취소 전파, 상태 내구성, 관측성. (이 목록이 [02-gap-analysis.md](02-gap-analysis.md)의 점검 기준.)

### 3.2 관측성 (OpenTelemetry GenAI)

- 스팬 속성: `gen_ai.request.model`, `gen_ai.usage.input_tokens/output_tokens`, `gen_ai.response.finish_reasons`. root `invoke_agent` 스팬 → child `chat`/`execute_tool` 스팬. 멀티에이전트는 상관 ID로 세션/에이전트 인스턴스 연결.
- **주의(본 환경)**: SaaS 텔레메트리 SDK(LangSmith/Langfuse/Datadog 등) 금지 → 로컬 적재. 연결망에서만 self-hosted OTLP collector를 egress 허용목록 경유 옵션.

### 3.3 회복탄력성

- **지수 백오프 + 지터**(retry storm 60~80% 감소), **회로차단기**(일시 vs 비일시 오류 구분), **폴백/그레이스풀 디그레이드**. "한 태스크 실패=전체 파이프라인 실패"는 안티패턴.
- **멱등성**: 일시 신뢰성 재시도(캐시 결과 반환)와 샘플링 재시도(새 생성) 구분. 부작용 있는 액션은 의도를 먼저 durable 기록 후 실행.

### 3.4 비용/토큰 예산

- 멀티에이전트 4~15× 토큰. 나이브 루프는 히스토리 누적으로 토큰 비용이 2차적으로 증가. → 세션 토큰 예산 + 최대 스텝 한도 + 컨텍스트 트리밍/요약.

### 3.5 Node.js 동시성·취소

- `AbortController`/`AbortSignal`로 전파, `AbortSignal.timeout()`/`any()`. 자식 프로세스는 **SIGTERM→(타임아웃)SIGKILL** 에스컬레이션. 취소 시 **임시파일 명시적 정리**(`fs.unlink`)로 누수 방지.

### 3.6 HITL 승인

- interrupt/resume + durable 상태. **승인 UI가 본 인자와 재개 시 실행 인자가 달라지는 버그** 방지 → 승인 시점 payload를 **해시로 고정**, 재개 시 불일치면 거부.

### 3.7 보안 (OWASP LLM/Agentic Top 10)

- **indirect prompt injection**: 도구 결과/외부 데이터에 숨은 지시 → 도구 출력을 신뢰하지 말고 원 사용자 의도 대비 검증. **최소권한 도구 스코프**, **인가는 LLM 외부**(정책 서비스가 판정).

---

## 4. 핵심 take-away (설계 직결)

1. 워크플로우(오케스트레이터-워커)로 시작, 동적 에이전트성은 입증 시에만.
2. 오케스트레이터가 상태 소유, 워커는 격리·요약 반환, 4요소 계약 필수.
3. 결정/비결정 분리, 멱등성, 재시도+지터, 중첩 타임아웃, 정적 검증.
4. 매 스텝 체크포인트로 재개 가능하게.
5. 관측성·토큰 예산·취소 정리·HITL payload 고정·도구 출력 불신은 처음부터 설계.

---

## 출처

**Anthropic**
- Building Effective Agents — https://www.anthropic.com/research/building-effective-agents
- How we built our multi-agent research system — https://www.anthropic.com/engineering/multi-agent-research-system
- Effective context engineering for AI agents — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Building agents with the Claude Agent SDK — https://claude.com/blog/building-agents-with-the-claude-agent-sdk
- Subagents (Agent SDK) — https://platform.claude.com/docs/en/agent-sdk/subagents

**프레임워크**
- LangGraph (Graph API / Persistence / Time-travel) — https://docs.langchain.com/oss/python/langgraph/graph-api , .../persistence , .../use-time-travel
- Temporal (Workflow Definition / Idempotency / Anti-patterns) — https://docs.temporal.io/workflow-definition , https://temporal.io/blog/idempotency-and-durable-execution
- OpenAI Agents SDK (Tracing) — https://openai.github.io/openai-agents-python/ , .../tracing/

**운영/보안**
- OpenTelemetry GenAI observability — https://opentelemetry.io/blog/2026/genai-observability/
- OWASP Top 10 for LLM / Agentic Apps — https://genai.owasp.org/llmrisk/llm01-prompt-injection/ , https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- Node.js AbortController / child_process — https://nodejs.org/api/child_process.html
- 멀티에이전트 비용/안티패턴 — https://www.digitalapplied.com/blog/agentic-workflow-anti-patterns-orchestration-mistakes-2026
