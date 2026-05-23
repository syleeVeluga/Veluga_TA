# 구현 계획: 파일 인라인 뷰어 (FileViewerPanel)

## Context

현재 ContextPanel의 아티팩트를 클릭하면 OS 파일 탐색기(`showItemInFolder`)가 열린다.
목표는 앱 내에서 바로 파일 내용을 열람할 수 있는 인라인 뷰어 패널을 추가하는 것이다.

참고 레포: [OpenCoworkAI/open-codesign](https://github.com/OpenCoworkAI/open-codesign)

- Electron + React 19 + Vite 6 기반 로컬 AI 디자인 도구
- 동일한 파일 분기 패턴(`previewKindForFile`), PDF를 Chromium 내장으로 처리하는 방식 확인
- **폐쇄망 전제**: 모든 채택 라이브러리는 런타임 CDN 호출 없이 번들만으로 동작해야 함

---

## 채택 라이브러리 (최신 버전 · 폐쇄망 적합성 검증 완료)

| 포맷 | 라이브러리 | 버전 | 라이선스 | 폐쇄망 | 비고 |
| ------- | ---------------------- | --------- | ---------- | ------ | ---------------------------------------------------- |
| 코드 신택스 | `shiki` | **4.1.0** | MIT | ✅ 설정 필요 | TextMate 문법, VS Code 동급 품질 |
| DOCX | `docx-preview` | **0.3.7** | Apache-2.0 | ✅ | 레이아웃·이미지 시각적 충실 렌더링 |
| XLSX 파싱 | `exceljs` | **4.4.0** | MIT | ✅ | npm 정상 배포 (SheetJS npm 0.18.5 freeze 불채택) |
| XLSX UI | `react-spreadsheet` | **0.10.1** | MIT | ✅ | exceljs 파싱 결과를 React 그리드로 렌더링 |
| HTML sanitize | `dompurify` | **3.4.5** | MIT | ✅ | 소스 뷰용, 26 KB 미니파이드 |
| PDF | Electron 내장 Chromium | — | — | ✅ | `<iframe src="file://...">` open-codesign 동일 방식 |
| Markdown | `react-markdown` (기존) | 기존 | MIT | ✅ | `MessageMarkdown` 컴포넌트 재사용 |
| 이미지 | native `<img>` | — | — | ✅ | |
| 텍스트·CSV | 순수 JS 파싱 | — | — | ✅ | |
| HTML | sandboxed `<iframe srcDoc>` | — | — | ✅ | 스크립트 실행 포함 프리뷰 |
| PPTX | OS 위임 유지 | — | — | — | 순수 JS 렌더러 없음 |

### shiki 폐쇄망 설정 (필수)

기본 shiki는 언어 문법을 동적 import하지만 Vite가 번들에 포함시킴. WASM만 명시 설정 필요:

```ts
import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

const highlighter = await createHighlighterCore({
  themes: [import('@shikijs/themes/github-dark')],
  langs: [...],                                        // 필요한 언어만 명시
  engine: createOnigurumaEngine(import('shiki/wasm')), // Vite가 WASM 번들에 포함
})
```

---

## 아키텍처: 4번째 패널 슬라이드인

```text
[Sidebar] [ChatView] [ContextPanel] [FileViewerPanel ← 신규]
```

- 파일 클릭 → FileViewerPanel이 오른쪽에 슬라이드인 (기본 너비 520px, 리사이즈 가능)
- ContextPanel 유지 (닫히지 않음)
- X 버튼으로 `fileViewerPath = null` → 패널 사라짐
- open-codesign의 `previewKindForFile()` 패턴 채택: Set 기반 확장자 분기

---

## 수정 파일 (5개)

### 1. `packages/cowork-core/src/main/index.ts`

기존 `revealFileInFolder()`의 경로 검증 로직 재사용:

```ts
ipcMain.handle('artifacts.readFileContent', async (_event, filePath: string) => {
  if (!isAbsolute(filePath)) return null;
  try {
    const buf = fs.readFileSync(filePath);
    return { buffer: buf.toString('base64'), ext: path.extname(filePath).toLowerCase(), name: path.basename(filePath) };
  } catch { return null; }
});
```

### 2. `packages/cowork-core/src/renderer/store/index.ts`

```ts
fileViewerPath: null as string | null,
setFileViewerPath: (path: string | null) => set({ fileViewerPath: path }),
```

### 3. `packages/cowork-core/src/renderer/components/ContextPanel.tsx`

아티팩트 클릭 핸들러 교체 (lines 366–376):

```ts
const OS_ONLY_EXTS = new Set(['.pptx', '.ppt', '.zip', '.exe', '.dmg'])
// onClick:
if (OS_ONLY_EXTS.has(ext)) {
  await window.electronAPI.showItemInFolder(artifactPath, cwd);
} else {
  setFileViewerPath(artifactPath);
}
```

### 4. `packages/cowork-core/src/renderer/App.tsx`

```tsx
{/* 기존 */}
{activeSessionId && !showSettings && <ContextPanel />}
{/* 추가 */}
{activeSessionId && !showSettings && (
  <Suspense fallback={null}>
    <PanelErrorBoundary>
      <FileViewerPanel />
    </PanelErrorBoundary>
  </Suspense>
)}
```

### 5. `packages/cowork-core/package.json`

추가: `shiki`, `docx-preview`, `exceljs`, `react-spreadsheet`, `dompurify`
추가(dev): `@types/dompurify`

---

## 신규 파일 (9개)

```text
packages/cowork-core/src/renderer/
├── utils/preview-kind.ts            ← previewKindForFile() Set 기반 분기 유틸
└── components/
    ├── FileViewerPanel.tsx           ← 패널 쉘 (헤더, 닫기, 라우팅, lazy 로딩)
    └── viewer/
        ├── CodeViewer.tsx            ← shiki codeToHtml()
        ├── MarkdownViewer.tsx        ← MessageMarkdown 래퍼
        ├── ImageViewer.tsx           ← <img src="file://...">
        ├── PdfViewer.tsx             ← <iframe src="file://..."> (Chromium 내장)
        ├── HtmlViewer.tsx            ← <iframe srcDoc sandbox="allow-scripts">
        ├── CsvViewer.tsx             ← split 파싱 → <table>
        ├── DocxViewer.tsx            ← docx-preview renderAsync
        └── XlsxViewer.tsx            ← exceljs.load → react-spreadsheet
```

---

## preview-kind.ts 핵심 로직 (open-codesign 패턴 채택)

```ts
const CODE_EXTS  = new Set(['.ts','.tsx','.js','.jsx','.py','.go','.rs','.java','.css','.yaml','.json','.toml','.sh'])
const IMAGE_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.svg','.webp','.ico'])
const TEXT_EXTS  = new Set(['.txt','.log','.env'])

export type PreviewKind = 'markdown'|'code'|'image'|'pdf'|'html'|'csv'|'docx'|'xlsx'|'text'|'unsupported'

export function previewKindForFile(filePath: string): PreviewKind {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.md')                      return 'markdown'
  if (CODE_EXTS.has(ext))                 return 'code'
  if (IMAGE_EXTS.has(ext))               return 'image'
  if (ext === '.pdf')                     return 'pdf'
  if (ext === '.html' || ext === '.htm')  return 'html'
  if (ext === '.csv'  || ext === '.tsv')  return 'csv'
  if (ext === '.docx')                    return 'docx'
  if (ext === '.xlsx' || ext === '.xls')  return 'xlsx'
  if (TEXT_EXTS.has(ext))                return 'text'
  return 'unsupported'
}
```

---

## FileViewerPanel 골격

```tsx
export function FileViewerPanel() {
  const { fileViewerPath, setFileViewerPath } = useStore()
  if (!fileViewerPath) return null

  const kind = previewKindForFile(fileViewerPath)
  const ViewerComponent = VIEWER_MAP[kind]   // lazy import map

  return (
    <aside className="w-[520px] flex-shrink-0 flex flex-col border-l bg-background">
      <header className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium truncate">{path.basename(fileViewerPath)}</span>
        <button onClick={() => setFileViewerPath(null)}>✕</button>
      </header>
      <div className="flex-1 overflow-auto">
        {ViewerComponent
          ? <Suspense fallback={<Spinner />}><ViewerComponent filePath={fileViewerPath} /></Suspense>
          : <UnsupportedViewer onOpenExternal={() => window.electronAPI.showItemInFolder(fileViewerPath)} />
        }
      </div>
    </aside>
  )
}
```

---

## HTML 뷰어 보안 설계

open-codesign 패턴 참고:

- 워크스페이스 파일(Claude가 생성한 HTML)은 신뢰도 높음 → 스크립트 실행 허용
- **단, `allow-same-origin` 미포함 → 부모 DOM/IPC 접근 불가**

```tsx
// HtmlViewer.tsx
export function HtmlViewer({ filePath }: { filePath: string }) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    window.electronAPI.readFileContent(filePath).then(r => {
      setHtml(r ? Buffer.from(r.buffer, 'base64').toString('utf-8') : '')
    })
  }, [filePath])

  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts"
      className="w-full h-full border-0"
    />
  )
}
```

"소스 보기" 토글 → `<CodeViewer ext=".html">` 로 전환 가능.

---

## 검증 방법

| 파일 유형 | 확인 항목 |
| --------- | --------- |
| `.md` | 수식·표·코드블록 렌더링 |
| `.ts` / `.py` / `.json` | shiki 신택스 하이라이팅 |
| `.png` / `.jpg` / `.svg` | 이미지 정상 표시 |
| `.pdf` | Chromium PDF 뷰어, 스크롤 동작 |
| `.html` | 스크립트 실행, 부모 DOM 접근 불가 확인 |
| `.csv` | 한글 내용 포함 표 렌더링 |
| `.docx` | 레이아웃·이미지 보존 |
| `.xlsx` | 멀티시트 탭 전환 |
| `.pptx` | 기존처럼 OS 탐색기 열림 (회귀 없음) |
| 닫기 버튼 | 패널 사라짐, ContextPanel 정상 표시 |
| 에러 케이스 | 권한 없는 파일 → ErrorBoundary 메시지 |
| **폐쇄망** | 인터넷 차단 환경에서 전 포맷 정상 동작 |
