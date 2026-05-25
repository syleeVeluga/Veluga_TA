# FileViewerPanel — Overview

## 배경
ContextPanel의 아티팩트 클릭이 OS 탐색기를 여는 현재 동작을, 앱 내부 4번째 슬라이드인 패널로 전환한다.
폐쇄망 운영 환경을 전제로 모든 라이브러리는 번들만으로 동작해야 한다 (런타임 CDN 호출 0).

## 설계 원칙
1. 모든 신규 코드는 단일 격리 폴더 `packages/cowork-core/src/renderer/features/file-viewer/`에 닫힌다.
2. 상태는 기존 `useAppStore` 무수정, 독립 `useFileViewerStore`를 둔다.
3. 외부 모듈 침범은 4파일·총 15 LOC 이하.
4. 신규 의존성은 단계별 점진 도입. 각 단계는 독립 머지 가능.

## 격리 폴더 구조

```text
packages/cowork-core/src/renderer/features/file-viewer/
├── index.ts                       # 외부 공개 표면 (3개만 export: <FileViewerPanel/>, openFileInViewer, OS_ONLY_EXTS)
├── FileViewerPanel.tsx            # 패널 쉘 (헤더, 닫기, 라우팅, lazy 로딩)
├── store.ts                       # 독립 useFileViewerStore (Zustand)
├── preview-kind.ts                # previewKindForFile() — Set 기반 분기
├── types.ts                       # PreviewKind, ReadFileResult
├── viewer-map.ts                  # kind → lazy(import('./viewers/*')) 매핑
├── viewers/
│   ├── TextViewer.tsx
│   ├── MarkdownViewer.tsx
│   ├── ImageViewer.tsx
│   ├── PdfViewer.tsx
│   ├── HtmlViewer.tsx
│   ├── CsvViewer.tsx
│   ├── CodeViewer.tsx             # Stage 2
│   ├── DocxViewer.tsx             # Stage 4
│   ├── XlsxViewer.tsx             # Stage 5
│   └── UnsupportedViewer.tsx
└── ipc/
    ├── main-handler.ts            # ipcMain.handle 등록 함수
    └── preload-binding.ts         # window.electronAPI.fileViewer.* 노출
```

## 외부 wire-up 지점

마운트 (1지점):

| 파일 | 변경 LOC |
|------|---------|
| `packages/cowork-core/src/renderer/App.tsx` | ~8 |

IPC 등록 (2지점):

| 파일 | 변경 LOC |
|------|---------|
| `packages/cowork-core/src/main/index.ts` | ~2 |
| `packages/cowork-core/src/preload/index.ts` | ~2 |

**사용자 진입점 (5지점)** — 모두 `showItemInFolder`를 직접 호출 중. 격리 폴더에서 export하는 단일 라우터 `openFileFromUI(path, cwd?)`로 일괄 교체:

| 진입점 | 파일:라인 | 현재 동작 | FileViewerPanel 대상? |
|--------|----------|----------|----------------------|
| ContextPanel 아티팩트 클릭 | `components/ContextPanel.tsx:366` | `showItemInFolder` | 예 |
| ContextPanel 최근 파일 (같은 핸들러 재사용) | `components/ContextPanel.tsx:366` 공유 | `showItemInFolder` | 예 |
| ContextPanel CWD 링크 | `components/ContextPanel.tsx:401` | `showItemInFolder` | **아니오 (폴더)** |
| 채팅 메시지 — markdown `file://`/절대경로 링크 | `components/message/ContentBlockView.tsx:116-152` | `showItemInFolder` | 예 |
| 채팅 메시지 — 인라인 코드 파일 멘션 | `components/message/ContentBlockView.tsx:52-87` | `showItemInFolder` | 예 |
| (참고) Settings 메모리 파일 경로 | `SettingsMemory.tsx:784, 894` | `showItemInFolder` | 아니오 (현 유지) |

### 사용자 진입 시나리오 — 각 뷰어는 언제 열리나
- **MarkdownViewer**: ContextPanel에서 `.md` 아티팩트 클릭, 또는 채팅 메시지 안에서 `[design.md](./design.md)` 같은 링크 클릭, 또는 인라인 코드 `` `README.md` `` 클릭 시.
- **CodeViewer (Stage 2)**: ContextPanel/최근 파일/채팅 내 코드 확장자(.ts/.py/.json/.yaml 등) 클릭. 사용자가 "Claude가 어떤 파일을 수정했나"를 빠르게 확인하는 가장 빈번한 경로.
- **ImageViewer**: ContextPanel에 노출된 생성/스크린샷 이미지, 또는 채팅 메시지 내 이미지 파일 링크 클릭.
- **PdfViewer**: 사용자가 도구 실행 결과로 생성된 `.pdf` 아티팩트, 또는 채팅에서 언급된 PDF 경로 클릭.
- **HtmlViewer**: Claude가 생성한 미리보기용 `.html` 결과물을 즉시 렌더링하기 위한 진입. 채팅의 HTML 링크 또는 ContextPanel 아티팩트.
- **CsvViewer**: 도구 출력 CSV/TSV 아티팩트, 또는 채팅에서 데이터 파일 경로 멘션.
- **DocxViewer (Stage 4) / XlsxViewer (Stage 5)**: 사용자가 ContextPanel에서 직접 클릭하거나 채팅에 첨부된 office 파일 경로 클릭.
- **UnsupportedViewer (OS_ONLY_EXTS)**: 위 모든 진입점에서 `.pptx`/`.zip`/`.exe`/`.dmg`는 기존 OS 탐색기 동작 유지 (회귀 없음).
- **CWD 링크**: 폴더이므로 항상 OS 탐색기 (FileViewerPanel 대상 아님).

## 단계 요약

| Stage | 범위 | 신규 deps | 독립 머지 |
|-------|------|----------|----------|
| 0 | 인프라 스캐폴드, 독립 스토어, IPC, 외부 wire-up | — | OK |
| 1 | MVP 뷰어 6종 (md/text/csv/pdf/html/image) | — | OK |
| 2 | CodeViewer | shiki | OK |
| 3 | HTML 소스 토글 + sanitize | dompurify | OK |
| 4 | DocxViewer | docx-preview | OK |
| 5 | XlsxViewer | exceljs, react-spreadsheet | OK |
| 6 | 폴리시 + 폐쇄망 회귀 | — | OK |

## 비목표
- PPTX 인라인 렌더 (OS 위임 유지)
- 파일 편집
- 50MB 초과 파일 처리 (별도 계획)

## 롤백 전략
- 단계별 커밋 revert로 부분 비활성 가능.
- 전체 비활성화: `App.tsx`에서 `<FileViewerPanel/>` 한 줄 주석.

## 공통 검증 명령
- 빌드: `pnpm --filter cowork-core build`
- 개발: `pnpm --filter cowork-core dev`
- 타입: `pnpm --filter cowork-core typecheck`
- 폐쇄망: OS 방화벽 차단 후 시나리오 재실행

## 단계별 문서
- [Stage 0 — 인프라](10-stage-0-infra.md)
- [Stage 1 — MVP 뷰어](20-stage-1-mvp.md)
- [Stage 2 — CodeViewer](30-stage-2-code.md)
- [Stage 3 — HTML 소스 토글](40-stage-3-html.md)
- [Stage 4 — DocxViewer](50-stage-4-docx.md)
- [Stage 5 — XlsxViewer](60-stage-5-xlsx.md)
- [Stage 6 — 폴리시 & 회귀](70-stage-6-polish.md)
