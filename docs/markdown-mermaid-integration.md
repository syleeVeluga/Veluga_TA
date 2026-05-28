# 구현 계획: Markdown 뷰어 Mermaid 다이어그램 렌더링

## Context

현재 Veluga의 마크다운 뷰어(`MessageMarkdown` 기반 — file viewer의 [MarkdownViewer](../packages/cowork-core/src/renderer/features/file-viewer/viewers/MarkdownViewer.tsx)와 채팅의 [ContentBlockView](../packages/cowork-core/src/renderer/components/message/ContentBlockView.tsx))는 ` ```mermaid ` 코드 블록을 다이어그램으로 렌더하지 않고 평범한 코드 블록으로만 표시한다. 사용자가 `.md` 파일을 열거나 LLM이 mermaid 출력을 내보낼 때 다이어그램이 시각화되지 않아 가독성이 떨어진다.

이 계획은 **현재 스택(react-markdown v10 + rehype-sanitize + KaTeX)을 유지한 채** [mermaid](https://github.com/mermaid-js/mermaid) 공식 패키지를 추가해 **클라이언트 사이드 렌더링**으로 다이어그램을 표시한다. 향후 마크다운 편집기를 다른 스택(예: Milkdown)으로 옮기더라도 본 뷰어 통합은 그대로 살아남는 형태로 둔다.

---

## 채택 라이브러리

| 항목 | 라이브러리 | 비고 |
| --- | --- | --- |
| Mermaid 렌더 | `mermaid` (공식) | 클라이언트 사이드 SVG 생성, `securityLevel: 'strict'` 사용 |
| 테마 감지 | 기존 `useDocumentTheme` 패턴 재사용 | [CodeViewer.tsx:76-99](../packages/cowork-core/src/renderer/features/file-viewer/viewers/CodeViewer.tsx#L76-L99)에서 공유 hook으로 추출 |
| 에러 폴백 | 기존 `CodeBlock` 재사용 | [CodeBlock.tsx](../packages/cowork-core/src/renderer/components/message/CodeBlock.tsx) |

폐쇄망 적합성: `mermaid`는 모든 의존성을 번들에 포함하고 외부 CDN 호출 없음. WASM/네트워크 호출 추가 없음.

---

## 적용 범위

- **MarkdownViewer** (file viewer): `.md` 파일 열람 시 ```mermaid 블록을 다이어그램으로 렌더.
- **ContentBlockView** (채팅 메시지): LLM 출력의 ```mermaid 블록도 다이어그램으로 렌더.
- 두 곳 모두 동일한 `MermaidBlock` 컴포넌트를 재사용.

---

## 설계 핵심

### 통합 지점

`MessageMarkdown`은 `components` prop을 react-markdown에 그대로 전달하는 얇은 래퍼다([MessageMarkdown.tsx:36,53](../packages/cowork-core/src/renderer/components/MessageMarkdown.tsx#L36)). 코드 블록 처리는 **호출자**(ContentBlockView 또는 MarkdownViewer) 책임이다.

- **ContentBlockView**: 기존 `code` 핸들러([ContentBlockView.tsx:155-176](../packages/cowork-core/src/renderer/components/message/ContentBlockView.tsx#L155-L176))가 `language-*` 매칭 후 `<CodeBlock>`으로 위임한다. 여기에 `language-mermaid` 분기를 먼저 추가해 `<MermaidBlock>`으로 라우팅한다.
- **MarkdownViewer**: 현재 `components` prop을 넘기지 않는다. mermaid만 처리하는 최소 `components.code`를 추가하고, mermaid 외 코드 블록은 react-markdown 기본 렌더링에 위임한다(또는 `CodeBlock` 재사용은 별도 결정 사항).

### Sanitize 안전성

mermaid는 react-markdown이 HTML 트리를 만든 **다음** `useEffect` 안에서 클라이언트 사이드로 SVG를 생성하고 `dangerouslySetInnerHTML`로 주입한다. rehype-sanitize는 react-markdown 파이프라인 내부에서만 동작하므로 mermaid 산출 SVG는 그 경로에 들어가지 않는다.

→ **[MessageMarkdown.tsx](../packages/cowork-core/src/renderer/components/MessageMarkdown.tsx)의 `mathSanitizeSchema`를 수정할 필요 없음.**

대신 mermaid 자체의 보안 옵션을 강하게 설정한다:

- `securityLevel: 'strict'` — 클릭 핸들러, HTML 라벨, 외부 링크 차단
- `htmlLabels: false`
- 입력 소스가 사용자/LLM 콘텐츠이지만 strict 모드가 XSS 벡터를 차단

### 테마 동기화

기존 [`useDocumentTheme`](../packages/cowork-core/src/renderer/features/file-viewer/viewers/CodeViewer.tsx#L76-L99)를 공유 hook(`packages/cowork-core/src/renderer/hooks/useDocumentTheme.ts`)으로 추출하고 CodeViewer/MermaidBlock 양쪽에서 사용한다.

mermaid는 테마 변경 시 `mermaid.initialize({ theme: 'dark' | 'default' })` 재호출 후 다이어그램을 재렌더해야 한다.

### 렌더 라이프사이클 (`MermaidBlock`)

1. mount/소스 변경 시 고유 id 생성(`mermaid-<uuid>`).
2. `mermaid.render(id, source)` 호출 → SVG 문자열 획득 (비동기).
3. 성공: `dangerouslySetInnerHTML`로 SVG 삽입.
4. 실패(syntax error): 원본 소스를 `<CodeBlock language="mermaid">`로 폴백 렌더 + 작은 에러 메시지 표시.
5. 테마 변경 시: `mermaid.initialize` 재호출 후 step 2~4 재실행.
6. 스트리밍 중 소스가 자주 바뀌면 **debounce(~150ms)** 로 렌더 빈도 제한 — 채팅에서 LLM 토큰 단위 매번 재렌더 방지.

---

## 변경 파일

### 신규

- [packages/cowork-core/src/renderer/components/MermaidBlock.tsx](../packages/cowork-core/src/renderer/components/MermaidBlock.tsx) — 렌더 컴포넌트
- [packages/cowork-core/src/renderer/hooks/useDocumentTheme.ts](../packages/cowork-core/src/renderer/hooks/useDocumentTheme.ts) — 공유 테마 hook (CodeViewer에서 추출)
- [packages/cowork-core/src/renderer/components/mermaid-config.ts](../packages/cowork-core/src/renderer/components/mermaid-config.ts) — 모듈 스코프 `mermaid.initialize` 1회 호출 + 테마별 설정 헬퍼

### 수정

- [packages/cowork-core/src/renderer/components/message/ContentBlockView.tsx](../packages/cowork-core/src/renderer/components/message/ContentBlockView.tsx) — `code` 핸들러에 `match?.[1] === 'mermaid'` 분기 추가
- [packages/cowork-core/src/renderer/features/file-viewer/viewers/MarkdownViewer.tsx](../packages/cowork-core/src/renderer/features/file-viewer/viewers/MarkdownViewer.tsx) — `MessageMarkdown`에 `components={{ code: ... }}` 전달
- [packages/cowork-core/src/renderer/features/file-viewer/viewers/CodeViewer.tsx](../packages/cowork-core/src/renderer/features/file-viewer/viewers/CodeViewer.tsx) — 내부 `useDocumentTheme` 제거, 공유 hook import
- [packages/cowork-core/package.json](../packages/cowork-core/package.json) — `mermaid` 의존성 추가

---

## 재사용 자산

- **`useDocumentTheme` 패턴** — 이미 [CodeViewer.tsx:76-99](../packages/cowork-core/src/renderer/features/file-viewer/viewers/CodeViewer.tsx#L76-L99)에서 검증된 `MutationObserver` 기반 구현. 그대로 추출.
- **`MessageMarkdown`의 `components` passthrough** — 이미 [MessageMarkdown.tsx:36,53](../packages/cowork-core/src/renderer/components/MessageMarkdown.tsx#L36)에 존재. 확장 불필요.
- **`CodeBlock` 폴백** — 에러 시 mermaid 소스를 [CodeBlock](../packages/cowork-core/src/renderer/components/message/CodeBlock.tsx)으로 보여주면 일관된 UX 유지.

---

## 작업 단계

1. **의존성 추가** — npm workspace로 `mermaid` 설치. 정확한 워크스페이스명은 [packages/cowork-core/package.json](../packages/cowork-core/package.json) `name` 필드 확인.
2. **공유 hook 추출** — `useDocumentTheme.ts` 신규 작성, `CodeViewer.tsx`에서 import로 전환. file viewer로 `.ts` 파일을 열어 다크/라이트 토글 회귀 없는지 확인.
3. **`mermaid-config.ts` 작성** — 초기화 1회, `securityLevel: 'strict'`, 테마 전환 함수 export.
4. **`MermaidBlock.tsx` 작성** — 렌더 라이프사이클, 에러 폴백, debounce 포함.
5. **`ContentBlockView.tsx` 분기 추가** — `language-mermaid` → `MermaidBlock`.
6. **`MarkdownViewer.tsx` 확장** — `components.code` 전달, mermaid 외 코드 블록은 기본 렌더링 유지.
7. **검증** (아래 항목 수행).

---

## 검증

### 수동 시나리오

다음 mermaid 샘플이 들어간 테스트 `.md` 파일을 만들어 file viewer로 연다.

- `flowchart`, `sequenceDiagram`, `classDiagram`, `gantt` 각 1개씩
- 문법 오류가 있는 블록 1개 → 에러 폴백(코드 블록 표시) 확인
- 같은 페이지에 KaTeX 수식, 일반 코드 블록(typescript), 표를 섞어 회귀 확인

### 테마

- file viewer 열어둔 상태에서 라이트/다크 토글 → 다이어그램 색상이 즉시 전환되는지 확인.

### 채팅

- LLM에게 mermaid flowchart 출력 요청 → 스트리밍 중 깜빡임/과도한 재렌더 없는지 확인 (debounce 동작).

### 보안 회귀

- mermaid 소스에 `<script>`, `onclick=...`, `javascript:` URL을 삽입한 케이스가 strict 모드에서 무력화되는지 확인.

### 빌드/타입

- `npm run typecheck`, `npm run build` 통과.

### (선택) 단위 테스트

- 기존 `tests/` 패턴에 맞춰 `MermaidBlock`의 에러 폴백 경로 1건 추가.

---

## 비범위

- 마크다운 **편집기** 도입(CodeMirror/Milkdown 등) — 별도 결정 사항.
- PlantUML, Graphviz 등 mermaid 외 다이어그램 엔진.
- mermaid 다이어그램 SVG 내보내기/저장 기능.
- `rehype-mermaid`(빌드 타임 SVG) 전환 — 현재 클라이언트 렌더가 적합.
