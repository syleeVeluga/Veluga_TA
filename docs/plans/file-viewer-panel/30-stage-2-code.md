# Stage 2 — CodeViewer (shiki)

## 목표
코드 파일(.ts/.py/.json/.yaml 등)에 VS Code 동급 신택스 하이라이팅을 폐쇄망에서 동작시킨다.

## 작업
1. `package.json` deps: `shiki@4.1.0`
2. `viewers/CodeViewer.tsx`:
   - 모듈 스코프 싱글톤 `getHighlighter(): Promise<Highlighter>` (Promise 캐시)
   - `createHighlighterCore({ themes: [import('@shikijs/themes/github-dark')], langs: [...], engine: createOnigurumaEngine(import('shiki/wasm')) })`
   - 초기 langs: typescript, tsx, javascript, jsx, python, go, rust, java, json, yaml, toml, bash, css
3. `viewer-map.ts`에서 `code` 키 활성화
4. WASM 번들 검증: `npm run build` 후 `dist/`에 `oniguruma`/`shiki` 청크 포함 확인

## 영향 파일
- 신규: `viewers/CodeViewer.tsx`
- 수정: `viewer-map.ts`, `package.json`

## 검증
- 모든 초기 langs에서 하이라이팅 동작
- **인터넷 차단 환경** 동일 동작 (DevTools Network 탭에서 외부 요청 0)
- 첫 로드 1.5초 이내, 이후 100ms 이내 (싱글톤 동작 확인)
- 정의 외 확장자 → TextViewer로 graceful fallback
- 5MB 코드 파일 → 렌더 또는 "too large to highlight" 명시적 폴백

## 체크리스트
- [x] `.ts`/`.tsx`/`.py`/`.json`/`.yaml`/`.go`/`.rs`/`.java`/`.css` 하이라이팅 동작
- [x] 폐쇄망 동작 확인 (방화벽 차단)
- [x] 빌드 산출물에 WASM 청크 포함
- [x] 싱글톤 캐시 동작 (2번째 파일 100ms 이내)
- [x] 알 수 없는 확장자 fallback 확인
- [x] 5MB+ 파일에 대한 폴백 정책 확인

## 롤백
`viewer-map.ts`에서 `code` 키만 `UnsupportedViewer`로 되돌리면 즉시 비활성. shiki 의존성도 제거 가능.
