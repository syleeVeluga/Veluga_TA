# 20 — 검증 방법

> 상위 인덱스: [README.md](README.md) · 이전: [12-phase3-review-patterns.md](12-phase3-review-patterns.md)
> Status: **📝 검증 계획** · 2026-06-03

Deep Agent Mode는 런너, IPC, renderer, policy, audit, plugin runtime을 함께 건드린다. 검증은 단계별 targeted test → 통합 test → root verify → 수동 E2E 순서로 한다.

---

## 1. 필수 명령

- `npm run typecheck`
- `npm run test`
- `npm run verify` — push 전 필수

변경 범위가 `packages/cowork-core`에 집중된 경우에도 최종 gate는 repo root `npm run verify`다.

---

## 2. Phase 1 테스트 매트릭스

| 영역 | 케이스 | 기대 |
|---|---|---|
| shared-types | `BoundedSubSessionRequest` 필수 필드 누락 | 타입/런타임 fixture에서 거부 |
| IPC | `session.continue` options 없음 | 기존 default mode 패리티 |
| IPC | `executionMode='deep_agent'` | renderer→main→runner 전달 |
| policy | `deep_agent.enabled=false` | UI control 미노출, `spawn_agent` 미등록 |
| runner | default mode | customTools에 `spawn_agent` 없음 |
| runner | deep mode + policy allow | customTools에 `spawn_agent` 등록 |
| runner | child session creation | gateway/model/tool wrapping helper 재사용 |
| tool input | 빈 objective/boundaries | tool error + audit deny |
| toolScope | 요청 scope가 정책 밖 | 교집합으로 축소 또는 거부 |
| budget | maxSubSessions 초과 | `BoundedSubSessionBudgetError` |
| budget | tokenBudget 초과 | child 중단 + audit |
| depth | maxDepth 초과 | spawn 거부 |
| cancel | parent cancel | active child abort |
| checkpoint | child start/completion | lineage/status/tokens 기록 |
| renderer | 모바일/데스크톱 입력창 | control과 버튼 overlap 없음 |
| renderer | child event | 활동 패널 표시/정리 |

---

## 3. Phase 2 테스트 매트릭스

| 영역 | 케이스 | 기대 |
|---|---|---|
| catalog | local Veluga manifest | 외부 network 없이 list |
| install | safe fixture | CLI 없이 설치 성공 |
| install | malformed agent md | persona skip + warning |
| scrub | direct LLM endpoint 문자열 | 설치 거부 또는 component disabled |
| scrub | telemetry SDK/endpoint 문자열 | 설치 거부 또는 component disabled |
| toggle | plugin disabled | skills/persona 모두 runtime 제거 |
| toggle | agents component disabled | persona pool 제거 |
| toggle | skills만 enabled | persona pool 미등록 |
| registry | persona id collision | plugin namespace 적용 |
| runner | plugin personaId spawn | 해당 persona systemPrefix 사용 |
| whiteout | catalog/install | 외부 송신 0 |

---

## 4. Phase 3 테스트 매트릭스

| 영역 | 케이스 | 기대 |
|---|---|---|
| Producer-Reviewer | reviewer pass | parent final synthesis 진행 |
| Producer-Reviewer | missing citations | reviewer revise/reject, parent 보수 처리 |
| retry | retry limit 초과 | 중단 + audit |
| Supervisor | maxReplans 이내 | 추가 위임 허용 |
| Supervisor | maxReplans 초과 | tool error + audit deny |
| Fan-out | 일부 optional child 실패 | degraded result로 fan-in |
| HITL | approval payload drift | 실행 거부 |
| fallback | pattern policy deny | default/generic fallback |

---

## 5. 수동 E2E

- [ ] `deep_agent.enabled=false`: 입력창에 딥 에이전트 control이 보이지 않고 기존 채팅이 동일하게 동작한다.
- [ ] `deep_agent.enabled=true`, default mode: `spawn_agent`가 노출되지 않고 기존 단일 세션 응답이 나온다.
- [ ] `deep_agent.enabled=true`, 딥 모드: 복합 과제에서 자식 세션 활동 패널이 나타나고 최종 답변이 생성된다.
- [ ] 부모 취소 버튼: 자식 세션이 중단되고 UI가 running 상태에 남지 않는다.
- [ ] 예산 초과 fixture: 사용자에게 구조화된 실패가 보이고 audit에 budget event가 남는다.
- [ ] 앱 강제 종료 후 재시작: 미완 자식 세션이 정리 또는 재개 통지된다.
- [ ] Phase 2 fixture 설치: safe team만 persona pool에 나타난다.
- [ ] risky fixture 설치: 외부 endpoint/telemetry 스크럽이 동작한다.

---

## 6. 화이트아웃 / 보안 회귀

- [ ] `api.anthropic.com` / `api.openai.com` 하드코딩 scan 통과.
- [ ] telemetry SaaS 문자열 scan 통과.
- [ ] Deep Agent child 세션의 모든 LLM 호출이 `VELUGA_LLM_GATEWAY_URL` 경유임을 테스트 double 또는 log assertion으로 확인.
- [ ] plugin catalog/install 경로가 폐쇄망 profile에서 network fetch를 하지 않음.
- [ ] child toolScope가 부모/정책 허용 도구의 부분집합임을 property test로 확인.
- [ ] audit hash chain이 child event 추가 후에도 무결함.

---

## 7. 성능 / 비용 검증

- [ ] maxSubSessions 1/3 설정별 latency와 token usage 기록.
- [ ] child session 결과 summarization 길이 상한 확인.
- [ ] tokenBudget 초과 시 부모가 무한 대기하지 않음.
- [ ] default mode에서 성능 회귀가 없는지 baseline 비교.

---

## 8. 접근성 / UI 회귀

- [ ] keyboard submit, IME composition, file attachment, pasted image 흐름이 mode control 추가 후에도 유지된다.
- [ ] segmented control은 focus ring과 accessible label을 가진다.
- [ ] 긴 session title, connector badge, model switcher, stop/send 버튼과 overlap 없음.
- [ ] 활동 패널 텍스트가 모바일에서 부모 컨테이너를 넘지 않는다.

---

## 9. 완료 기준

Phase별 구현은 해당 Phase 테스트와 수동 E2E가 끝나야 완료로 표시한다. 최종적으로는 `npm run verify` 통과와 화이트아웃/보안 회귀 확인 전에는 push하지 않는다.
