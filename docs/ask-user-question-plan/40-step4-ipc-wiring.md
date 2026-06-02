# 40 — Step 4: IPC 배선 (3곳)

> 상위 인덱스: [README.md](README.md) · 이전: [30-step3-agent-runner.md](30-step3-agent-runner.md) · 다음: [50-step5-renderer-state.md](50-step5-renderer-state.md)

**목표**: 렌더러의 `askUserQuestion.response`가 `SessionManager.handleUserQuestionResponse`까지 안전하게 도달하도록 **3곳**을 배선한다. `permission.response`/`sudo.password.response`가 통과하는 경로와 동일하게 맞춘다.

**완료 정의(DoD)**: 세 곳 모두 반영. 이벤트 타입 문자열이 [Step 1](10-step1-types.md)과 정확히 일치. 누락 시 IPC가 조용히 차단되므로 반드시 셋 다.

> 라인 번호는 *구현 시 재확인*.

---

## 1. `main/index.ts` — `handleClientEvent` switch

[`packages/cowork-core/src/main/index.ts`](../../packages/cowork-core/src/main/index.ts) (`permission.response` 케이스 인근, L2796 부근). `sm`은 SessionManager alias.

```typescript
case 'permission.response':
  return sm.handlePermissionResponse(event.payload.toolUseId, event.payload.result);
case 'sudo.password.response':
  return sm.handleSudoPasswordResponse(event.payload.toolUseId, event.payload.password);
// 추가
case 'askUserQuestion.response':
  return sm.handleUserQuestionResponse(event.payload.toolUseId, event.payload.answers);
```

- [ ] `askUserQuestion.response` case 추가.

---

## 2. `client-event-utils.ts` — `eventRequiresSessionManager`

[`packages/cowork-core/src/main/client-event-utils.ts`](../../packages/cowork-core/src/main/client-event-utils.ts) (L4-17). 현재 `permission.response`는 있으나 `sudo.password.response`는 빠져 있다. `askUserQuestion.response`는 `handleUserQuestionResponse`(SessionManager 필요)를 호출하므로 **반드시 추가**한다.

```typescript
export function eventRequiresSessionManager(event: ClientEvent): boolean {
  switch (event.type) {
    case 'session.start':
    // ... 기존 ...
    case 'permission.response':
    case 'askUserQuestion.response': // 추가
      return true;
    default:
      return false;
  }
}
```

- [ ] `askUserQuestion.response` 분기 추가.

---

## 3. `preload/index.ts` — `ALLOWED_CLIENT_EVENTS`

[`packages/cowork-core/src/preload/index.ts`](../../packages/cowork-core/src/preload/index.ts) (L52-68). **누락 시 preload가 이벤트를 차단**한다(필수).

```typescript
const ALLOWED_CLIENT_EVENTS: ReadonlySet<string> = new Set<ClientEvent['type']>([
  // ... 기존 ...
  'permission.response',
  'sudo.password.response',
  'askUserQuestion.response', // 추가
  // ...
]);
```

- [ ] allowlist에 `'askUserQuestion.response'` 추가.

---

## 수용 기준

- [ ] index.ts / client-event-utils.ts / preload/index.ts 세 곳 모두 반영.
- [ ] 문자열 `'askUserQuestion.response'`가 세 곳 + [Step 1](10-step1-types.md) union에서 동일.
- [ ] 타입체크 통과(`ClientEvent['type']` 리터럴이 allowlist 제네릭과 일치).
