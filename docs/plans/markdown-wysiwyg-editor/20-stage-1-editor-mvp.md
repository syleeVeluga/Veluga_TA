# Stage 1 — Milkdown 편집 MVP

## 목표
`.md` 파일을 **렌더된 화면에서 직접 편집**하고 저장한다. 이 단계 종료 시 "문서 쓰듯 편집 → 저장"이 실제로 동작한다.
수식·Mermaid 라이브 편집은 다음 단계로 미루되(이 단계에선 일반 코드펜스/텍스트로 취급), 보기 모드는 무회귀.

## 작업

1. **Milkdown 조립** (`editor/milkdown-config.ts`):
   - `@milkdown/core` + `@milkdown/preset-commonmark` + `@milkdown/preset-gfm`
     + `@milkdown/plugin-history` + `@milkdown/plugin-listener`.
   - listener의 `markdownUpdated`로 현재 마크다운 문자열을 구독(dirty/저장에 사용).
   - 초기 문서는 `readResult`에서 디코드한 텍스트(`textFromReadResult`)로 설정.

2. **React 래퍼** (`editor/MilkdownEditor.tsx`):
   - `@milkdown/react`의 `useEditor` + `<Milkdown/>`로 마운트. `MilkdownProvider`로 감싼다.
   - props: `initialMarkdown`, `onChange(markdown)`, `onSave()`, `editable`.
   - 언마운트 시 에디터 정리(메모리 누수 방지).

3. **테마** (`editor/theme.ts`):
   - headless로 띄우고 `.prose-chat`/앱 Tailwind 토큰(`text-primary`, `border`, `bg-background` 등)에 맞춘 CSS.
   - 보기 모드(`MessageMarkdown`)와 시각적 일관성 유지(폰트/간격/코드블록 스타일).

4. **보기/편집 토글** ([MarkdownViewer.tsx](../../../packages/cowork-core/src/renderer/features/file-viewer/viewers/MarkdownViewer.tsx)):
   - 상단에 `보기 | 편집` 세그먼트. **기본은 보기**(기존 `MessageMarkdown` 경로 그대로 — 무회귀).
   - 편집 선택 시에만 `MilkdownEditor` 마운트. 코드 분할 lazy import로 보기 전용 사용자는 에디터 번들 미로딩.
   - 편집은 쓰기 가능 파일에만 노출(authorizedRoots 안 `.md`). 외부/읽기전용이면 토글 숨김 또는 비활성.

5. **dirty + 저장** (`editor/use-doc-save.ts`):
   - `onChange` 마크다운을 **원본과 비교**해 dirty 산출(단순 문자열 비교 + 정규화 주의).
   - 저장: 현재 마크다운 → `window.electronAPI.fileViewer.write(path, markdown)`(Stage 0 IPC).
     성공 시 dirty 해제, 새 baseline 갱신, mtime 저장(Stage 4 충돌 검사용).
   - 단축키 `Cmd/Ctrl+S` → 저장. 패널의 기존 keydown 핸들러(`FileViewerPanel`의 Esc/`Cmd+\`)와 충돌하지 않도록
     에디터 포커스 시 `S` 저장을 우선 처리하고 `preventDefault`.
   - **닫기 가드**: dirty 상태에서 패널 닫기(`Esc`/X)·다른 파일 열기 시 확인 프롬프트.

6. **헤더 UI** ([FileViewerPanel.tsx](../../../packages/cowork-core/src/renderer/features/file-viewer/FileViewerPanel.tsx)):
   - 편집 모드일 때 헤더에 저장 버튼 + dirty 점(●) 표시. (또는 MarkdownViewer 내부 상단 바로 처리해 패널 침범 최소화 — 둘 중 침범 적은 쪽 택1.)

## 이 단계의 의도적 한계 (다음 단계로 위임)
- 수식(`$$`)·Mermaid 펜스는 편집 모드에서 **일반 코드/텍스트로** 보임(라이브 렌더 X). 보기 모드에서는 여전히 정상 렌더.
- frontmatter/raw HTML 완전 보존은 Stage 4. 이 단계에서는 frontmatter 없는 일반 문서로 라운드트립 1차 확인.

## 영향 파일
- 신규: `editor/MilkdownEditor.tsx`, `editor/milkdown-config.ts`, `editor/theme.ts`, `editor/use-doc-save.ts`
- 수정: `viewers/MarkdownViewer.tsx`(토글/마운트), `FileViewerPanel.tsx`(저장 버튼·dirty, 최소 침범)
- 수정: `package.json`(Milkdown core/react/preset-commonmark/preset-gfm/plugin-history/plugin-listener)

## 검증

| 항목 | 확인 |
|---|---|
| 보기 모드 | 기존 `MessageMarkdown`과 동일(무회귀) |
| 편집 진입 | 제목/볼드/이탤릭/목록/체크박스/표/인용/코드블록 WYSIWYG 편집 |
| 라운드트립 | frontmatter 없는 문서 저장 → 재오픈 시 의미 동일, 노이즈 diff 최소 |
| 저장 | `Cmd/Ctrl+S` 및 버튼으로 디스크 반영, dirty 해제 |
| dirty 가드 | 미저장 상태 닫기/파일 전환 시 확인 |
| 외부/읽기전용 | 편집 토글 숨김/비활성 |
| 번들 | 보기 전용 사용자는 에디터 청크 미로딩(lazy) |

## 체크리스트
- [ ] 기본 보기 모드 무회귀(기존 렌더 경로 유지)
- [ ] WYSIWYG 기본 편집(GFM 포함) 동작
- [ ] 저장→디스크 반영, dirty 토글 정확
- [ ] `Cmd/Ctrl+S`가 패널 단축키와 충돌 없음
- [ ] 닫기/전환 시 미저장 가드
- [ ] 외부/읽기전용 파일은 편집 비노출
- [ ] 에디터 lazy 로딩, 언마운트 정리
- [ ] 폐쇄망: 에디터 마운트/편집에 외부 fetch 0

## 롤백
이 단계 커밋만 revert → `MarkdownViewer`가 보기 전용으로 복귀. Stage 0 IPC는 남지만 호출자가 없어 무해.
