# 60 — Step 6: 인라인 패널 UI

> 상위 인덱스: [README.md](README.md) · 이전: [50-step5-renderer-state.md](50-step5-renderer-state.md) · 다음: [70-step7-i18n.md](70-step7-i18n.md)

**목표**: 참조 이미지처럼 **Composer 위에 붙는 인라인 패널**(모달 아님)을 만들고 ChatView에 삽입한다. 과거 메시지용 [`message/AskUserQuestionBlock.tsx`](../../packages/cowork-core/src/renderer/components/message/AskUserQuestionBlock.tsx)의 렌더 스타일을 재사용하되 **인터랙티브**로 확장.

**완료 정의(DoD)**: 인라인 위치가 이미지와 동일(Composer 바로 위). 과거 메시지 `AskUserQuestionBlock` 렌더 무영향. 모든 입력 경로(선택/기타/건너뛰기/자유텍스트)가 [Step 5](50-step5-renderer-state.md)의 `respondToQuestion`으로 전달.

> 라인 번호는 *구현 시 재확인*.

---

## 1. 신규 컴포넌트 `AskUserQuestionPanel.tsx`

**경로**: `packages/cowork-core/src/renderer/components/AskUserQuestionPanel.tsx` (신규). props: `{ request: AskUserQuestionRequest }`.

> 참고: read-only 블록은 `components/message/AskUserQuestionBlock.tsx`(message 하위)에 있다. 신규 인터랙티브 패널은 Composer 인접 컴포넌트이므로 `components/` 직하에 둔다.

### 재사용 스타일 (AskUserQuestionBlock)

- 헤더: `HelpCircle`(lucide-react) 아이콘 + 그라데이션 컨테이너(`border-accent/30 bg-gradient-to-br from-accent/5`).
- 질문 헤더 배지: `bg-accent/10 text-accent text-xs font-semibold rounded uppercase`.
- 옵션 행: 번호 박스 + `label` + `description`. block은 `getOptionLetter`(A,B,C)를 쓰지만, 이미지 요구대로 **숫자(1,2,3)** 버튼으로 한다.

### 인터랙티브 확장

- **질문 페이저**: `questions.length > 1`이면 헤더 우측에 `t('askUserQuestion.pager', { current: idx+1, total })` + ‹ › 네비 + X(전체 건너뛰기 = 모든 질문 `skipped:true`로 제출).
- **옵션 버튼**: `multiSelect`면 체크 토글(다중), 아니면 단일선택. 단일선택 시 `selectedLabels: [label]`.
- **단일선택 + 단일질문**: 옵션 클릭 즉시 제출(이미지의 `→`). 그 외에는 마지막 질문까지 누적 후 제출.
- **`기타`(연필 아이콘) 행**: 클릭 시 해당 질문에 인라인 텍스트 입력 활성화 → `customText`.
- **`건너뛰기` 버튼**: 현재 질문 `skipped: true`.
- **`또는 직접 답장...` textarea**: 자유 응답 → `customText`(옵션 무시).
- 상태: 질문별 답안을 로컬 `useState<AskUserQuestionAnswer[]>`로 누적(인덱스 정렬).

### 골격

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Pencil, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { AskUserQuestionRequest, AskUserQuestionAnswer } from '../types';
import { useIPC } from '../hooks/useIPC';

export function AskUserQuestionPanel({ request }: { request: AskUserQuestionRequest }) {
  const { t } = useTranslation();
  const { respondToQuestion } = useIPC();
  const { toolUseId, questions } = request;
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<AskUserQuestionAnswer[]>(
    questions.map(() => ({ selectedLabels: [] }))
  );

  const isLast = idx === questions.length - 1;
  const single = questions.length === 1 && !questions[0].multiSelect;

  const submit = (final: AskUserQuestionAnswer[]) => respondToQuestion(toolUseId, final);
  const skipAll = () => submit(questions.map(() => ({ selectedLabels: [], skipped: true })));
  // 옵션 선택/체크 토글/기타/건너뛰기/직접답장 핸들러 → answers[idx] 갱신 후
  //   single이면 즉시 submit, 아니면 isLast에서 submit, 그 외 setIdx(idx+1)

  return (
    <div className="rounded-xl border-2 border-accent/30 bg-gradient-to-br from-accent/5 to-transparent ...">
      {/* 헤더 + (questions.length>1 ? 페이저/‹›/X : null) */}
      {/* 현재 질문 header 배지 + question */}
      {/* 옵션 번호 버튼들 (multiSelect 토글 / 단일선택) */}
      {/* 기타(연필) 행 → 인라인 input */}
      {/* 건너뛰기 버튼 */}
      {/* 또는 직접 답장... textarea + 전송 */}
    </div>
  );
}
```

- [ ] 컴포넌트 생성(헤더/페이저/옵션/기타/건너뛰기/자유텍스트).
- [ ] 단일선택+단일질문 즉시 제출, 그 외 누적 후 제출.
- [ ] i18n 키 사용([Step 7](70-step7-i18n.md)).

---

## 2. ChatView 삽입

[`packages/cowork-core/src/renderer/components/ChatView.tsx`](../../packages/cowork-core/src/renderer/components/ChatView.tsx)

- `usePendingDialogs()`에서 `pendingQuestion` 구독(이 컴포넌트가 첫 소비자). `activeSessionId`는 기존 `useActiveSessionId()`.
- Composer 컨테이너(L775, `flex items-end ... rounded-[1.75rem]`) **바로 위**(파일첨부 블록 L773과 textarea 컨테이너 사이)에 삽입. `max-w-[920px] mx-auto` 폭 유지.

```tsx
{pendingQuestion && pendingQuestion.sessionId === activeSessionId && (
  <AskUserQuestionPanel request={pendingQuestion} />
)}
```

- [ ] `usePendingDialogs()` 구독 추가.
- [ ] Composer 컨테이너 바로 위에 조건부 렌더 삽입(세션 일치 가드).

---

## 수용 기준

- [ ] 패널이 모달이 아니라 ChatView 인라인(Composer 위)으로 뜬다.
- [ ] 세션 불일치 시 렌더 안 됨.
- [ ] 과거 메시지 `AskUserQuestionBlock` 렌더가 깨지지 않는다(별도 컴포넌트).
- [ ] 타입체크 통과.
