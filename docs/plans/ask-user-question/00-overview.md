# 00 — 개요 (Overview)

> 상위 인덱스: [README.md](README.md) · 다음: [10-step1-types.md](10-step1-types.md)

## Context

현재 Veluga_TA는 Codex / Claude CoWork처럼 **에이전트가 실행 도중 사용자에게 역질문을 던지고 응답을 기다리는** 기능이 없다.

조사 결과 확정된 사실:

- pi-coding-agent SDK의 builtin 툴은 `read/bash/edit/write/grep/find/ls` **뿐이다**. `AskUserQuestion`은 SDK에도, 이 앱의 에이전트 백엔드에도 **등록되어 있지 않다.**
- 렌더러의 [`message/AskUserQuestionBlock.tsx`](../../../packages/cowork-core/src/renderer/components/message/AskUserQuestionBlock.tsx)는 주석대로 "read-only display for historical messages" — 과거 메시지 렌더링용 잔존 코드일 뿐, 실제로 에이전트가 호출할 수 있는 경로가 없다.
- 반면 **권한 요청(`requestPermission`) / sudo 비밀번호(`requestSudoPassword`)** 흐름이 "툴 핸들러 → Promise로 응답 대기 → ServerEvent로 UI 요청 → IPC 응답으로 resolve"라는 정확히 필요한 패턴을 이미 완성형으로 제공한다.

## 목표

첨부 이미지처럼 **입력창(Composer) 위에 붙는 인라인 패널**로 역질문을 표시한다. 다음을 모두 지원(풀 기능):

- 여러 질문 페이저(`3개 중 1개` ‹ ›)
- 단일/다중 선택, 번호 옵션
- `기타`(직접입력)
- `건너뛰기`
- `또는 직접 답장...` 자유 텍스트

**로컬 세션 먼저** (원격 Discord/Slack 연동은 후속).

핵심 아키텍처: SDK가 custom tool의 async `execute`를 await한다는 점을 이용해, `AskUserQuestion` custom ToolDefinition을 등록하고 그 execute가 사용자 응답까지 블록한다. (= MCP / 권한 / sudo와 동일 패턴)

---

## 아키텍처 흐름

```
에이전트가 AskUserQuestion 툴 호출
  → custom tool execute(toolCallId, {questions}) 핸들러 (agent-runner)
  → SessionManager.requestUserQuestion(sessionId, toolUseId, questions) [Promise 반환, 블록]
  → sendToRenderer({ type:'askUserQuestion.request', payload:{toolUseId, sessionId, questions} })
  → useIPC 리스너 → store.setPendingQuestion(payload)
  → ChatView 인라인 패널 렌더 (Composer 위)
  → 사용자 선택/입력/건너뛰기
  → send({ type:'askUserQuestion.response', payload:{toolUseId, answers} })
  → preload allowlist 통과 → ipcMain 'client-invoke'
  → SessionManager.handleUserQuestionResponse(toolUseId, answers) → Promise resolve
  → execute가 answers를 텍스트 tool result로 반환 → 에이전트 재개
```

## 타임아웃 / 취소 정책

- `requestSudoPassword`의 **60초 타임아웃**을 차용. 타임아웃 시 `pendingUserQuestions`에서 삭제 + `askUserQuestion.dismiss` 전송 + **빈/스킵 응답으로 resolve**(에이전트가 무한 대기하지 않도록).
- 세션 중단(stop) 시 pending 정리(패널 닫힘). dismiss는 **현재 toolUseId가 일치할 때만** 패널을 닫는다.

---

## 재사용 / 신규 요약

| 재사용 (출처) | 신규 |
|---|---|
| `requestSudoPassword` / `handleSudoPasswordResponse` 패턴 ([session-manager.ts](../../../packages/cowork-core/src/main/session/session-manager.ts)) | `requestUserQuestion` / `handleUserQuestionResponse` |
| `buildMcpCustomTools`의 TypeBox + async execute 형태 ([agent-runner.ts](../../../packages/cowork-core/src/main/claude/agent-runner.ts)) | `AskUserQuestion` ToolDefinition |
| `QuestionItem` / `QuestionOption` 타입 ([types/index.ts](../../../packages/cowork-core/src/renderer/types/index.ts)) | `AskUserQuestionRequest` / `AskUserQuestionAnswer` |
| `pendingPermission` store / selector / useIPC 흐름 | `pendingQuestion` 동일 흐름 |
| `message/AskUserQuestionBlock.tsx` 렌더 스타일 | `AskUserQuestionPanel`(인터랙티브, 인라인) |
| `permission.response` IPC 배선(index.ts / client-event-utils / preload) | `askUserQuestion.response` 동일 3곳 |

> 원격(remote-manager의 `handleQuestionRequest` / `parseQuestionResponse`)은 이번 범위 제외 — 후속에서 로컬 `requestUserQuestion`을 원격 세션일 때 분기하도록 연결.

---

## 단계 의존 순서

각 단계가 **독립적으로 타입체크를 통과**하도록 아래 순서로 구현한다.

```
10 타입 (모든 단계가 참조하는 기반)
   ↓
20 메인: SessionManager (Promise 블록 + 응답 핸들러)
   ↓
30 메인: agent-runner (ToolDefinition 등록 + 콜백 소비)
   ↓
40 메인: IPC 배선 (응답이 SessionManager까지 도달)
   ↓
50 렌더러: 상태 (요청 수신 → store, 응답 송신 콜백)
   ↓
60 렌더러: 인라인 패널 UI (사용자 상호작용)
   ↓
70 i18n (UI 문자열)
   ↓
90 검증
```

---

## UI 요구 상세 (참조 이미지 기준)

- **헤더**: 아이콘 + 제목. 질문이 2개 이상이면 우측에 `{현재}개 중 {전체}개` 페이저 + ‹ › + X(전체 건너뛰기).
- **옵션**: 번호(1,2,3) 버튼. `multiSelect`면 체크 토글, 아니면 단일선택.
- **단일선택 + 단일질문**: 옵션 클릭 즉시 제출(이미지의 `→` 동작).
- **`기타`(연필)**: 클릭 시 해당 질문에 인라인 텍스트 입력 활성화 → `customText`.
- **`건너뛰기`**: 현재 질문 `skipped=true`.
- **`또는 직접 답장...` textarea**: 자유 응답(= `customText`).
- 모든 질문 처리 후 `respondToQuestion(toolUseId, answers)` 호출. answers는 `questions`와 **인덱스 정렬**(질문별 1개).
