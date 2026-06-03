# Stage 4 — 라운드트립 & frontmatter 보존

## 목표
"편집하지 않은 부분은 저장해도 그대로"를 보장한다. YAML frontmatter·원시 HTML·공백/개행 정규화로 인한 노이즈 diff와
외부 변경 덮어쓰기를 막아, 메모리 `.md`처럼 구조가 민감한 파일도 안전하게 편집 가능하게 한다.

## 배경 / 위험
- Milkdown(commonmark/remark) 직렬화는 의미는 보존하지만 **표면 형식**(불릿 기호, 들여쓰기, 줄바꿈, 인용 부호 등)을
  정규화할 수 있다. 미편집 영역까지 diff가 생기면 검토·버전관리에 노이즈.
- **frontmatter**: 메모리 파일 등은 상단 `--- ... ---` YAML 블록을 가진다. commonmark 기본 파싱은 이를 thematic break/문단으로
  오인해 **유실/변형**시킬 수 있다.
- **원시 HTML**: 마크다운 내 인라인/블록 HTML이 정규화로 손상될 수 있다.
- **외부 변경**: 에이전트나 다른 앱이 편집 도중 같은 파일을 바꾸면 저장 시 덮어쓰기 충돌.

## 작업
1. **frontmatter split/merge** (`editor/frontmatter.ts`):
   - 오픈 시 상단 YAML frontmatter를 **분리**해 별도 보관하고, 본문만 에디터에 로드.
   - 저장 시 보관한 frontmatter를 **원문 그대로** 다시 prepend(에디터가 건드리지 않음).
   - 또는 `remark-frontmatter` 기반으로 frontmatter를 보호 노드로 다루는 방식 비교 후 택1
     (단순·안전 우선이면 split/merge 권장).
2. **최소 정규화 직렬화**: remark stringify 옵션(불릿 기호, emphasis 표시, 코드펜스 등)을 가능한 한 원본 스타일에 맞춤.
   완전 무손실은 불가하므로, **저장 전 diff 미리보기**(원본 vs 직렬화 결과)를 옵션으로 제공해 사용자가 의도치 않은 변형을 인지.
3. **원시 HTML 처리**: HTML 블록을 유실 없이 통과(`html` 노드 보존) 또는 편집 불가 보호 블록으로 표시.
4. **외부 변경 감지**: 오픈/읽기 시 mtime 캡처 → 저장 시 `expectedMtimeMs`로 Stage 0 IPC에 전달.
   `MTIME_CONFLICT`면 "디스크가 변경됨: 덮어쓰기 / 다시 불러오기 / 취소" 선택 UI.
5. **정규화 회귀 스냅샷 테스트**: 대표 `.md`(frontmatter, 표, 중첩 목록, 코드펜스, 수식, mermaid, HTML)들을
   load→serialize 했을 때 허용 가능한 변형만 발생하는지 스냅샷으로 고정.

## 영향 파일
- 신규: `editor/frontmatter.ts`, 라운드트립 스냅샷 테스트
- 수정: `editor/milkdown-config.ts`(stringify 옵션, html/frontmatter 처리), `editor/use-doc-save.ts`(mtime 충돌 흐름)
- 활성화: Stage 0의 `expectedMtimeMs` / `MTIME_CONFLICT` 경로

## 검증
| 항목 | 확인 |
|---|---|
| frontmatter 보존 | YAML 블록 byte-동일 유지 |
| 미편집 본문 | 저장 후 노이즈 diff 최소(스냅샷 허용 범위) |
| 원시 HTML | 유실/손상 없음 |
| 외부 변경 | 저장 전 충돌 감지 → 사용자 선택 |
| diff 미리보기 | 원본↔직렬화 차이 확인 가능 |
| 메모리 `.md` 실파일 | frontmatter 포함 편집·저장 안전 |

## 체크리스트
- [ ] frontmatter split/merge로 YAML 무손상
- [ ] stringify 옵션으로 정규화 노이즈 최소화
- [ ] 원시 HTML 보존
- [ ] mtime 충돌 감지·해소 UI
- [ ] 라운드트립 스냅샷 테스트 통과
- [ ] 저장 전 diff 미리보기(옵션)

## 롤백
frontmatter/충돌 로직 revert 시 Stage 1~3의 일반 문서 편집은 유지. 단, frontmatter 파일 편집은 다시 위험해지므로
롤백 시 해당 파일군은 편집 비노출로 게이트.
