# Stage 2 — KaTeX 수식

## 목표
편집 모드에서 인라인 `$...$` / 블록 `$$...$$` 수식을 **라이브로 KaTeX 렌더**하고, 저장 시 마크다운 수식 문법으로 그대로 직렬화한다.
보기 모드는 이미 `rehype-katex`로 렌더 중이므로, 편집-보기 간 시각적 일치가 목표.

## 배경
- 보기 측은 [MessageMarkdown.tsx](../../../packages/cowork-core/src/renderer/components/MessageMarkdown.tsx)에서
  `remark-math` + `rehype-katex`로 처리한다. 기존 dep: `katex ^0.16.45`.
- Milkdown은 `@milkdown/plugin-math`가 KaTeX 기반 inline/block 수식 노드를 제공한다.

## 작업
1. `@milkdown/plugin-math`를 `milkdown-config.ts`에 추가.
2. **KaTeX 에셋 번들화(폐쇄망 필수)**: `katex/dist/katex.min.css`와 폰트가 번들에 포함되는지 확인.
   런타임 CDN 의존이 없어야 한다(현재 보기 측이 이미 포함하고 있으면 재사용).
3. **버전 호환 검증**: `@milkdown/plugin-math`가 요구하는 katex 버전과 기존 `^0.16.45` 충돌 여부 확인.
   충돌 시 (a) katex 범위 조정 또는 (b) 보기/편집이 같은 katex 인스턴스를 쓰도록 정리.
4. inline/block 입력 UX: `$` 입력 시 inline 수식, `$$`+Enter로 block 수식 진입. 편집 중 원본 LaTeX를 보여주는
   편집 상태와 렌더 상태 토글(plugin-math 기본 동작 확인 후 필요 시 보강).
5. 직렬화 확인: 편집된 수식이 `$...$` / `$$...$$`로 정확히 round-trip 되는지(공백·개행 포함).

## 영향 파일
- 수정: `editor/milkdown-config.ts`(math 플러그인), `package.json`(`@milkdown/plugin-math`)
- 확인: 번들 설정(KaTeX CSS/폰트 포함 경로)

## 검증
| 항목 | 확인 |
|---|---|
| inline `$E=mc^2$` | 편집 모드 라이브 렌더 |
| block `$$\int_a^b$$` | 블록 수식 렌더/편집 |
| 보기↔편집 일치 | 동일 수식이 두 모드에서 시각적으로 동일 |
| 라운드트립 | 저장→재오픈 시 LaTeX 원문 보존 |
| 폐쇄망 | 방화벽 차단 상태에서 수식 정상 렌더(폰트 포함) |
| 오류 수식 | `throwOnError:false` 동등 동작(깨진 수식도 앱 크래시 없음) |

## 체크리스트
- [ ] `@milkdown/plugin-math` 통합, inline/block 렌더
- [ ] KaTeX CSS·폰트 번들 포함(런타임 fetch 0)
- [ ] katex 버전 단일화/호환 확인
- [ ] 수식 라운드트립 무손실
- [ ] 잘못된 수식에도 크래시 없음

## 롤백
math 플러그인 제거 → 수식은 편집 모드에서 일반 텍스트로 표시(보기 모드 렌더는 영향 없음).
