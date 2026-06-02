# 90 — 검증 방법

> 상위 인덱스: [README.md](README.md) · 이전: [70-step7-i18n.md](70-step7-i18n.md)

**목표**: 타입/빌드, 수동 E2E, 회귀, 단위 테스트로 기능과 무영향을 함께 확인한다.

> 명령은 **루트 기준**. 원안의 `pnpm --filter cowork-core ...`는 실제 스크립트와 다르므로 아래로 교정.

---

## 1. 타입 / 빌드

- [ ] 루트 `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) — `ServerEvent`/`ClientEvent` union, `ToolDefinition` 시그니처, allowlist 제네릭 통과.
- [ ] cowork-core `lint` (`eslint src --ext .ts,.tsx`).
- [ ] (옵션) 루트 `npm run verify` (typecheck + test).

---

## 2. 수동 E2E (핵심)

앱 실행 후, 모델이 결정을 필요로 하는 프롬프트(예: "견적 금액을 조정할지 나한테 물어봐줘") 입력 → 에이전트가 `AskUserQuestion` 호출 → **Composer 위 인라인 패널** 등장 확인.

- [ ] 단일선택 옵션 클릭 → **즉시 제출**되고 에이전트가 선택값을 반영해 진행.
- [ ] 다중 질문 페이저 ‹ › 이동, 각 질문 응답 누적 후 마지막에 제출.
- [ ] `기타` 직접입력(`customText`)이 에이전트에 텍스트로 전달.
- [ ] `건너뛰기`(`skipped`) 시 해당 질문이 "(건너뜀)"으로 전달.
- [ ] `또는 직접 답장...` 자유텍스트가 전달.
- [ ] 타임아웃(임시로 짧게) / 세션 stop 시 패널이 닫히고 pending이 정리.

> 패키징된 앱 GUI 실행 검증 시 `ELECTRON_RUN_AS_NODE=1` 환경변수를 먼저 해제할 것(셸 기본값일 수 있음).

---

## 3. 회귀

- [ ] 기존 `AskUserQuestionBlock` 과거 메시지 렌더가 깨지지 않음(툴명 `AskUserQuestion` 유지).
- [ ] 권한/sudo 다이얼로그 영향 없음(동일 패턴 공유하나 별도 Map/상태).
- [ ] 콜백 미주입 경로(예: 다른 러너 구성)에서 툴 미등록 → 기존 동작 그대로.

---

## 4. 단위 테스트 (Vitest, `packages/cowork-core/tests/`)

- [ ] **기존 통과 유지**: [`tests/message-card-ask-user-question-state.test.ts`](../../packages/cowork-core/tests/message-card-ask-user-question-state.test.ts) — *historical block은 read-only*임을 검증. 신규 인터랙티브 패널은 별도 컴포넌트이므로 충돌 없음.
- [ ] **신규(권장)**:
  - `requestUserQuestion` resolve: `handleUserQuestionResponse` 호출 시 Promise가 answers로 resolve되고 Map이 비워지는지.
  - 타임아웃: 60초(테스트는 fake timer) 경과 시 skip 응답으로 resolve + `askUserQuestion.dismiss` 송신.
  - `formatAnswersForModel`: 라벨/customText/skipped 표기 포맷 검증([30 §2](30-step3-agent-runner.md)).

---

## 완료 체크리스트 (전체)

- [ ] Step 1 타입 → [10](10-step1-types.md)
- [ ] Step 2 SessionManager → [20](20-step2-session-manager.md)
- [ ] Step 3 agent-runner → [30](30-step3-agent-runner.md)
- [ ] Step 4 IPC 배선 → [40](40-step4-ipc-wiring.md)
- [ ] Step 5 렌더러 상태 → [50](50-step5-renderer-state.md)
- [ ] Step 6 인라인 패널 → [60](60-step6-renderer-panel.md)
- [ ] Step 7 i18n → [70](70-step7-i18n.md)
- [ ] 타입체크/빌드 · 수동 E2E · 회귀 · 단위 테스트 통과
