# Veluga 문서 맵

문서를 **수명(lifecycle)** 기준으로 세 영역으로 나눈다. AI 코딩 에이전트는 작업 전 이 맵으로 *"지금 현재 명세로 신뢰해도 되는 문서"* 를 먼저 판별한다.

| 영역 | 신뢰도 | 의미 |
|---|---|---|
| [`reference/`](reference/) | ✅ 현재 명세 | 지금 코드의 계약·아키텍처. 항상 최신 유지 — 낡으면 고치거나 지운다. |
| [`prd/`](prd/) | ✅ 요구사항 | 제품 요구사항(전 Phase 완료). 미션·원칙·Phase별 명세·공유 스키마. |
| [`plans/`](plans/) | ⚠️ 시점 스냅샷 | 구현 *전* 설계안. 구현 완료 후엔 "그때의 계획"으로 동결 — 현재 동작은 `reference/`·코드를 본다. |

---

## 📐 reference/ — 상시 참조 (현재 코드 계약)

| 문서 | 내용 |
|---|---|
| [cowork-hooks.md](reference/cowork-hooks.md) | Veluga 어댑터가 붙는 Open Cowork IPC/훅 진입점 |
| [whiteout-endpoints.md](reference/whiteout-endpoints.md) | LLM 게이트웨이 필수 요건 (화이트아웃) |
| [kb-connector-plugin.md](reference/kb-connector-plugin.md) | KB 커넥터 레지스트리 아키텍처 |
| [kb-traverse-consumer.md](reference/kb-traverse-consumer.md) | `kb_traverse` MCP 툴 계약 (consumer) |
| [connector-approval-spec.md](reference/connector-approval-spec.md) | 결재 커넥터 인터페이스 계약 |
| [sandbox-ops.md](reference/sandbox-ops.md) | Docker 샌드박스 하드닝 기본값 |
| [markdown-mermaid-integration.md](reference/markdown-mermaid-integration.md) | Mermaid 렌더링 통합 |
| [model-and-thinking-ui.md](reference/model-and-thinking-ui.md) | 모델 프리셋·thinking 레벨 UI 아키텍처 |
| [phase1-verification.md](reference/phase1-verification.md) | Phase 1 수동 검증 항목 (폐쇄망 화이트아웃 등) |

## 📋 prd/ — 제품 요구사항

작업 시작 전 필독. 전체 인덱스는 [prd/README.md](prd/README.md).

- [prd/00_Overview.md](prd/00_Overview.md) — 미션·5대 원칙·아키텍처·페르소나·용어
- [prd/99_Appendix.md](prd/99_Appendix.md) — 공유 스키마(PolicyContext·IntentPlan·Audit)·SQLite·KB 계약
- [prd/98_Gap_Analysis.md](prd/98_Gap_Analysis.md) — 미결 결정 항목 (추가 개발 전 확인)

## 🛠 plans/ — 기능별 설계 계획

증가하는 카테고리. 계획별 상태표는 [plans/README.md](plans/README.md).

---

## 유지 규칙 (드리프트 방지)

새 문서가 계속 늘어나도 이 맵이 어긋나지 않도록, 코딩 에이전트·사람 모두 다음을 따른다.

1. **새 기능 설계는 `plans/`에 추가.** 구현이 끝나면 그 계획서 헤더에 `> Status: 구현 완료 · <날짜>`를 기록한다(파일을 옮기거나 reference로 승격하지 않는다).
2. **계약·아키텍처가 바뀌면 같은 PR에서 `reference/`의 해당 문서를 갱신**한다. reference 문서는 "현재 명세"이므로 낡은 채로 두지 않는다.
3. **계획서를 현재 명세로 착각하지 말 것.** 현재 코드 동작의 정본은 항상 `reference/`와 소스다.
4. **새 문서를 추가하면 이 맵과 해당 영역 인덱스(`reference/` 표 또는 `plans/README.md`)에 한 줄 추가**한다.
