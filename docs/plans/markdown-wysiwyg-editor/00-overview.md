# Markdown WYSIWYG Editor (Milkdown) — Overview

> Status: **설계 단계 (초안)** · 작성 2026-06-03
> Scope: file-viewer 패널의 읽기 전용 `MarkdownViewer`를 "렌더된 화면에서 문서 작성하듯" 편집 가능한 WYSIWYG 에디터로 확장
> 기준 브랜치: `main`

## 배경

현재 [MarkdownViewer.tsx](../../../packages/cowork-core/src/renderer/features/file-viewer/viewers/MarkdownViewer.tsx)는
[MessageMarkdown.tsx](../../../packages/cowork-core/src/renderer/components/MessageMarkdown.tsx)
(`react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-sanitize` + Mermaid 커스텀 `code`)를
재사용한 **읽기 전용** 렌더러다. file-viewer feature는
[file-viewer-panel 계획](../file-viewer-panel/00-overview.md)으로 구축되었고, 그 계획에서 "파일 편집"은 **명시적 비목표**였다.

이 계획은 그 비목표를 해제하여, 사용자가 패널에서 `.md` 파일을 **렌더된 형태 그대로 편집**(Typora/Notion식 WYSIWYG)하고
디스크에 저장할 수 있게 한다. 1차 목표는 "코드/마크업 문법을 의식하지 않고 문서를 쓰듯 편집"이다.

## 목표 / 비목표

**목표**
- 렌더 뷰에서 직접 편집(WYSIWYG): 제목/목록/표/체크박스/코드블록/수식/Mermaid.
- 디스크 원본 `.md`에 저장. 저장 안 한 변경은 dirty 상태로 표시.
- 기존 기능 무회귀: 보기 모드는 지금의 `MessageMarkdown` 경로를 그대로 유지하고, 편집은 opt-in 토글.
- 폐쇄망 전제 유지: 런타임 CDN 호출 0, 번들만으로 동작.

**비목표**
- 실시간 협업(CRDT/Yjs) — 단일 사용자 로컬 편집만.
- `.md` 이외 포맷 편집(code/csv/docx/xlsx는 별도 계획).
- 메모리 설정([SettingsMemory.tsx](../../../packages/cowork-core/src/renderer/components/settings/SettingsMemory.tsx))의 파일 뷰어 편집화(현 `<pre>` 유지). 필요 시 별도 계획.
- 50MB 초과 파일 편집.

## 기술 선택 — 왜 Milkdown인가

| 기준 | **Milkdown (채택)** | BlockNote | CodeMirror(소스) |
|---|---|---|---|
| 편집 방식 | 문서처럼 흐르는 WYSIWYG | 블록형(Notion) | 소스 텍스트 |
| 마크다운 원본 | **remark가 직렬화 코어 = markdown-native** → 라운드트립 안전 | 자체 block JSON, `*Lossy()` | 원본 그대로 |
| 수식(KaTeX) | **공식 `@milkdown/plugin-math`** (이미 쓰는 `katex` 재사용) | 기본 없음 | N/A(프리뷰 측) |
| Mermaid | 커스텀 NodeView로 기존 `MermaidBlock` 재활용 | 기본 없음 | N/A |
| 기존 자산 재사용 | remark 생태계 그대로 이어짐 | 거의 새로 | 프리뷰만 재사용 |
| 1차 목표 부합 | "문서 쓰듯 편집"에 가장 근접 | 블록 UX 위주 | WYSIWYG 아님 |

핵심 근거: 본 앱은 이미 `remark-*`/`rehype-katex`/`mermaid`에 투자했고, **파일이 `.md` 원본(source of truth)**이라
손실 없는 라운드트립 + 수식/Mermaid 유지가 결정적이다. Milkdown은 ProseMirror 기반 WYSIWYG이면서 remark로
마크다운을 직렬화하므로 이 세 가지를 정면으로 만족한다.

## 핵심 제약

1. **저장 IPC 부재** — 현 [main-handler.ts](../../../packages/cowork-core/src/renderer/features/file-viewer/ipc/main-handler.ts)에는
   `file-viewer:read` / `grant-path`만 있고 write가 없다. **`file-viewer:write` 신설이 모든 단계의 선결 조건**(Stage 0).
2. **쓰기 보안 경계** — write는 read 핸들러의 보안 로직(`normalizeInputPath` → 워크스페이스 resolve → `realpath` → `isWithinRoot`)을
   **동일하게 재사용**해 authorizedRoots(workspace roots + 사용자가 명시적으로 연 `grantedDirs`) 밖 쓰기를 차단한다.
3. **폐쇄망 번들-only** — Milkdown/KaTeX CSS·폰트, Mermaid 모두 번들에 포함. 런타임 외부 fetch 금지.
4. **격리 폴더** — 신규 코드는 기존 `features/file-viewer/` 안 `editor/` 서브폴더에 닫는다. 외부 침범 최소화.
5. **frontmatter/round-trip** — 메모리 `.md` 등은 YAML frontmatter·원시 HTML을 포함한다. commonmark 기본 직렬화로는
   유실될 수 있어 보존 장치가 필요(Stage 4).

## 격리 폴더 구조 (제안)

```text
packages/cowork-core/src/renderer/features/file-viewer/
├── viewers/
│   └── MarkdownViewer.tsx          # [수정] 보기/편집 토글 추가
├── editor/                          # [신규] Milkdown 편집 격리
│   ├── MilkdownEditor.tsx           # <Milkdown/> 래퍼 + useEditor 구성
│   ├── milkdown-config.ts           # preset/plugin 조립 (commonmark, gfm, history, listener)
│   ├── theme.ts                     # headless 테마 → Tailwind 토큰 매핑
│   ├── nodes/
│   │   └── mermaid-node.ts          # [Stage 3] Mermaid 커스텀 NodeView
│   ├── frontmatter.ts               # [Stage 4] YAML frontmatter split/merge
│   └── use-doc-save.ts              # dirty 추적 + 저장(write IPC) 훅
├── ipc/
│   ├── main-handler.ts             # [수정] file-viewer:write 추가
│   └── preload-binding.ts          # [수정] write 바인딩 추가
├── types.ts                         # [수정] WriteFileResult 추가
└── store.ts                         # [수정] (필요 시) editMode/dirty 상태
```

## 의존성

| 패키지 | 용도 | 비고 |
|---|---|---|
| `@milkdown/core`, `@milkdown/ctx`, `@milkdown/transformer` | 코어 | 신규 |
| `@milkdown/react` | React 바인딩(`<Milkdown/>`, `useEditor`) | 신규 |
| `@milkdown/preset-commonmark`, `@milkdown/preset-gfm` | 마크다운/GFM | 신규 |
| `@milkdown/plugin-history`, `@milkdown/plugin-listener` | undo/redo, 변경 리스너(dirty) | 신규 |
| `@milkdown/plugin-math` | 수식 | Stage 2, **기존 `katex ^0.16` 재사용** |
| `@milkdown/plugin-slash`, `@milkdown/plugin-block` | 슬래시 메뉴/블록 핸들 | Stage 5 |
| `@milkdown/prose` | ProseMirror 접근(커스텀 노드) | Stage 3 |
| `katex` | 수식 렌더 | **기존 ^0.16.45 재사용** |
| `mermaid` | 다이어그램 | **기존 11.15.0 재사용** |

> Crepe(`@milkdown/crepe`, 배터리 포함 에디터) 대신 조립형(`@milkdown/react` + presets)을 택한다.
> 이유: 플러그인/에셋 로딩을 완전 통제(폐쇄망)하고, Mermaid 커스텀 노드와 테마를 자유롭게 붙이기 위함. Crepe의 개별 기능은 Stage 5에서 차용 검토.

## 외부 wire-up 지점

| 파일 | 변경 | 단계 |
|---|---|---|
| `src/main/index.ts` (또는 file-viewer IPC 등록부) | `file-viewer:write` 등록 | 0 |
| `src/preload/index.ts` | `fileViewer.write` 노출 | 0 |
| `features/file-viewer/viewers/MarkdownViewer.tsx` | 보기/편집 토글, 에디터 마운트 | 1 |
| `features/file-viewer/FileViewerPanel.tsx` | 헤더에 편집/저장 버튼, dirty 표시(선택) | 1 |
| `package.json` | Milkdown deps 추가 | 1,2,3,5 |

## 단계 요약

| Stage | 범위 | 신규 deps | 독립 머지 |
|-------|------|----------|----------|
| 0 | 저장 IPC `file-viewer:write` + 보안 + 단위 테스트 | — | OK |
| 1 | Milkdown 편집 토글, commonmark+gfm, dirty+저장 | Milkdown core/react/preset/history/listener | OK |
| 2 | KaTeX 수식(번들) | `@milkdown/plugin-math` | OK |
| 3 | Mermaid 라이브 NodeView(기존 `MermaidBlock` 재사용) | `@milkdown/prose` | OK |
| 4 | 라운드트립 안정화 + frontmatter/HTML 보존 + 외부 변경 감지 | (remark-frontmatter) | OK |
| 5 | 작성 UX(slash/block/toolbar/링크·이미지/단축키/a11y) | `@milkdown/plugin-slash`,`-block` | OK |
| 6 | 보안/폐쇄망 회귀, 대용량 가드, 테스트 매트릭스, DoD | — | OK |

## 위험 & 완화

| 위험 | 영향 | 완화 |
|---|---|---|
| 라운드트립 정규화로 미편집 부분 변형 | 파일 손상/노이즈 diff | Stage 4: frontmatter split, 저장 전 diff 확인, 최소 정규화 설정 |
| 디스크 쓰기로 위협 모델 확대 | 워크스페이스 밖 파일 변조 | Stage 0: read와 동일한 root/realpath 검증, 원자적 쓰기(temp+rename) |
| Milkdown math ↔ `katex 0.16` 버전 비호환 | 수식 미렌더 | Stage 2 PoC에서 버전 핀 검증, 필요 시 katex 범위 조정 |
| 외부(에이전트/다른 앱)가 편집 중 파일 변경 | 덮어쓰기 충돌 | Stage 4: read 시 mtime 캡처, 저장 전 변경 감지 → 사용자 확인 |
| 폐쇄망에서 Milkdown 에셋 CDN 의존 | 런타임 실패 | Stage 6: 방화벽 차단 회귀, 모든 CSS/폰트 번들 검증 |

## 롤백 전략

- 단계별 커밋 revert로 부분 비활성 가능.
- 전체 비활성화: `MarkdownViewer.tsx`에서 편집 토글을 숨기면 보기 전용으로 즉시 복귀(에디터 미마운트).
- 저장 IPC만 비활성화: `file-viewer:write` 핸들러 미등록 → 편집은 되나 저장 불가(읽기 회귀 없음).

## 공통 검증 명령

- 빌드: `pnpm --filter cowork-core build`
- 개발: `pnpm --filter cowork-core dev`
- 타입: `pnpm --filter cowork-core typecheck`
- 테스트: `pnpm --filter cowork-core test`
- 폐쇄망: OS 방화벽 차단 후 편집/수식/Mermaid/저장 재실행

## 단계별 문서

- [Stage 0 — 저장 IPC & 보안](10-stage-0-write-ipc.md)
- [Stage 1 — Milkdown 편집 MVP](20-stage-1-editor-mvp.md)
- [Stage 2 — KaTeX 수식](30-stage-2-math.md)
- [Stage 3 — Mermaid 라이브 노드](40-stage-3-mermaid.md)
- [Stage 4 — 라운드트립 & frontmatter 보존](50-stage-4-roundtrip.md)
- [Stage 5 — 작성 UX 폴리시](60-stage-5-ux.md)
- [Stage 6 — 보안/폐쇄망/회귀](70-stage-6-hardening.md)
