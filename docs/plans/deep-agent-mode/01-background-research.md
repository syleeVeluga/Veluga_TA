# 01 — 배경 & 조사

> 상위 인덱스: [README.md](README.md) · 개요: [00-overview.md](00-overview.md) · 다음: [02-gap-analysis.md](02-gap-analysis.md)
> Status: **📝 구현 전 조사 계획** · 2026-06-03

**목표**: Deep Agent Mode 구현 전에 `spawn_agent` primitive가 필요한 이유와 수용해야 할 harness 패턴을 현재 코드 기준으로 확정한다. 이 단계는 코드 변경 없이 근거를 잠그는 단계다.

**전제**: [00-overview.md](00-overview.md)의 rev.2 결정이 기준이다. 즉 cowork-core 선택 수정은 가능하지만, 게이트웨이·화이트아웃·정책·감사 불변식은 자식 세션에도 그대로 적용한다.

**완료 정의(DoD)**: upstream SDK/현재 런너/플러그인 런타임/기존 오케스트레이션 표면을 대조한 증거가 남고, Phase 1에서 바로 구현할 수 있는 결정 목록과 보류 목록이 분리된다.

---

## 1. upstream 런타임 primitive 부재 확인

- [ ] [agent-runner.ts](../../../packages/cowork-core/src/main/claude/agent-runner.ts)의 `createAgentSession` 호출부, `customTools` 주입부, 세션 캐시 재사용부를 근거로 현재 세션 생성 책임 범위를 정리한다.
- [ ] `@mariozechner/pi-coding-agent`가 제공하는 공개 API에서 팀/서브에이전트/Task 위임 primitive가 있는지 확인한다. 확인 대상은 실제 설치된 패키지 타입과 런타임 export다.
- [ ] `sendMessage`가 UI 메시지 전송 경로인지, 에이전트 간 메시징 primitive가 아닌지 명확히 기록한다.
- [ ] 모델 호출 도구 추가만으로 가능한 범위와, 자식 세션 생성/스트리밍/예산 회계 때문에 런너 수정이 필요한 범위를 분리한다.

**수용 기준**: "훅만으로 가능한 일"과 "`agent-runner.ts` 내부 수정이 필요한 일"이 파일/함수 단위로 정리되어 [02-gap-analysis.md](02-gap-analysis.md)에 입력된다.

---

## 2. harness / harness-100 패턴 조사

- [ ] 6개 협업 패턴(Pipeline, Fan-out/Fan-in, Expert Pool, Producer-Reviewer, Supervisor, Hierarchical Delegation)을 Veluga 실행 모델로 옮길 때 필요한 최소 기능을 표로 정리한다.
- [ ] harness 플러그인 포맷이 `.claude-plugin/plugin.json`, `agents/`, `skills/` 컴포넌트를 전제로 한다는 점을 확인하고, Veluga 플러그인 런타임의 component count와 맞물리는 지점을 기록한다.
- [ ] 공개 카탈로그/CLI 설치/외부 트레이싱/직접 LLM endpoint 호출 등 Veluga 불변식과 충돌하는 요소를 분리한다.
- [ ] 이번 범위에서 직접 이식하지 않을 항목과, 검증용 1~2개 로컬 패키지로 축소할 항목을 구분한다.

**수용 기준**: 각 패턴이 Phase 1, Phase 2, Phase 3 중 어디에서 다뤄지는지 명확하다. 대량 이식 항목은 Phase 2의 "수용 계약" 밖으로 밀려난다.

---

## 3. 기존 Veluga 오케스트레이션 상속분 확인

- [ ] [agent-orchestration](../agent-orchestration/README.md)의 완료 범위를 확인한다. 특히 `VelugaOrchestrator`, `BoundedSubSessionRunner`, `checkpoint-store`, `agent-state-manager`, `tool-interceptor`, `approval-queue` 중 Deep Agent Mode가 재사용할 표면을 표시한다.
- [ ] [BoundedSubSessionRequest](../../../packages/shared-types/src/intent.ts)가 현재 `{id, objective, boundaries, tokenBudget}`만 갖는다는 점을 확인하고, Phase 1 타입 확장 목록을 작성한다.
- [ ] [BoundedSubSessionRunner](../../../packages/veluga-main/src/orchestrator/sub-session.ts)가 현재 세션 수/토큰 예산만 검증하므로, depth·parentSessionId·toolScope·persona 검증이 추가로 필요함을 기록한다.
- [ ] 체크포인트와 audit가 자식 세션의 전이와 토큰 사용량을 기록할 수 있는 최소 payload 형태를 확인한다.

**수용 기준**: 기존 오케스트레이션을 "대체"하지 않고 "자식 LLM 세션 가드"로 재사용하는 구현 경계가 정리된다.

---

## 4. UI / IPC / 렌더러 진입점 조사

- [ ] [ChatView.tsx](../../../packages/cowork-core/src/renderer/components/ChatView.tsx)에서 입력창, 모델 스위처, 첨부 파일, 제출 흐름의 실제 위치를 확인한다.
- [ ] [useIPC.ts](../../../packages/cowork-core/src/renderer/hooks/useIPC.ts)의 `continueSession` payload가 현재 `sessionId`, `prompt`, `content` 중심임을 확인하고, 실행 옵션 확장 지점을 기록한다.
- [ ] [SessionManager.continueSession](../../../packages/cowork-core/src/main/session/session-manager.ts)와 [main index event routing](../../../packages/cowork-core/src/main/index.ts)의 payload 전달 경로를 확인한다.
- [ ] `server-event` 기반 이벤트 처리와 trace 렌더링 경로를 확인하고, 자식 세션 활동을 새 채널 없이 표현할지, 타입드 이벤트를 추가할지 결정 후보를 작성한다.

**수용 기준**: Phase 1에서 `ContentBlock`을 오염시키지 않고 `session.continue` 실행 옵션으로 딥 에이전트 모드를 전달하는 방식이 검토된다.

---

## 5. 마켓플레이스 / 플러그인 런타임 조사

- [ ] [PluginRuntimeService](../../../packages/cowork-core/src/main/skills/plugin-runtime-service.ts)가 현재 catalog, install, enable, component enable, runtime materialization을 어떻게 처리하는지 정리한다.
- [ ] 현재 `install()` 경로가 공개 카탈로그/Claude CLI 의존을 가질 수 있으므로, Deep Agent Mode Phase 2에서 Veluga 자체 카탈로그/내부 설치 경로로 대체해야 하는 지점을 표시한다.
- [ ] `agents` component가 count/materialize 대상이지만 persona registry로 번역되지 않는다는 gap을 확인한다.
- [ ] [skills-manager.ts](../../../packages/cowork-core/src/main/skills/skills-manager.ts)의 `SKILL.md` 감지와 agents persona 감지를 분리해 설계한다.

**수용 기준**: Phase 2에서 "마켓플레이스 수용"이 외부 네트워크나 CLI 셸아웃 없이 가능한 설계 표면으로 좁혀진다.

---

## 6. 산출물

- [ ] 조사 결과 요약: primitive 부재, 런너 수정 필요성, 플러그인 수용 제약, 기존 오케스트레이션 재사용 범위.
- [ ] 확정 결정 목록: Phase 1에서 바로 구현할 기본값과 타입.
- [ ] 보류 결정 목록: 카탈로그 호스팅 방식, default-ON 정책, reviewer/HITL 강도, upstream merge 전략.
- [ ] [02-gap-analysis.md](02-gap-analysis.md)로 넘길 gap 표 초안.

---

## 리스크 / 주의

- 공개 harness 저장소나 플러그인 포맷은 바뀔 수 있다. 구현 직전에는 특정 commit/tag 또는 내부 미러 snapshot을 기준으로 고정한다.
- 계획 문서는 현재 명세가 아니다. 구현 시작 전에는 [docs/README.md](../../README.md)의 문서 맵에 따라 `reference/`와 실제 코드를 다시 확인한다.
