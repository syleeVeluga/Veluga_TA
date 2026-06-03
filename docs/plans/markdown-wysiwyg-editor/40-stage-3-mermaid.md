# Stage 3 — Mermaid 라이브 노드

## 목표
편집 모드에서 ```` ```mermaid ```` 펜스를 **다이어그램으로 라이브 미리보기**하면서 소스도 편집 가능하게 한다.
기존 [MermaidBlock](../../../packages/cowork-core/src/renderer/components/MermaidBlock.tsx)을 재사용해 보기 모드와 동일 렌더.

## 배경
- 보기 측 [MarkdownViewer.tsx](../../../packages/cowork-core/src/renderer/features/file-viewer/viewers/MarkdownViewer.tsx)는
  커스텀 `code` 컴포넌트에서 `language-mermaid`를 만나면 `<MermaidBlock source={...}/>`로 렌더한다. dep: `mermaid 11.15.0`.
- Milkdown(ProseMirror)에서 코드펜스는 기본적으로 편집 가능한 코드블록 노드다. 라이브 다이어그램을 보이려면
  `lang === 'mermaid'`인 code_block에 **커스텀 NodeView**를 붙여야 한다.

## 작업
1. **커스텀 NodeView** (`editor/nodes/mermaid-node.ts`):
   - `@milkdown/prose`(ProseMirror)로 code_block(lang=mermaid)에 NodeView 부착.
   - NodeView는 두 영역: (a) 소스 편집 textarea/코드영역, (b) `MermaidBlock`으로 렌더된 다이어그램.
     기본은 렌더 표시, 클릭/포커스 시 소스 편집 토글(또는 분할 표시) — 침범 적은 방식 택1.
   - 소스 변경 → 디바운스 후 `MermaidBlock` 재렌더. 렌더 실패 시 에러 표시(앱 크래시 금지).
2. **직렬화 유지**: 노드는 표준 code_block(lang=mermaid)으로 직렬화 → 저장 시 ```` ```mermaid ```` 펜스 그대로.
   커스텀 노드 도입이 마크다운 출력 형식을 바꾸지 않아야 함(라운드트립 안정).
3. **React 브리지**: NodeView(명령형 DOM) 안에서 React 컴포넌트(`MermaidBlock`)를 렌더하기 위한 portal/root 관리
   (마운트/언마운트 정리 포함).
4. Mermaid 초기화 설정(테마 등)을 보기 측과 공유해 일관성 유지.

## 영향 파일
- 신규: `editor/nodes/mermaid-node.ts`
- 수정: `editor/milkdown-config.ts`(노드 등록), `package.json`(`@milkdown/prose` 필요 시)
- 재사용: `components/MermaidBlock.tsx`(수정 없이 재사용 지향)

## 검증
| 항목 | 확인 |
|---|---|
| `mermaid` 펜스 편집 진입 | 다이어그램 라이브 미리보기 |
| 소스 수정 | 디바운스 후 다이어그램 갱신 |
| 잘못된 다이어그램 | 에러 표시, 크래시 없음 |
| 라운드트립 | 저장→재오픈 시 ```` ```mermaid ```` 원문/들여쓰기 보존 |
| 보기↔편집 일치 | 같은 소스가 두 모드에서 동일 렌더 |
| 폐쇄망 | mermaid 번들만으로 렌더 |

## 체크리스트
- [ ] mermaid code_block 커스텀 NodeView 동작
- [ ] `MermaidBlock` 재사용(중복 구현 없음)
- [ ] React portal 마운트/언마운트 정리(누수 없음)
- [ ] 표준 code_block 직렬화 유지(라운드트립)
- [ ] 렌더 오류 격리

## 롤백
NodeView 등록 제거 → mermaid 펜스는 편집 모드에서 일반 코드블록으로(보기 모드 다이어그램 렌더는 영향 없음).
