# Stage 4 — DocxViewer

## 목표
.docx 파일을 레이아웃·이미지 보존하여 렌더한다.

## 작업
1. `package.json` deps: `docx-preview@0.3.7`
2. `viewers/DocxViewer.tsx`:
   - `renderAsync(arrayBuffer, containerRef.current)` 호출
   - base64 → ArrayBuffer 변환은 `features/file-viewer/utils/base64.ts`에 격리
3. `viewer-map.ts`에서 `docx` 활성화

## 영향 파일
- 신규: `viewers/DocxViewer.tsx`, `utils/base64.ts`
- 수정: `viewer-map.ts`, `package.json`

## 검증
- 본문/이미지/표/스타일 렌더링
- 한글 폰트 정상 표시
- 페이지 분할 또는 연속 스크롤
- 50MB 리밋 내 동작, 초과 시 명시적 메시지
- 손상된 docx → ErrorBoundary (앱 크래시 없음)

## 체크리스트
- [ ] 표준 docx 렌더 정상
- [ ] 한글 본문/제목 표시
- [ ] 이미지 인라인 표시
- [ ] 표 레이아웃 보존
- [ ] 10MB+ docx 렌더 동작
- [ ] 손상 파일 → ErrorBoundary 메시지
- [x] `renderAltChunks: false`로 DOCX 내 embedded HTML 렌더링 비활성화
- [x] `npm run test -- file-viewer-docx` 통과
- [x] `npm run typecheck` 통과

## 롤백
`viewer-map.ts`의 `docx` 키만 unsupported로 되돌리고 docx-preview 제거.
