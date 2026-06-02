# 에이전트 진행 중 역질문(AskUserQuestion) 인라인 다이얼로그 구현

> 📂 단계별 상세 구현 계획은 [`ask-user-question-plan/`](ask-user-question-plan/README.md) 폴더로 분리했다(타입 → 메인 → 렌더러 → i18n → 검증). 이 문서는 고수준 인덱스로 유지한다.

## Context

현재 Veluga_TA는 Codex / Claude CoWork처럼 **에이전트가 실행 도중 사용자에게 역질문을 던지고 응답을 기다리는** 기능이 없다.

조사 결과 확정된 사실:

- pi-coding-agent SDK의 builtin 툴은 `read/bash/edit/write/grep/find/ls` **뿐이다**. `AskUserQuestion`은 SDK에도, 이 앱의 에이전트 백엔드에도 **등록되어 있지 않다.**
- 렌더러의 `AskUserQuestionBlock.tsx`는 주석대로 "read-only display for historical messages" — 과거 메시지 렌더링용 잔존 코드일 뿐, 실제로 에이전트가 호출할 수 있는 경로가 없다.
- 반면 **권한 요청(`requestPermission`) / sudo 비밀번호(`requestSudoPassword`)** 흐름이 "툴 핸들러 → Promise로 응답 대기 → ServerEvent로 UI 요청 → IPC 응답으로 resolve"라는 정확히 필요한 패턴을 이미 완성형으로 제공한다.

목표: 첨부 이미지처럼 **입력창(Composer) 위에 붙는 인라인 패널**로 역질문을 표시한다. 여러 질문 페이저(`3개 중 1개` ‹ ›), 단일/다중 선택, 번호 옵션, `기타`(직접입력), `건너뛰기`, `또는 직접 답장...` 자유 텍스트를 모두 지원(풀 기능). **로컬 세션 먼저** (원격 Discord/Slack 연동은 후속).

핵심 아키텍처: SDK가 custom tool의 async `execute`를 await한다는 점을 이용해, `AskUserQuestion` custom ToolDefinition을 등록하고 그 execute가 사용자 응답까지 블록한다. (= MCP/sudo와 동일 패턴)

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

타임아웃/취소: `requestSudoPassword`처럼 타임아웃(예: 5분) 시 `askUserQuestion.dismiss` 전송 + 빈/스킵 응답으로 resolve. 세션 중단(stop) 시 pending 정리.

---

## 변경 파일 및 작업

### A. 타입 (단일 출처: renderer/types/index.ts)

`packages/cowork-core/src/renderer/types/index.ts`

- 기존 `QuestionItem` / `QuestionOption`(L430-441) **재사용**.
- 새 타입 추가:
  - `AskUserQuestionRequest { toolUseId; sessionId; questions: QuestionItem[] }`
  - `AskUserQuestionAnswer { selectedLabels: string[]; customText?: string; skipped?: boolean }` (질문별 1개, `questions`와 인덱스 정렬)
- `ServerEvent`(L505 부근)에 추가:
  - `| { type: 'askUserQuestion.request'; payload: AskUserQuestionRequest }`
  - `| { type: 'askUserQuestion.dismiss'; payload: { toolUseId: string } }`
- `ClientEvent`(L450 부근)에 추가:
  - `| { type: 'askUserQuestion.response'; payload: { toolUseId: string; answers: AskUserQuestionAnswer[] } }`

### B. Main — 툴 등록 + 응답 대기

`packages/cowork-core/src/main/session/session-manager.ts`

- `pendingPermissions`/`pendingSudoPasswords` Map 선언부(L85-89) 옆에 `pendingUserQuestions: Map<string, { sessionId; resolve }>` 추가.
- `requestSudoPassword`(L1215) / `handleSudoPasswordResponse`(L1241) 패턴을 그대로 복제해:
  - `requestUserQuestion(sessionId, toolUseId, questions): Promise<AskUserQuestionAnswer[]>` — Map 등록 + 타임아웃 + `sendToRenderer({type:'askUserQuestion.request',...})`.
  - `handleUserQuestionResponse(toolUseId, answers)` — Map에서 resolver 찾아 resolve.
- ClaudeAgentRunner 생성 시 옵션으로 `requestUserQuestion` 콜백 주입(sudo 콜백 주입 지점과 동일).

`packages/cowork-core/src/main/claude/agent-runner.ts`

- `AgentRunnerOptions`에 `requestUserQuestion?: (sessionId, toolUseId, questions) => Promise<AskUserQuestionAnswer[]>` 추가.
- `AskUserQuestion` custom ToolDefinition 생성 함수 추가(이름은 렌더러 special-case와 일치하도록 정확히 `AskUserQuestion`). `buildMcpCustomTools`(L291)와 동일한 TypeBox + async execute 형태:
  - `parameters`: `Type.Object({ questions: Type.Array(Type.Object({ question, header?, options?: Array({label, description?}), multiSelect? })) })`
  - `async execute(toolCallId, params)`: `const answers = await this.options.requestUserQuestion(session.id, toolCallId, params.questions)` → answers를 모델이 읽을 텍스트로 포맷해 `{ content:[{type:'text', text}] }` 반환. (옵션 라벨/자유텍스트/건너뛰기 표기)
- 이 툴을 `customTools` 배열에 합류시킨다(L1871-1873, `mcpCustomTools`/`extensionCustomTools`와 함께). 콜백이 있을 때만 등록.
- (권장) 시스템 프롬프트에 "사용자 의사결정이 필요할 때 AskUserQuestion 툴을 사용하라"는 1~2줄 가이드를 append(L1855 부근 `<tool_behavior>` 블록). 이게 없으면 모델이 툴 존재를 알아도 잘 안 쓸 수 있음.

`packages/cowork-core/src/main/index.ts`

- `client-invoke` switch(L2793 `permission.response` 인근)에 `case 'askUserQuestion.response': return sm.handleUserQuestionResponse(payload.toolUseId, payload.answers);` 추가.

`packages/cowork-core/src/main/client-event-utils.ts` (L13)

- 여기에도 `permission.response` 분기가 있으므로, 동일하게 `askUserQuestion.response` 분기를 추가(두 경로가 일관되도록 확인).

`packages/cowork-core/src/preload/index.ts` (L52)

- `ALLOWED_CLIENT_EVENTS` Set에 `'askUserQuestion.response'` 추가(누락 시 IPC 차단됨 — 필수).

### C. Renderer — 상태 + 인라인 UI

`packages/cowork-core/src/renderer/store/index.ts`

- `pendingPermission`/`pendingSudoPassword`(L90-94, 230-231) 패턴대로 `pendingQuestion: AskUserQuestionRequest | null` 상태 + `setPendingQuestion` 액션 추가.

`packages/cowork-core/src/renderer/store/selectors.ts` (L289)

- `usePendingDialogs()`에 `pendingQuestion` 추가(또는 ChatView 전용 selector 신설).

`packages/cowork-core/src/renderer/hooks/useIPC.ts`

- ServerEvent switch(L199 `permission.request` 인근)에:
  - `case 'askUserQuestion.request': store.setPendingQuestion(event.payload); break;`
  - `case 'askUserQuestion.dismiss': { if (current toolUseId 일치) store.setPendingQuestion(null); } break;`
- `respondToPermission`(L694) 패턴대로 `respondToQuestion(toolUseId, answers)` 콜백 추가 → `send({type:'askUserQuestion.response',...})` + `setPendingQuestion(null)`. 훅 반환 객체에 노출.

**새 컴포넌트** `packages/cowork-core/src/renderer/components/AskUserQuestionPanel.tsx`

- 인라인 패널(모달 아님). props: `request: AskUserQuestionRequest`.
- `AskUserQuestionBlock.tsx`의 헤더/옵션 렌더 스타일을 재사용·확장하되 **인터랙티브**로:
  - 질문 페이저: `questions.length > 1`이면 헤더 우측에 `{idx+1}개 중 {n}개` + ‹ › 네비, X 닫기(=건너뛰기 전체).
  - 옵션: 번호(1,2,3) 버튼. `multiSelect`면 체크 토글, 아니면 단일선택.
  - `기타`(연필 아이콘) 행: 클릭 시 해당 질문 인라인 텍스트 입력 활성화 → `customText`.
  - `건너뛰기` 버튼: 현재 질문 `skipped=true`.
  - `또는 직접 답장...` textarea: 자유 응답(=customText).
  - 모든 질문 처리 후(또는 단일 선택 즉시 진행) `respondToQuestion(toolUseId, answers)` 호출. 단일선택+단일질문이면 옵션 클릭 즉시 제출(이미지의 `→` 동작).
- 상태는 로컬 useState로 질문별 답안 누적.

`packages/cowork-core/src/renderer/components/ChatView.tsx` (L720)

- Composer 입력 영역(L720-851)의 **textarea 컨테이너 바로 위**에 `{pendingQuestion && pendingQuestion.sessionId === activeSessionId && <AskUserQuestionPanel request={pendingQuestion} />}` 삽입. (모달인 App.tsx가 아니라 ChatView 인라인 — 이미지와 동일 위치)

### D. i18n

`packages/cowork-core/src/renderer/i18n/locales/en.json` / `ko.json`

- `askUserQuestion` 네임스페이스: `other`("기타"), `skip`("건너뛰기"), `orDirect`("또는 직접 답장..."), `pager`("{{total}}개 중 {{current}}개"), `send` 등.

---

## 재사용 / 신규 요약

| 재사용 | 신규 |
|---|---|
| `requestSudoPassword`/`handleSudoPasswordResponse` 패턴 | `requestUserQuestion`/`handleUserQuestionResponse` |
| `buildMcpCustomTools`의 TypeBox+async execute 형태 | `AskUserQuestion` ToolDefinition |
| `QuestionItem`/`QuestionOption` 타입 | `AskUserQuestionRequest`/`AskUserQuestionAnswer` |
| `pendingPermission` store/selector/useIPC 흐름 | `pendingQuestion` 동일 흐름 |
| `AskUserQuestionBlock` 렌더 스타일 | `AskUserQuestionPanel`(인터랙티브, 인라인) |
| `permission.response` IPC 배선(index.ts/client-event-utils/preload) | `askUserQuestion.response` 동일 3곳 |

원격(remote-manager의 `handleQuestionRequest`/`parseQuestionResponse`)은 이번 범위 제외 — 후속에서 로컬 `requestUserQuestion`을 원격 세션일 때 분기하도록 연결.

---

## Verification

1. **타입/빌드**: `pnpm --filter cowork-core typecheck` (또는 레포 표준 빌드)로 ServerEvent/ClientEvent union, ToolDefinition 시그니처 통과 확인.
2. **수동 E2E**(핵심): 앱 실행 후, 모델이 결정을 필요로 하는 프롬프트(예: "견적 금액 조정할지 물어봐줘") 입력 → 에이전트가 `AskUserQuestion` 호출 → Composer 위에 인라인 패널 등장 확인.
   - 단일선택 옵션 클릭 → 즉시 제출되고 에이전트가 선택값 반영해 진행하는지.
   - 다중 질문 페이저 ‹ › 이동, `기타` 직접입력, `건너뛰기`, `또는 직접 답장...` 각각 응답이 에이전트에 텍스트로 전달되는지.
   - 타임아웃(임시로 짧게) / 세션 stop 시 패널이 닫히고 pending이 정리되는지.
3. **회귀**: 기존 `AskUserQuestionBlock` 과거 메시지 렌더가 깨지지 않는지(툴명 `AskUserQuestion` 유지). 권한/sudo 다이얼로그가 영향 없는지.
4. **기존 테스트**: `tests/message-card-ask-user-question-state.test.ts`는 *historical block*이 read-only임을 검증 — 이 테스트는 그대로 통과해야 함(새 인터랙티브 패널은 별도 컴포넌트이므로 충돌 없음). 가능하면 `requestUserQuestion`/`parseAnswers` 단위 테스트 추가.
