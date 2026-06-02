# 20 — Step 2: SessionManager (응답 대기)

> 상위 인덱스: [README.md](README.md) · 이전: [10-step1-types.md](10-step1-types.md) · 다음: [30-step3-agent-runner.md](30-step3-agent-runner.md)

**대상 파일**: [`packages/cowork-core/src/main/session/session-manager.ts`](../../packages/cowork-core/src/main/session/session-manager.ts)

**목표**: `requestSudoPassword`/`handleSudoPasswordResponse`를 그대로 복제하여, `execute`가 await할 수 있는 **Promise 블록** + 응답 resolve 경로를 만든다.

**완료 정의(DoD)**: 빌드 통과. 60초 타임아웃 시 `askUserQuestion.dismiss` 전송 + 빈/스킵 응답 resolve. 세션 stop 경로에서 pending 정리.

> 라인 번호는 *구현 시 재확인*. 검증 기준 라인을 적어둔다.

---

## 1. pending Map 선언 (L85-89)

`pendingSudoPasswords`의 **객체-래핑 스타일**을 따른다(직접 resolver를 저장하는 `pendingPermissions`가 아니라).

```typescript
// 기존
private pendingPermissions: Map<string, (result: PermissionResult) => void> = new Map();
private pendingSudoPasswords: Map<
  string,
  { sessionId: string; resolve: (password: string | null) => void }
> = new Map();

// 추가
private pendingUserQuestions: Map<
  string,
  { sessionId: string; resolve: (answers: AskUserQuestionAnswer[]) => void }
> = new Map();
```

- [ ] `pendingUserQuestions` Map 선언 + `AskUserQuestionAnswer` import.

---

## 2. `requestUserQuestion` / `handleUserQuestionResponse` (L1215-1247 복제)

`requestSudoPassword`(L1215-1238) / `handleSudoPasswordResponse`(L1241-1247) 패턴을 그대로 복제. 타임아웃 시 **빈 배열이 아니라** 질문 수만큼 `skipped:true` 응답으로 resolve(에이전트가 안전하게 재개).

```typescript
async requestUserQuestion(
  sessionId: string,
  toolUseId: string,
  questions: QuestionItem[]
): Promise<AskUserQuestionAnswer[]> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      this.pendingUserQuestions.delete(toolUseId);
      resolve(questions.map(() => ({ selectedLabels: [], skipped: true })));
      this.sendToRenderer({ type: 'askUserQuestion.dismiss', payload: { toolUseId } });
    }, 60_000); // 구현 시 sudo와 동일하게 유지(테스트 시 임시 단축 가능)
    this.pendingUserQuestions.set(toolUseId, {
      sessionId,
      resolve: (answers: AskUserQuestionAnswer[]) => {
        clearTimeout(timeout);
        resolve(answers);
      },
    });
    this.sendToRenderer({
      type: 'askUserQuestion.request',
      payload: { toolUseId, sessionId, questions },
    });
  });
}

handleUserQuestionResponse(toolUseId: string, answers: AskUserQuestionAnswer[]): void {
  const entry = this.pendingUserQuestions.get(toolUseId);
  if (entry) {
    entry.resolve(answers);
    this.pendingUserQuestions.delete(toolUseId);
  }
}
```

- [ ] `requestUserQuestion` 추가(타임아웃 + Map set + `askUserQuestion.request` 송신).
- [ ] `handleUserQuestionResponse` 추가(Map get → resolve → delete).

---

## 3. 러너에 콜백 주입 (`createClaudeAgentRunner`, L136-149)

sudo 콜백 주입 지점과 동일하게 옵션 객체에 추가:

```typescript
private createClaudeAgentRunner(): ClaudeAgentRunner {
  return new ClaudeAgentRunner(
    {
      sendToRenderer: this.sendToRenderer,
      saveMessage: (message: Message) => this.saveMessage(message),
      requestSudoPassword: (sessionId, toolUseId, command) =>
        this.requestSudoPassword(sessionId, toolUseId, command),
      // 추가
      requestUserQuestion: (sessionId, toolUseId, questions) =>
        this.requestUserQuestion(sessionId, toolUseId, questions),
    },
    /* ...나머지 인자 동일... */
  );
}
```

- [ ] 옵션 객체에 `requestUserQuestion` 콜백 주입.

---

## 4. 세션 stop 시 pending 정리 (선택·권장)

세션 중단 경로에서 해당 `sessionId`의 `pendingUserQuestions` 엔트리를 찾아 dismiss + skip resolve. (sudo/permission이 stop 시 어떻게 정리되는지 확인하여 동일 처리. 미구현이어도 타임아웃이 백스톱.)

- [ ] (권장) stop 경로에서 sessionId 매칭 엔트리 정리 + `askUserQuestion.dismiss` 송신.

---

## 수용 기준

- [ ] `pendingUserQuestions` Map + `requestUserQuestion`/`handleUserQuestionResponse` 추가.
- [ ] 러너 생성 시 콜백 주입.
- [ ] 타임아웃이 빈 대기가 아니라 skip 응답으로 resolve(에이전트 무한 대기 방지).
- [ ] 빌드/타입체크 통과.
