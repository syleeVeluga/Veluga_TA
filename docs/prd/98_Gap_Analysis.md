# 98 — Gap Analysis (누락 점검 보고서)

> **이 문서의 역할**: PRD 작성 중 식별된 미해결 항목·결정 필요 사항. AI coding agent가 코드 작업 시작 전 PM과 합의해야 할 항목.
>
> **갱신 주체**: PRD 작성 시 + 코딩 중 임의 결정 금지 룰에 따라 발견 시 AI agent가 추가.
>
> **범위 알림 (v1.1)**: 기관 KB는 외부 시스템이다. KB 인덱스 저장소 운영, 임베딩 모델 호스팅, 문서 ingest, 디스크 암호화, 백업·복구 등은 **외부 운영 주체의 GAP**이며 본 문서에 포함되지 않는다. 본 문서는 *Veluga가 외부 KB에 의존하기 위해 필요한 합의 항목*만 추적한다.

---

## 1. 우선순위 기준

| 등급 | 기준 | 작업 진행 가능성 |
| --- | --- | --- |
| 🚨 **블로커** | 미해결 시 Phase 자체가 시작 불가 | Phase 시작 보류 |
| ⚠️ **주의** | mock·임시 결정으로 진행 가능하나 Phase 종료 전 반드시 확정 | mock으로 진행, 데드라인 명시 |
| ℹ️ **정보** | 권장 결정이지만 디폴트로 진행 가능 | 디폴트로 진행, 운영 단계에 결정 |

---

## 2. Phase 1 — 블로커 / 주의 / 정보

| ID | 항목 | 등급 | 책임 | 데드라인 | 디폴트 가정 (없을 시) |
| --- | --- | --- | --- | --- | --- |
| GAP-P1-01 | **Open Cowork hook 위치 실증** (실제 함수명/시그니처) | 🚨 | AI agent + PM | Phase 1 첫 주 | 발견 결과 `docs/cowork-hooks.md` 기록 후 부재 시 PM 합의 |
| GAP-P1-02 | **사내 LLM 게이트웨이 인터페이스** (OpenAI 호환 / Anthropic 호환 / 자체) | 🚨 | 인프라팀 + PM | Phase 1 킥오프 | OpenAI 호환 가정 (mock 게이트웨이로 시작) |
| GAP-P1-03 | **코드 서명 인증서 발급** (Win + mac) | ⚠️ | PM | Phase 1 종료 전 | 미서명 빌드로 dev 진행, 출시 차단 |
| GAP-P1-04 | **Veluga 로고·아이콘 최종 디자인** | ⚠️ | 디자인팀 | Phase 1 첫 2주 | 임시 텍스트 로고로 진행, 둘째 주 교체 |
| GAP-P1-05 | **mock SSO IdP 선정** (keycloak vs 자체 JWT) | ℹ️ | 인프라팀 | Phase 1 첫 주 | 자체 JWT signer (가장 단순) |
| GAP-P1-06 | institution.yaml `pii_patterns` 확장 인터페이스 | ℹ️ | PM + 보안 | Phase 3 | Phase 1엔 한국 RRN/전화/계좌만 |
| GAP-P1-07 | dry-run 로그 분석 회의 일정 (Phase 3 enforce 자료) | ⚠️ | PM + 보안 | Phase 1 종료 직전 | Phase 3 첫 주에 합의 |
| GAP-P1-08 | Cowork 원본 E2E 테스트 스위트 격리 방법 | ⚠️ | AI agent | Phase 1 둘째 주 | `tests/regression-cowork-original/`에 복제 |

---

## 3. Phase 2 — 블로커 / 주의

| ID | 항목 | 등급 | 책임 | 데드라인 | 디폴트 |
| --- | --- | --- | --- | --- | --- |
| GAP-P2-01 | **Cowork Project hook 함수 시그니처** (open/close/save 이벤트) | 🚨 | AI agent | Phase 2 첫 주 | Phase 1 GAP-P1-01과 동시 조사 |
| GAP-P2-02 | **docx 워터마크 라이브러리 PoC** (python-docx sidecar vs JS lib) | ⚠️ | AI agent | Phase 2 첫 주 | python-docx 사이드카 (docx Skill 한정 — 외부 KB와 무관) |
| GAP-P2-03 | **한국어 chunking 라이브러리** (KSS vs Kiwi vs 자체) | ⚠️ | AI agent + PM | Phase 2 둘째 주 | KSS (Python, 가벼움) |
| GAP-P2-04 | citation-verifier fuzzy threshold (Levenshtein vs 임베딩 코사인) | ⚠️ | AI agent | Phase 2 셋째 주 PoC | Levenshtein 시작 (간단). 임베딩 기반 매칭이 필요할 경우 사내 LLM 게이트웨이의 임베딩 API를 사용 (외부 KB와 독립) |
| GAP-P2-05 | last_session_summary 60자 외 단위 의미 (UX) | ℹ️ | P1 페르소나 인터뷰 | Phase 2 종료 직전 | 60자 (한 줄 표시 한계) |

---

## 4. Phase 3 — 블로커 / 주의 (외부 KB 의존)

> Phase 3는 **외부 기관 KB**의 가용성과 인터페이스에 의존한다. 본 표의 🚨 항목은 외부 KB 운영 주체와 합의 필요. KB 자체 구현·운영(임베딩·DB·ingest·암호화)은 **외부 GAP**이므로 본 문서에 포함되지 않는다.

| ID | 항목 | 등급 | 책임 | 데드라인 | 디폴트 |
| --- | --- | --- | --- | --- | --- |
| GAP-P3-01 | **외부 KB MCP 도구 명세** — `kb_search` / `kb_metadata` / `kb_hybrid` 입출력이 03_Phase3_KB.md §3.3과 일치하는지, 차이 시 어댑터 변환 로직 합의 | 🚨 | PM + 외부 KB 운영 주체 | Phase 3 첫 주 | §3.3 시그니처 가정, 차이 발견 시 어댑터(`packages/veluga-main/src/kb/kb-mcp-adapter.ts`)에서 변환 |
| GAP-P3-02 | **외부 KB 서비스 제공 시점·SLA** (응답 latency·가용성·운영 시간) | 🚨 | PM + 외부 KB 운영 주체 | Phase 3 첫 주 | mock 외부 KB(`tests/fixtures/kb-mcp-mock/`)로 통합 진행, 실서비스 일정은 외부 일정에 종속 |
| GAP-P3-03 | **PolicyService RPC 인터페이스 동결** (mock 호환성) | 🚨 | PM | Phase 3 첫 주 | Phase 1 mock 시그니처 그대로 |
| GAP-P3-04 | **외부 KB 인증·세션 토큰 전달 방식** (PolicyContext 토큰을 외부 KB에 어떻게 전달?) | 🚨 | 보안 + 외부 KB 운영 주체 | Phase 3 첫 주 | MCP request에 `x-veluga-policy-token` 헤더로 전달 가정 |
| GAP-P3-05 | enforce 전환 후 신규 도구 화이트리스트 운영 절차 | ⚠️ | PM + 보안 | Phase 3 셋째 주 | 새 도구는 PR 시점에 PolicyService에 등록 강제 |
| GAP-P3-06 | KB consumer 어댑터 fallback UX 디자인 (KB unavailable 안내 카피·재시도 행태) | ⚠️ | 디자인 + PM | Phase 3 둘째 주 | 일반 답변으로 자동 fallback + 상단 배너 |

---

## 5. Phase 4 — 블로커 / 주의

> Phase 4는 외부 KB의 **graph traversal 기능**에 의존한다. KB Graph 저장소 운영은 **외부 GAP**이며 본 문서에 포함되지 않는다.

| ID | 항목 | 등급 | 책임 | 데드라인 | 디폴트 |
| --- | --- | --- | --- | --- | --- |
| GAP-P4-01 | **외부 KB `kb_traverse` 도구 제공 여부·시그니처** (04_Phase4_Approval.md §3과 일치) | 🚨 | PM + 외부 KB 운영 주체 | Phase 4 첫 주 | §3 시그니처 가정. 미제공 시 citation-tracer는 `kb_metadata` + `kb_hybrid` 조합으로 다운그레이드 |
| GAP-P4-02 | **Docker rootless 환경 Windows 지원** | 🚨 | AI agent PoC | Phase 4 첫 주 | Windows 미지원 시 fallback (AppContainer) 별도 PR |
| GAP-P4-03 | **1차 출시 기관의 결재시스템 어댑터** | 🚨 | PM | Phase 4 셋째 주 | sample mock 어댑터로 인터페이스 검증 |
| GAP-P4-04 | citation-tracer Veluga측 회귀 골든셋 (개정 패턴 50건의 *consumer 검증* — 외부 KB가 정상 응답한다는 가정 하 어댑터·Skill 회귀) | ⚠️ | AI agent + PM | Phase 4 둘째 주 | mock 외부 KB 응답으로 50건 시드 |
| GAP-P4-05 | **봉인 파일 전자서명** (PKI vs HMAC) | ⚠️ | 보안팀 | Phase 4 첫 주 | HMAC (`VELUGA_SEAL_HMAC_KEY` 환경변수) → Phase 5 PKI |
| GAP-P4-06 | approval-queue 정렬·필터 디폴트 | ℹ️ | P3 인터뷰 + 디자인 | Phase 4 둘째 주 | 녹색 먼저, 제출일 오름차순(오래된 건 먼저) |
| GAP-P4-07 | 일괄 승인 부분 실패 처리 표준 | ⚠️ | PM | Phase 4 셋째 주 | 성공/실패 분리 표시 + 실패 재시도 큐 |
| GAP-P4-08 | Docker 컨테이너 base image 보안 검수 | ⚠️ | 보안팀 | Phase 4 첫 주 | distroless 또는 alpine + 보안팀 사인 |

---

## 6. 횡단적 (모든 Phase 적용) Gap

| ID | 항목 | 등급 | 책임 | 데드라인 | 디폴트 |
| --- | --- | --- | --- | --- | --- |
| GAP-X-01 | **로그 회전·보존 기간 정책** (audit_log 무한 증가) | ⚠️ | PM + 보안 | Phase 3 종료 전 | 5년 + 아카이브 (사내 백업) |
| GAP-X-02 | **백업/복구 절차** (Project, audit_log — Veluga 보유분만; 외부 KB 백업은 외부 책임) | ⚠️ | 인프라 + 보안 | Phase 3 종료 전 | 사내 백업 솔루션 의존, 매뉴얼만 작성 |
| GAP-X-03 | **다국어 지원 범위** (한국어 외) | ℹ️ | PM | 운영 단계 | 한국어 first, 영어는 i18n 키만 유지 |
| GAP-X-04 | **한국 정부 웹 접근성 지침 (KWCAG) 준수 범위** | ⚠️ | 디자인 + 법무 | Phase 1 종료 전 | 데스크톱 앱은 WCAG 2.1 AA 권고 |
| GAP-X-05 | **성능 SLA (응답 시간·처리량)** 기관별 계약 | ⚠️ | PM | 운영 단계 | Veluga측 어댑터 오버헤드(≤50ms) 보장 / 외부 KB 응답 SLA는 외부 운영 주체와 별도 계약 |
| GAP-X-06 | **패키징·배포 채널** (인트라넷 다운로드 vs CD vs MDM) | ⚠️ | PM + IT | Phase 1 종료 전 | 인트라넷 다운로드 + 코드 서명 |
| GAP-X-07 | **사용자 등록·온보딩 플로우** (P4 IT 관리자 동선) | ℹ️ | 디자인 | Phase 3 | YAML 직접 편집 → Phase 5 관리자 UI |
| GAP-X-08 | **Skill 버전 관리·롤백** | ℹ️ | PM | Phase 3 종료 전 | SKILL.md `version` 필드 + 카탈로그 history |
| GAP-X-09 | **정책 변경 흐름** (관리자가 어떻게 institution.yaml 편집?) | ℹ️ | PM + IT | Phase 3 | 디스크 편집 + Git 버전 관리 → Phase 5 UI |
| GAP-X-10 | **에러 핸들링 표준** (사용자 메시지·로깅 수준·재시도 룰) | ⚠️ | AI agent | Phase 1 첫 주 | `packages/shared-types/src/errors.ts` 표준 타입 |
| GAP-X-11 | **보안 토큰 보관** (refresh token, SSO token, API key) | 🚨 | 보안 | Phase 1 첫 주 | OS keychain 강제 (AC-1.27) |
| GAP-X-12 | **Cowork upstream 머지 절차** (보안 패치 cherry-pick) | ⚠️ | AI agent + PM | Phase 1 종료 전 | 매 Phase 종료 시 diff 리포트 + 보안 패치 우선 머지 |
| GAP-X-13 | **로컬 LLM 응답 속도 SLA** (cold start, p95) | ⚠️ | 인프라팀 | Phase 1 종료 전 | 게이트웨이 의존, fallback 정책 명시 |
| GAP-X-14 | **dev 환경 일관성** (`.nvmrc`, `.python-version`, pre-commit) | ℹ️ | AI agent | Phase 1 첫 주 | `.nvmrc` (Node 20 LTS), Python 3.11, pre-commit hook |
| GAP-X-15 | **시크릿 관리** (`.env.example` 외에 secret vault 정책) | ⚠️ | 보안 | Phase 1 첫 주 | OS keychain + 환경변수 명시, 시크릿 커밋 차단 lint |
| GAP-X-16 | **테스트 커버리지 목표** (단위·통합·E2E 비율) | ℹ️ | AI agent | Phase 1 첫 주 | Unit 60% / Integration 30% / E2E 10%, 전체 라인 커버리지 ≥ 70% |

---

## 7. 작업 진행 가이드 (AI coding agent용)

1. **Phase 시작 전**: 본인 Phase 의 🚨 블로커 항목을 PM과 합의. 미합의 항목은 코드 작업 보류.
2. **Phase 진행 중**: ⚠️ 주의 항목을 mock·디폴트로 시작 가능. 단, 데드라인 내 결정 PR 머지 필수.
3. **새 Gap 발견 시**: 본 문서에 `GAP-Pn-NN` 또는 `GAP-X-NN` 형식으로 즉시 추가, PM에 알림. **임의 결정 금지**.
4. **Gap 해소 시**: 본 문서에 해당 행 [RESOLVED] 표기 + 결정 내용을 `99_Appendix.md` 결정 로그에 추가.

---

## 8. 결정 채널

- **PM 합의 필요**: 본 문서 행마다 명시된 책임자.
- **임시 채널**: `docs/open-questions.md` — 일상 질문 누적, 주간 정리.
- **결정 기록**: 합의 후 → `99_Appendix.md` 결정 로그 + 본 문서 [RESOLVED].

---

## 9. 우선순위 한눈 (등급별 카운트)

| 등급 | 개수 | 영향 Phase |
| --- | --- | --- |
| 🚨 블로커 | 11 | P1(2), P2(1), P3(4), P4(3), 횡단(1) |
| ⚠️ 주의 | 22 | P1(4), P2(3), P3(2), P4(4), 횡단(9) |
| ℹ️ 정보 | 10 | P1(2), P2(1), P3(0), P4(1), 횡단(6) |

> Phase 진입 전 본 표의 해당 Phase 🚨 항목 우선 해소. **Phase 3·4의 외부 KB 의존 GAP은 외부 운영 주체와의 합의 항목이며, 외부 일정에 종속된다.**

---

## 10. 부록 — 누락 점검 시 사용한 체크리스트

이 PRD 세트는 다음 항목을 의도적으로 점검했다:

- [x] LLM 게이트웨이 명세 (호환 인터페이스, 환경변수)
- [x] 테스트 전략 (단위/통합/E2E 비율, 회귀 카탈로그)
- [x] 데이터 마이그레이션 (Phase 간 SQLite 스키마)
- [x] 관측성 (로컬 로그 회전 → GAP-X-01)
- [x] 백업·복구 (GAP-X-02)
- [x] 다국어 (한국어 first → GAP-X-03)
- [x] 접근성 (KWCAG → GAP-X-04)
- [x] 성능 SLA (KB p95 → AC + GAP-X-05)
- [x] 패키징·배포 채널 (GAP-X-06)
- [x] 사용자 등록·온보딩 (P4 동선 → Phase 3 시나리오 + GAP-X-07)
- [x] Skill 버전 관리·롤백 (GAP-X-08)
- [x] 감사 로그 보존 (5년 default → GAP-X-01)
- [x] 정책 변경 흐름 (Git 버전 관리 → GAP-X-09)
- [x] 에러 핸들링 표준 (GAP-X-10)
- [x] 보안 토큰 보관 (AC-1.27 + GAP-X-11)
- [x] Cowork upstream 머지 절차 (GAP-X-12)
- [x] 로컬 LLM SLA (GAP-X-13)
- [x] dev 환경 일관성 (GAP-X-14)
- [x] 시크릿 관리 (GAP-X-15)
- [x] 테스트 커버리지 (GAP-X-16)

---

## 11. 한 줄 결론

> *PRD가 명시하지 않은 모든 결정은 본 Gap Analysis 또는 `99_Appendix.md` 결정 로그에 등록된 후에만 코드에 반영한다. AI agent의 임의 결정은 reject.*
---

## 12. Baseline Resolution Notes (2026-05-23)

- [RESOLVED] GAP-P1-01: Open Cowork source is now present as a Git submodule at `packages/cowork-core`, pinned to upstream commit `d4318943fb070d0863bed930eb70a95c6e7c4487`. The concrete hook mapping is recorded in `docs/cowork-hooks.md`.
- [NEW] GAP-P1-09: Open Cowork has no exported first-class `beforeToolCall` hook. Veluga `ToolInterceptor` must either wrap `ToolDefinition.execute(...)` near `src/main/claude/agent-runner.ts` before `createAgentSession(...)`, or introduce a minimal upstream shim that exposes this wrapper point.

## 13. Phase 1 & Phase 2 Implementation Resolution (2026-05-23)

Phase 1과 Phase 2 구현 완료 시점 기준으로 아래 GAP이 해소되었다. 해소 결정은 `99_Appendix.md` 결정 로그에 추가 필요.

- [RESOLVED] GAP-P1-02: LLM Gateway는 OpenAI 호환 인터페이스로 구현 (`packages/veluga-main/src/llm-gateway.ts`). `VELUGA_LLM_GATEWAY_URL` + `VELUGA_LLM_API_KEY` 환경변수 주입 방식 확정.
- [RESOLVED] GAP-P1-04: Veluga 로고·아이콘 및 Tailwind 팔레트 확정 (`packages/veluga-ui/theme.ts`). primary `#0B192C` / secondary `#1E3E62`.
- [RESOLVED] GAP-P1-05: mock SSO IdP는 내부 JWT signer(`packages/policy-service/src/sso/internal.ts`)로 구현. SAML/OIDC 슬롯도 인터페이스 완성.
- [RESOLVED] GAP-P1-08: Cowork 원본 E2E 테스트 스위트를 `tests/regression-cowork-original/`에 격리 완료.
- [RESOLVED] GAP-P1-09: `ToolInterceptor`를 `src/main/claude/agent-runner.ts`의 `createAgentSession(...)` 진입 전 `ToolDefinition.execute` 래퍼 방식으로 구현. 상세는 `docs/cowork-hooks.md` 참조.
- [RESOLVED] GAP-P2-01: Cowork Project hook (`project.onOpen` / `project.onClose` / `project.onSave`) 시그니처 확인 완료. `packages/veluga-main/src/project-reentry.ts` 및 `docs/cowork-hooks.md` Project 섹션 참조.
- [RESOLVED] GAP-P2-02: docx 워터마크는 python-docx 사이드카 방식으로 구현 (`packages/veluga-main/src/docx-adapter.ts`).
- [RESOLVED] GAP-P2-03: 한국어 chunking은 KSS 기반으로 구현. `citation-verifier`의 chunk 분할에 적용.
- [RESOLVED] GAP-P2-04: citation-verifier fuzzy threshold는 Levenshtein 거리 기반으로 시작, 코사인 임계값 0.85 조합. 골든셋 100건 검증 완료.

미해결 항목:

- GAP-P1-03 (코드 서명 인증서): PM 확인 필요, Phase 1 이후 별도 처리.
- GAP-P1-07 (dry-run 로그 분석 회의): Phase 3 enforce 전환 전 PM·보안팀과 합의 필요.
- GAP-P2-05 (last_session_summary 60자 UX): Phase 3 사용자 인터뷰 시 검증 권장.

## 15. KB Connector Plugin Pattern Resolution (2026-05-23)

외부 KB API 명세가 미확정인 상황을 수용하기 위해 KB 연결 방식을 플러그인 패턴으로 추상화했다.

- [PARTIALLY-RESOLVED] GAP-P3-01 (`kb_search` / `kb_metadata` / `kb_hybrid` 입출력 명세): `KbMcpClient` 인터페이스를 구현하는 `KbConnectorPlugin`을 등록하면 어댑터 변환 로직을 플러그인 내부에 캡슐화할 수 있다. 외부 KB 운영 주체와 합의 후 커스텀 플러그인만 교체하면 된다. 완전 해소는 외부 KB 운영 주체와의 명세 합의 후.
- [PARTIALLY-RESOLVED] GAP-P3-02 (외부 KB 서비스 제공 시점·SLA): 빈 `KbConnectorRegistry`(KB OFF 상태)로 Veluga를 먼저 실행하고, KB 준비 시 플러그인을 등록하는 방식으로 타임라인 의존성을 분리했다. SLA 합의는 별도 외부 일정 추적.
- [PARTIALLY-RESOLVED] GAP-P3-04 (PolicyContext 토큰을 외부 KB에 전달): `KbMcpClient.callTool()` 구현 내부에서 헤더 추가 등 전달 방식을 처리하면 된다. 정확한 전달 방식은 외부 KB 운영 주체와 합의 후 플러그인 구현에 반영.
- [PARTIALLY-RESOLVED] GAP-P4-01 (`kb_traverse` 제공 여부): `KbMcpAdapter.hasTraverseTool()`로 런타임에 자동 감지하며, 미제공 시 `kb_metadata` + `kb_hybrid` 조합으로 자동 다운그레이드한다. 외부 KB의 실제 제공 여부는 외부 일정 추적.

상세 사용법: `docs/kb-connector-plugin.md`

---

## 14. Phase 3 & Phase 4 Implementation Resolution (2026-05-23)

Phase 3과 Phase 4 구현 완료 시점 기준으로 아래 GAP이 해소되었다. 외부 KB 실서비스·기관 결재시스템·운영 보안 검수는 Veluga 코드 완료와 분리해 미해결 운영 항목으로 유지한다.

- [RESOLVED] GAP-P3-03: PolicyService RPC client contract는 mock `fetchAll()` 호환 형태로 구현 (`packages/policy-service/src/rpc-client.ts`). Phase 1/2 정책 merge 산출과 호환 검증 완료.
- [RESOLVED] GAP-P3-05: Policy Guard enforce 전환을 전제로 KB 호출 전 `knowledgeGate` 차단과 active Project `external_apis: deny` 차단 검증 완료 (`packages/veluga-main/src/agents/knowledge-gate.ts`).
- [RESOLVED] GAP-P3-06: KB unavailable fallback은 `KbMcpAdapter.healthCheck()`/`knowledgeGate()` 실패 폐쇄 및 project-only 대안 제안으로 구현.
- [RESOLVED] GAP-P4-04: `citation-tracer`는 mock `kb_traverse` 응답 기반으로 `revised_by`/`superseded_by`/`not_found` 판정 및 green/yellow/red 집계 검증 완료.
- [RESOLVED] GAP-P4-05: 봉인 파일은 1차 구현에서 HMAC 방식으로 결정 (`packages/veluga-main/src/approval/seal.ts`). 사내 PKI 전환은 Phase 5+ 후보.
- [RESOLVED] GAP-P4-06: approval-queue 기본 정렬은 녹색 먼저, 제출일 오름차순(오래된 건 먼저)으로 구현 (`packages/veluga-main/src/approval/approval-queue.ts`).
- [RESOLVED] GAP-P4-07: 일괄 승인 부분 실패는 `{ approved, rejected }` 분리 반환으로 표준화 (`ApprovalQueue.bulkApprove`). 결재시스템 connector 에러별 재시도 큐는 운영 확장 항목.

미해결 운영 항목:

- GAP-P3-01 / GAP-P3-02 / GAP-P3-04: 실제 외부 KB 도구 명세, SLA, 인증 전달 방식은 외부 KB 운영 주체와 기관별 합의 필요. (플러그인 패턴으로 코드 교체 지점은 확보됨 — §15 참조)
- GAP-P4-01: 실제 외부 KB `kb_traverse` 제공 여부와 graph 의미 매핑은 외부 KB 운영 주체와 합의 필요.
- GAP-P4-02 / GAP-P4-08: Windows rootless Docker 정책과 base image 보안 검수는 보안팀 승인 필요.
- GAP-P4-03: 1차 출시 기관의 실제 결재시스템 어댑터 선정 필요.
