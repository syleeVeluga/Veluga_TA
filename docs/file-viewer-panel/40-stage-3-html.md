# Stage 3 — HTML 소스 토글 + sanitize

## 목표
HTML 뷰어에 Preview/Source 토글을 추가하고, 선택적 sanitize 옵션을 제공한다.

## 작업
1. `package.json` deps: `dompurify@3.4.5`, `@types/dompurify`(dev)
2. `viewers/HtmlViewer.tsx` 토글:
   - `[Preview]`: `sandbox=""`가 적용된 iframe. HTML은 렌더링하지만 스크립트 실행과 부모 DOM/IPC 접근은 허용하지 않는다.
   - `[Source]`: `<CodeViewer ext=".html" content={text} />` (Stage 2 의존)
   - `[Sanitize]` (선택): `DOMPurify.sanitize(html)` 결과를 같은 sandboxed iframe에서 표시. 기본 비활성.
   - 파일 경로가 바뀌면 `Preview` 모드와 sanitize 비활성 상태로 초기화한다.

## 영향 파일
- 수정: `viewers/HtmlViewer.tsx`, `viewers/CodeViewer.tsx`, `package.json`, `package-lock.json`
- 신규 테스트: `tests/file-viewer-html.test.ts`

## 검증
- Preview/Source 토글 동작
- Source 모드에서 shiki 하이라이팅
- Sanitize 토글 시 `<script>` 제거 확인 (테스트용 HTML 파일 준비)
- 다른 HTML 파일을 열면 토글 상태 초기화
- `npm test -- file-viewer-html.test.ts --run`

## 체크리스트
- [x] Preview ↔ Source 전환 동작
- [x] Source 모드 — 코드 하이라이팅 적용
- [x] Sanitize 토글 — `<script>` 제거 확인
- [x] 다른 HTML 파일 열기 시 토글 초기화

## 롤백
`HtmlViewer.tsx`에서 토글 로직 제거, `CodeViewer.tsx`의 HTML 언어 추가 제거, dompurify 의존성 제거. Stage 1 동작으로 복귀.
