# 70 — Step 7: i18n

> 상위 인덱스: [README.md](README.md) · 이전: [60-step6-renderer-panel.md](60-step6-renderer-panel.md) · 다음: [90-verification.md](90-verification.md)

**대상 파일**: [`packages/cowork-core/src/renderer/i18n/locales/en.json`](../../../packages/cowork-core/src/renderer/i18n/locales/en.json) · [`ko.json`](../../../packages/cowork-core/src/renderer/i18n/locales/ko.json)

**목표**: `permission`/`sudo` 네임스페이스 스타일(플랫, 1~2단계 중첩, `{{var}}` 보간)을 따라 `askUserQuestion` 네임스페이스를 추가한다.

**완료 정의(DoD)**: en/ko 키 구조 동일, 누락 키 없음, [Step 6](60-step6-renderer-panel.md) 패널이 참조하는 모든 키 존재.

---

## 1. `askUserQuestion` 네임스페이스 추가

기존 `permission`/`sudo` 네임스페이스 옆에 추가.

`ko.json`:
```json
"askUserQuestion": {
  "title": "질문",
  "other": "기타",
  "skip": "건너뛰기",
  "skipAll": "모두 건너뛰기",
  "orDirect": "또는 직접 답장...",
  "pager": "{{total}}개 중 {{current}}개",
  "send": "보내기",
  "next": "다음",
  "prev": "이전",
  "customPlaceholder": "직접 입력..."
}
```

`en.json`:
```json
"askUserQuestion": {
  "title": "Question",
  "other": "Other",
  "skip": "Skip",
  "skipAll": "Skip all",
  "orDirect": "Or reply directly...",
  "pager": "{{current}} of {{total}}",
  "send": "Send",
  "next": "Next",
  "prev": "Back",
  "customPlaceholder": "Type your answer..."
}
```

- [ ] `ko.json`에 `askUserQuestion` 네임스페이스 추가.
- [ ] `en.json`에 동일 키 구조로 추가.

> 키 목록은 [Step 6](60-step6-renderer-panel.md) 패널 구현과 동기화한다. 패널에서 새 문자열을 쓰면 두 파일 모두에 키를 추가.

---

## 수용 기준

- [ ] en/ko 키 집합이 동일(한쪽에만 있는 키 없음).
- [ ] 패널이 `t('askUserQuestion.*')`로 참조하는 키가 모두 존재.
- [ ] `pager`의 `{{current}}`/`{{total}}` 보간 변수명이 패널 호출과 일치.
