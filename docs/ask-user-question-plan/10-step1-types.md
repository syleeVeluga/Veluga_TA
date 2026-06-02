# 10 — Step 1: 타입 추가

> 상위 인덱스: [README.md](README.md) · 개요: [00-overview.md](00-overview.md) · 다음: [20-step2-session-manager.md](20-step2-session-manager.md)

**대상 파일**: [`packages/cowork-core/src/renderer/types/index.ts`](../../packages/cowork-core/src/renderer/types/index.ts) (단일 출처)

**목표**: 요청/응답 페이로드 타입을 정의하고 `ServerEvent`/`ClientEvent` union에 이벤트를 추가한다. 이후 모든 단계(메인/렌더러)가 이 타입을 import한다.

**완료 정의(DoD)**: `npm run typecheck` 통과, `any` 미사용, union 멤버 형식이 기존 `permission.*`/`sudo.*`와 일관.

> 라인 번호는 *구현 시 재확인*. 현재 검증 기준 라인을 적어둔다.

---

## 1. 기존 타입 재사용 확인 (수정 없음)

`QuestionItem` / `QuestionOption`(L431-441)을 **그대로 사용**한다. ToolDefinition `parameters`와 `AskUserQuestionRequest.questions`가 모두 이 타입을 공유한다.

```typescript
// 이미 존재 — 재사용
export interface QuestionOption {
  label: string;
  description?: string;
}
export interface QuestionItem {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}
```

패턴 모범: 같은 파일의 `PermissionRequest`(L414-419), `SudoPasswordRequest`.

---

## 2. 신규 요청/응답 인터페이스 추가

`PermissionRequest`/`SudoPasswordRequest` 인근(L413-428)에 추가:

```typescript
export interface AskUserQuestionRequest {
  toolUseId: string;
  sessionId: string;
  questions: QuestionItem[];
}

/** 질문별 1개. `AskUserQuestionRequest.questions`와 인덱스 정렬. */
export interface AskUserQuestionAnswer {
  selectedLabels: string[];   // 선택한 옵션 라벨(다중선택 가능)
  customText?: string;        // `기타` 직접입력 또는 `또는 직접 답장...`
  skipped?: boolean;          // 이 질문 건너뜀
}
```

- [ ] `AskUserQuestionRequest` 추가
- [ ] `AskUserQuestionAnswer` 추가

---

## 3. `ServerEvent` union 확장 (L505 부근)

`permission.request`/`permission.dismiss`/`sudo.password.request`/`sudo.password.dismiss` 스타일을 따른다.

```typescript
export type ServerEvent =
  // ... 기존 멤버 ...
  | { type: 'askUserQuestion.request'; payload: AskUserQuestionRequest }
  | { type: 'askUserQuestion.dismiss'; payload: { toolUseId: string } };
```

- [ ] `askUserQuestion.request` 추가
- [ ] `askUserQuestion.dismiss` 추가

---

## 4. `ClientEvent` union 확장 (L450-465)

`permission.response`(`{ toolUseId; result }`) 스타일을 따른다.

```typescript
export type ClientEvent =
  // ... 기존 멤버 ...
  | { type: 'askUserQuestion.response'; payload: { toolUseId: string; answers: AskUserQuestionAnswer[] } };
```

- [ ] `askUserQuestion.response` 추가

---

## 수용 기준

- [ ] `AskUserQuestionRequest`/`AskUserQuestionAnswer` 정의 + 3개 이벤트 멤버 추가.
- [ ] `QuestionItem`/`QuestionOption`은 재정의하지 않고 재사용.
- [ ] `npm run typecheck` 통과(이 단계만으로는 union에 추가만 했으므로 미사용 경고 없음).
