# AskUserQuestion 인라인 다이얼로그 — 단계별 상세 구현 계획

> Status: **설계 완료 · 구현 대기** · 로컬 세션 우선(원격 Discord/Slack 연동은 후속) · 개정 2026-06-03
> Scope: 에이전트 실행 중 사용자에게 역질문을 던지고 응답까지 블록하는 인라인 패널(Composer 위)
> 확정 결정: SDK builtin이 아닌 **custom `AskUserQuestion` ToolDefinition** 등록 · 권한/sudo의 "execute가 Promise로 응답까지 블록" 패턴 차용 · 로컬 세션 먼저(풀 기능 UI) · 원격은 범위 제외

이 폴더는 원래 단일 문서였던 설계 초안을 **개요 / 단계별 상세 구현 / 검증**으로 분리한 것이다. 각 단계 문서는 실제 코드 경로·라인·재사용 패턴을 담아 그대로 실행 가능하게 작성했다(라인 번호는 *구현 시 재확인* 전제).

---

## 문서 구성 (읽는 순서)

| # | 문서 | 내용 |
|---|---|---|
| 00 | [개요 (Overview)](00-overview.md) | Context·목표·UI 요구·아키텍처 흐름도·타임아웃 정책·재사용/신규 요약·단계 의존 순서 |
| 10 | [Step 1 — 타입](10-step1-types.md) | `renderer/types/index.ts`: `AskUserQuestionRequest`/`AskUserQuestionAnswer` + `ServerEvent`/`ClientEvent` union 확장 |
| 20 | [Step 2 — SessionManager](20-step2-session-manager.md) | pending Map + `requestUserQuestion`/`handleUserQuestionResponse` + 러너 콜백 결선 |
| 30 | [Step 3 — agent-runner](30-step3-agent-runner.md) | `AgentRunnerOptions` 콜백 + `AskUserQuestion` ToolDefinition + `customTools` 병합 + 시스템 프롬프트 가이드 |
| 40 | [Step 4 — IPC 배선](40-step4-ipc-wiring.md) | `main/index.ts` switch + `client-event-utils.ts` + `preload` allowlist (3곳) |
| 50 | [Step 5 — 렌더러 상태](50-step5-renderer-state.md) | `store` 상태/액션 + `selectors` + `useIPC` 리스너/`respondToQuestion` |
| 60 | [Step 6 — 인라인 패널](60-step6-renderer-panel.md) | 신규 `AskUserQuestionPanel.tsx` + `ChatView` Composer 위 삽입 |
| 70 | [Step 7 — i18n](70-step7-i18n.md) | `en.json`/`ko.json` `askUserQuestion` 네임스페이스 |
| 90 | [검증 방법](90-verification.md) | 타입체크/빌드 · 수동 E2E · 회귀 가드 · 단위 테스트 |

---

## 핵심 전제 (반드시 준수)

1. **pi-coding-agent SDK builtin 툴엔 `AskUserQuestion`이 없다**(`read/bash/edit/write/grep/find/ls`뿐). 따라서 custom `ToolDefinition`으로 등록하고 그 `execute`가 사용자 응답까지 await한다. → [30](30-step3-agent-runner.md).
2. **권한(`requestPermission`) / sudo(`requestSudoPassword`) 흐름이 정확히 필요한 패턴을 이미 완성형으로 제공**한다("툴 핸들러 → Promise로 응답 대기 → ServerEvent로 UI 요청 → IPC 응답으로 resolve"). 이 패턴을 그대로 복제한다. → [20](20-step2-session-manager.md)·[40](40-step4-ipc-wiring.md)·[50](50-step5-renderer-state.md).
3. **로컬 세션 우선**. 원격(remote-manager의 `handleQuestionRequest`/`parseQuestionResponse`)은 이번 범위 **제외** — 후속에서 로컬 `requestUserQuestion`을 원격 세션일 때 분기 연결.
4. 과거 메시지용 [`message/AskUserQuestionBlock.tsx`](../../../packages/cowork-core/src/renderer/components/message/AskUserQuestionBlock.tsx)는 **read-only로 유지**. 신규 인터랙티브 패널은 **별도 컴포넌트**이므로 충돌 없음(툴명 `AskUserQuestion` 유지).

자세한 근거·UI 요구·흐름도는 [00-overview.md](00-overview.md) 참조.

---

## 적용 상태

- [ ] **Step 1** — 타입 (`renderer/types/index.ts`)
- [ ] **Step 2** — SessionManager 응답 대기 (`main/session/session-manager.ts`)
- [ ] **Step 3** — agent-runner 툴 등록 (`main/claude/agent-runner.ts`)
- [ ] **Step 4** — IPC 배선 (`main/index.ts` · `client-event-utils.ts` · `preload/index.ts`)
- [ ] **Step 5** — 렌더러 상태 (`store/index.ts` · `store/selectors.ts` · `hooks/useIPC.ts`)
- [ ] **Step 6** — 인라인 패널 (`components/AskUserQuestionPanel.tsx` 신규 · `components/ChatView.tsx`)
- [ ] **Step 7** — i18n (`i18n/locales/en.json` · `ko.json`)
- [ ] **검증** — 타입체크/빌드 · 수동 E2E · 회귀 · 단위 테스트

> **후속(이번 범위 외)**: 원격 세션(Discord/Slack)에서의 역질문 — `requestUserQuestion`을 원격 세션일 때 remote-manager 경로로 분기.
