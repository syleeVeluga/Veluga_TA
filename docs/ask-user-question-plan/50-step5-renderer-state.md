# 50 — Step 5: 렌더러 상태

> 상위 인덱스: [README.md](README.md) · 이전: [40-step4-ipc-wiring.md](40-step4-ipc-wiring.md) · 다음: [60-step6-renderer-panel.md](60-step6-renderer-panel.md)

**목표**: `pendingPermission`/`pendingSudoPassword` 흐름을 그대로 복제하여 ① 요청 ServerEvent를 store에 담고 ② 응답을 송신하는 콜백을 노출한다.

**완료 정의(DoD)**: 타입체크 통과. `askUserQuestion.dismiss`는 **현재 toolUseId가 일치할 때만** 패널을 닫는다.

> 라인 번호는 *구현 시 재확인*.

---

## 1. store — 상태 + 액션

[`packages/cowork-core/src/renderer/store/index.ts`](../../packages/cowork-core/src/renderer/store/index.ts)

- 상태 필드(L90-94 인근): `pendingQuestion: AskUserQuestionRequest | null;`
- 초기값(L230-231 인근): `pendingQuestion: null,`
- 액션 타입 선언(L158-160 인근): `setPendingQuestion: (request: AskUserQuestionRequest | null) => void;`
- 액션 구현(L547-550 인근, zustand `set`): `setPendingQuestion: (request) => set({ pendingQuestion: request }),`

```typescript
// 상태
pendingPermission: PermissionRequest | null;
pendingSudoPassword: SudoPasswordRequest | null;
pendingQuestion: AskUserQuestionRequest | null;   // 추가

// 구현
setPendingPermission: (permission) => set({ pendingPermission: permission }),
setPendingSudoPassword: (request) => set({ pendingSudoPassword: request }),
setPendingQuestion: (request) => set({ pendingQuestion: request }), // 추가
```

- [ ] 상태/초기값/액션타입/액션구현 4곳 추가.

---

## 2. selector — `usePendingDialogs`

[`packages/cowork-core/src/renderer/store/selectors.ts`](../../packages/cowork-core/src/renderer/store/selectors.ts) (L289-297, `useShallow`).

```typescript
export function usePendingDialogs() {
  return useAppStore(
    useShallow((s) => ({
      pendingPermission: s.pendingPermission,
      pendingSudoPassword: s.pendingSudoPassword,
      pendingQuestion: s.pendingQuestion, // 추가
    }))
  );
}
```

- [ ] `pendingQuestion` 추가.

---

## 3. useIPC — 리스너 + 응답 콜백

[`packages/cowork-core/src/renderer/hooks/useIPC.ts`](../../packages/cowork-core/src/renderer/hooks/useIPC.ts)

### 3a. ServerEvent switch (L198-208, `permission.request`/`permission.dismiss` 인근)

```typescript
case 'askUserQuestion.request':
  store.setPendingQuestion(event.payload);
  break;
case 'askUserQuestion.dismiss': {
  const current = useAppStore.getState().pendingQuestion;
  if (current?.toolUseId === event.payload.toolUseId) {
    store.setPendingQuestion(null);
  }
  break;
}
```

### 3b. 응답 콜백 (L694-703, `respondToPermission` 패턴)

```typescript
const respondToQuestion = useCallback(
  (toolUseId: string, answers: AskUserQuestionAnswer[]) => {
    send({ type: 'askUserQuestion.response', payload: { toolUseId, answers } });
    setPendingQuestion(null);
  },
  [send, setPendingQuestion]
);
```

### 3c. 훅 반환 객체 (L756-774)

```typescript
return {
  // ...
  respondToPermission,
  respondToSudoPassword,
  respondToQuestion, // 추가
  // ...
};
```

- [ ] `askUserQuestion.request`/`askUserQuestion.dismiss` case 추가.
- [ ] `respondToQuestion` 콜백 추가 + `setPendingQuestion` store에서 가져오기.
- [ ] 훅 반환 객체에 `respondToQuestion` 노출.

---

## 수용 기준

- [ ] store 상태/액션, selector, useIPC 리스너/콜백 모두 추가.
- [ ] dismiss는 toolUseId 일치 시에만 닫힘.
- [ ] 타입체크 통과.
