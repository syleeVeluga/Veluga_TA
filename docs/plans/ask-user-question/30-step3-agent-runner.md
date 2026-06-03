# 30 — Step 3: agent-runner (툴 등록)

> 상위 인덱스: [README.md](README.md) · 이전: [20-step2-session-manager.md](20-step2-session-manager.md) · 다음: [40-step4-ipc-wiring.md](40-step4-ipc-wiring.md)

**대상 파일**: [`packages/cowork-core/src/main/claude/agent-runner.ts`](../../../packages/cowork-core/src/main/claude/agent-runner.ts)

**목표**: `buildMcpCustomTools`의 ToolDefinition 형태를 본떠 `AskUserQuestion` custom 툴을 만들고, `execute`가 [Step 2](20-step2-session-manager.md)의 `requestUserQuestion`을 await하도록 한다. 콜백이 주입된 경우에만 `customTools`에 합류.

**완료 정의(DoD)**: 타입체크 통과. 콜백 미주입 시 툴 미등록(회귀 안전). 툴명은 정확히 `AskUserQuestion`(렌더러 special-case / historical block과 일치).

> 라인 번호는 *구현 시 재확인*.

---

## 1. `AgentRunnerOptions` 콜백 추가 (L429-437)

```typescript
interface AgentRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  requestSudoPassword?: (sessionId: string, toolUseId: string, command: string) => Promise<string | null>;
  // 추가
  requestUserQuestion?: (
    sessionId: string,
    toolUseId: string,
    questions: QuestionItem[]
  ) => Promise<AskUserQuestionAnswer[]>;
}
```

- [ ] 옵션 인터페이스에 `requestUserQuestion?` 추가.
- [ ] 클래스 멤버 선언(L456-475, `private requestSudoPassword?` 옆)에 동일 시그니처 추가.
- [ ] 생성자(L778-793)에서 `this.requestUserQuestion = options.requestUserQuestion;` 대입.

---

## 2. `AskUserQuestion` ToolDefinition 생성 함수

`buildMcpCustomTools`(L292-324)의 형태를 본뜬다. MCP는 `Type.Unsafe`로 JSON Schema를 래핑하지만, 여기서는 **TypeBox `Type.Object`로 직접** 스키마를 기술한다(파라미터가 고정).

`execute` 시그니처는 `async (toolCallId, params, signal, onUpdate, ctx)`, 반환은 `{ content: [{ type: 'text' as const, text }] }`.

```typescript
function buildAskUserQuestionTool(
  requestUserQuestion: NonNullable<AgentRunnerOptions['requestUserQuestion']>,
  sessionId: string
): ToolDefinition<TSchema, unknown> {
  const parameters = Type.Object({
    questions: Type.Array(
      Type.Object({
        question: Type.String(),
        header: Type.Optional(Type.String()),
        options: Type.Optional(
          Type.Array(Type.Object({
            label: Type.String(),
            description: Type.Optional(Type.String()),
          }))
        ),
        multiSelect: Type.Optional(Type.Boolean()),
      })
    ),
  });

  return {
    name: 'AskUserQuestion', // 렌더러 special-case / historical block과 정확히 일치
    label: 'Ask user',
    description: '사용자 의사결정이 필요할 때 객관식/자유응답 질문을 던지고 답을 받는다.',
    parameters,
    async execute(toolCallId, params) {
      const questions = (params as { questions: QuestionItem[] }).questions;
      const answers = await requestUserQuestion(sessionId, toolCallId, questions);
      return { content: [{ type: 'text' as const, text: formatAnswersForModel(questions, answers) }] };
    },
  };
}
```

`formatAnswersForModel`은 모델이 읽을 텍스트로 포맷(질문별 라벨 / customText / skipped 표기). 단위 테스트 대상([90](90-verification.md)).

```typescript
function formatAnswersForModel(questions: QuestionItem[], answers: AskUserQuestionAnswer[]): string {
  return questions.map((q, i) => {
    const a = answers[i];
    const head = q.header ? `[${q.header}] ${q.question}` : q.question;
    if (!a || a.skipped) return `${head}\n→ (건너뜀)`;
    const parts: string[] = [];
    if (a.selectedLabels?.length) parts.push(a.selectedLabels.join(', '));
    if (a.customText) parts.push(a.customText);
    return `${head}\n→ ${parts.join(' / ') || '(무응답)'}`;
  }).join('\n\n');
}
```

- [ ] `buildAskUserQuestionTool` 추가(TypeBox 스키마 + execute가 `requestUserQuestion` await).
- [ ] `formatAnswersForModel` 추가.

> `sessionId`를 어떻게 전달할지: MCP/extension 툴 빌드가 호출되는 컨텍스트(`run`/세션 실행 시점)에서 현재 `session.id`에 접근 가능한지 확인 후, 동일 출처에서 넘긴다. (원안 §B의 `session.id` 참조.)

---

## 3. `customTools` 병합 (L1888-1902)

`mcpCustomTools`/`extensionCustomTools` 스프레드에 합류 — **콜백이 있을 때만**:

```typescript
const mcpCustomTools = this.mcpManager ? buildMcpCustomTools(this.mcpManager) : [];
const extensionCustomTools = extensionResult.customTools || [];
const askTool = this.requestUserQuestion
  ? [buildAskUserQuestionTool(this.requestUserQuestion, session.id)]
  : [];
const customTools = [...mcpCustomTools, ...extensionCustomTools, ...askTool];
```

- [ ] `requestUserQuestion`이 있을 때만 `askTool`을 만들어 `customTools`에 합류.

---

## 4. 시스템 프롬프트 가이드 (L1861-1881, `<tool_behavior>` 블록)

시스템 프롬프트는 문자열 배열을 `filter` 후 `\n\n`으로 join한다. `<tool_behavior>` 블록에 1~2줄 추가(없으면 모델이 툴 존재를 알아도 잘 안 씀):

```
<tool_behavior>
... 기존 라우팅 규칙 ...
- When you need a user decision (ambiguous choice, missing parameter, confirmation), call the AskUserQuestion tool with concise options rather than guessing.
</tool_behavior>
```

- [ ] `<tool_behavior>`에 AskUserQuestion 사용 가이드 append.

---

## 수용 기준

- [ ] 툴명 정확히 `AskUserQuestion`.
- [ ] 콜백 미주입 시 툴 미등록(기존 동작 무영향).
- [ ] `execute`가 `requestUserQuestion`을 await하고 텍스트 result 반환.
- [ ] 타입체크 통과.
