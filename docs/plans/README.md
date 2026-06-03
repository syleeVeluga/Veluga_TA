# 설계 계획 (Plans)

기능별 설계·구현 계획. 각 문서는 **구현 *전* 설계안**이며, 구현이 끝나면 "그때의 계획"으로 동결된다 — 현재 코드 동작의 정본은 [`../reference/`](../reference/)와 소스다.

> 아래 상태는 **2026-06-03 기준** git 이력 + 각 문서 헤더 종합. **정본 상태는 각 문서 헤더의 `Status` 줄**을 본다.

| 계획 | Scope | 상태 (2026-06-03) |
|---|---|---|
| [agent-orchestration/](agent-orchestration/README.md) | 오케스트레이터-워커 + 태스크 FSM + `node:sqlite` 체크포인트 | ✅ 구현 완료 (Phase 3는 플래그 default OFF) |
| [ask-user-question/](ask-user-question/README.md) | 에이전트 실행 중 사용자 역질문 인라인 다이얼로그 | ✅ 구현 완료 (`11692eb`) |
| [file-viewer-panel/](file-viewer-panel/00-overview.md) | 인앱 파일 인라인 뷰어 (코드/MD/PDF/DOCX/XLSX/HTML) | ✅ 구현 완료 |
| [model-and-thinking-ui.md](model-and-thinking-ui.md) | 최신 모델 프리셋·헤더 모델 스위처·thinking 레벨 선택 | ✅ 구현 완료 (`3ee82a8`) |
| [network-error-handling.md](network-error-handling.md) | 스트림 타임아웃·HTTP 오류 처리 보완 | ✅ 구현 완료 (`e7f79bb`) |
| [subscription-login/](subscription-login/README.md) | ChatGPT Plus + Claude Pro 구독 로그인 도입 | 🚧 구현 진행 중 (feat 일부 반영) |
| [veluga-service-platform/](veluga-service-platform/README.md) | Veluga 계정 기반 desktop 배포·model catalog·entitlement·admin console·quota enforcement | 📝 계획 초안 |
| [messenger-channel-migration.md](messenger-channel-migration.md) | Feishu → Discord(기본) + Slack 메신저 교체 | 📝 계획 |
| [openai-thinking-mode-support.md](openai-thinking-mode-support.md) | OpenAI reasoning/thinking 모드 지원 | 📝 계획 (일부 관련 구현) |

> 폴더형(`agent-orchestration/`, `ask-user-question/`, `file-viewer-panel/`, `subscription-login/`, `veluga-service-platform/`)은 각 폴더의 `README.md`(또는 `00-overview.md`)가 진입점이다. 단일 파일형은 그 자체가 전체 계획이다.
