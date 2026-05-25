# Stage 1 — MVP 뷰어 (신규 deps 0개)

## 목표
신규 npm 의존성 없이 6개 포맷을 렌더한다: md, text, csv, pdf, html, image. 이 단계 종료 시 패널이 실제로 "쓸 만한" 상태가 된다.

## 작업
1. **6개 뷰어** (`features/file-viewer/viewers/`):
   - `TextViewer`: base64 → utf-8 → `<pre>` (.txt/.log/.env)
   - `MarkdownViewer`: 기존 `MessageMarkdown` **재사용** — `<MessageMarkdown normalizedText={text} />`
   - `ImageViewer`: `<img src={\`file://${filePath}\`} />` (IPC 우회)
   - `PdfViewer`: `<iframe src="file://...">` (Chromium 내장)
   - `HtmlViewer`: `<iframe srcDoc sandbox="">` — 스크립트 실행과 `allow-same-origin` 모두 미허용
   - `CsvViewer`: 순수 JS RFC 4180 최소 파싱 → `<table>`
   - `UnsupportedViewer`: OS 탐색기 열기 버튼
2. `viewer-map.ts` — `kind → React.lazy()` 매핑. Stage 2~5 키는 미리 자리만 잡고 `UnsupportedViewer` fallback.
3. `FileViewerPanel.tsx` 완성: 헤더 + 닫기 + `Suspense` + 라우팅
4. **사용자 진입점 5곳을 `openFileFromUI()`로 일괄 교체** — 각 콜사이트의 `showItemInFolder(path, cwd)` 직접 호출을 한 줄로 치환:
   ```tsx
   import { openFileFromUI } from '@renderer/features/file-viewer'
   // 기존: await window.electronAPI.showItemInFolder(p, cwd)
   await openFileFromUI(p, cwd)
   ```
   교체 대상:
   - `components/ContextPanel.tsx:366` — 아티팩트/최근 파일 클릭 (같은 핸들러 공유)
   - `components/message/ContentBlockView.tsx:116-152` — 메시지 내 markdown `file://`/절대경로 링크
   - `components/message/ContentBlockView.tsx:52-87` — 인라인 코드 파일 멘션
5. **교체하지 않는 곳** (의도적):
   - `ContextPanel.tsx:401` — CWD 링크는 폴더이므로 `showItemInFolder` 유지
   - `SettingsMemory.tsx:784, 894` — 설정 파일 경로는 OS 탐색기 유지 (정책 결정에 따라 차후 포함 가능)
   - `ContentBlockView.tsx:163-164` — 외부 http(s) 링크 `openExternal` 유지

## 영향 파일
- 신규: `viewers/` 7개 (Unsupported 포함), `viewer-map.ts` 완성, `FileViewerPanel.tsx` 라우팅
- 수정: `components/ContextPanel.tsx` (~3 LOC), `components/message/ContentBlockView.tsx` (~4 LOC, 콜사이트 2곳)

## 검증

| 파일 | 확인 |
|------|------|
| `.md` | 수식·표·코드블록 |
| `.txt`/`.log`/`.env` | 텍스트 표시 |
| `.png`/`.jpg`/`.svg` | 이미지 인라인 |
| `.pdf` | Chromium 뷰어 |
| `.html` | HTML 렌더링, 스크립트 미실행, 부모 DOM 접근 차단 |
| `.csv`/`.tsv` | 한글 포함 표, 따옴표 안 쉼표 |
| `.pptx`/`.zip` | OS 탐색기 (회귀 없음) |

## 체크리스트

### 뷰어별 렌더 (사용자 진입 시 실제 열림 확인)
- [ ] **MarkdownViewer**: ContextPanel에서 `.md` 클릭, 채팅 markdown 링크 `[x](./a.md)` 클릭, 인라인 코드 `` `README.md` `` 클릭 — 3경로 모두 동일 패널에서 열림
- [ ] **TextViewer**: `.txt`/`.log`/`.env` — ContextPanel + 채팅 양쪽에서 열림
- [ ] **ImageViewer**: `.png`/`.jpg`/`.svg`/`.webp` — ContextPanel + 채팅 양쪽에서 열림
- [ ] **PdfViewer**: `.pdf` — Chromium 뷰어, 스크롤/확대
- [ ] **HtmlViewer**: `.html` — 렌더링 O, 스크립트 실행 X, **부모 DOM 접근 X**
- [ ] **CsvViewer**: `.csv`/`.tsv` — 한글 포함 표, 따옴표 안 쉼표
- [ ] **UnsupportedViewer (OS_ONLY_EXTS)**: `.pptx`/`.zip`/`.exe`/`.dmg` — OS 탐색기로 빠짐 (회귀 없음)

### 진입점 5곳 일관성
- [ ] ContextPanel 아티팩트 클릭 → `openFileFromUI` 라우팅
- [ ] ContextPanel 최근 파일 클릭 → `openFileFromUI` 라우팅 (같은 핸들러)
- [ ] 채팅 메시지 markdown 파일 링크 → `openFileFromUI`
- [ ] 채팅 메시지 인라인 코드 파일 멘션 → `openFileFromUI`
- [ ] CWD 링크 → `showItemInFolder` 유지 (회귀 없음, 폴더이므로 패널 대상 아님)
- [ ] Settings 메모리 경로 → `showItemInFolder` 유지 (정책)
- [ ] 외부 http(s) 링크 → `openExternal` 유지

### 패널 동작
- [ ] X 버튼 → 패널 사라지고 ContextPanel 정상
- [ ] 패널 열린 상태에서 다른 파일 클릭 → 내용 교체
- [ ] 500KB 텍스트 파일 렌더 1초 이내
- [ ] **`package.json` diff = 비어 있음** (신규 deps 0개)

## 롤백
이 단계 커밋만 revert. Stage 0 인프라는 유지되며 패널은 빈 쉘로 복귀.
