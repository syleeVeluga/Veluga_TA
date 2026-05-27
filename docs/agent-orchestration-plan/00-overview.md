# 00 — 개요 (Overview)

> 상위 인덱스: [README.md](README.md)

---

## 목적

현재 Veluga의 에이전트 흐름은 고정 순차 파이프라인(intent-router → policy-guard → knowledge-gate → skill-resolver → general-planner → general-responder → compliance-checker)이다. 서로 데이터 의존성이 없는 컨텍스트 수집(KB 검색·파일 분석·정책 사전감사·스타일카드 로딩)이 직렬화되어 지연이 누적되고, 부분 복구·승인 대기·강제 취소 같은 유동 제어가 추적되지 않으며, 크래시 시 진행 상태가 소실된다.

이 계획은 Anthropic이 검증한 **오케스트레이터-워커 워크플로우**를 채택해 위 문제를 해결하되, **"단순하게 시작하고 입증될 때만 복잡도를 추가한다"** 원칙과 현재 시스템(cowork 포크·게이트웨이·폐쇄망)의 하드 제약을 동시에 만족시킨다.

---

## 범위 (In / Out)

**In scope**

- 독립 I/O 컨텍스트 수집의 제한된 병렬화(KB·파일·정책·스타일).
- 태스크별 라이프사이클 + 세션 전역 FSM(전이 코드 강제).
- 사전 검증(사이클/누락 의존성), 부분 실패 의미론(degrade vs cascade), 재시도+지터, 취소 전파.
- `node:sqlite` 체크포인트 기반 크래시 재개.
- 관측성 스팬, 토큰/스텝 예산, 보안 하드닝, HITL 승인 payload 고정.
- 폐쇄망/연결망 양쪽을 지원하는 배포 프로파일 인식.

**Out of scope (현 단계)**

- 포크 내부(`cowork-core`) 직접 수정.
- 완전 동적 LLM 생성 DAG 토폴로지(효과 입증 시 Phase 3에서만).
- 병렬 LLM 생성 서브세션(필요 입증 시 Phase 3의 bounded sub-session으로만).
- 외부 SaaS 트레이싱 SDK 도입(가드레일 금지).

---

## 확정 결정 (사용자 승인)

| 항목 | 결정 |
|---|---|
| 아키텍처 | **오케스트레이터-워커로 재정의** (원안의 범용 동적 DAG 대체) |
| 구현 방식 | **직접 구현 + 검증 패턴 차용** (LangGraph reducer/checkpoint, Temporal 멱등/재시도) |
| 내구성 | **`node:sqlite` 체크포인트/재개 포함** |
| 배포 | **폐쇄망 + 연결망 양쪽 프로파일 인식** |

---

## 현재 상태 ↔ 목표 상태

| 측면 | 현재 | 목표 |
|---|---|---|
| 컨텍스트 수집 | 직렬 | 제한 병렬(독립 I/O만) |
| 상태 관리 | 암묵적/추적 불가 | 세션 FSM + 태스크 라이프사이클, 전이 강제 |
| 실패 처리 | 단일 실패가 전체 영향 | optional=degrade / 필수=cascade abort |
| 내구성 | 없음(메모리 휘발) | SQLite 체크포인트 → 재개 |
| 관측성 | tool 호출 audit | 세션/태스크 스팬 + 토큰 회계(OTel GenAI) |
| 비용 가드 | 없음 | 세션 토큰/스텝 예산 + 노력 스케일링 |
| HITL | `require_approval`에서 throw | 승인 큐 연동 + payload 해시 고정 |
| 생성 주체 | 단일 cowork 세션 | (유지) 단일 cowork 세션 |

---

## 하드 제약 (설계가 반드시 지켜야 할 사실)

1. **LLM 에이전트 루프 비소유**: upstream `pi-coding-agent` SDK가 [packages/cowork-core/src/main/claude/agent-runner.ts](packages/cowork-core/src/main/claude/agent-runner.ts)의 단일 세션(`createAgentSession`)에서 소유. 모델이 agentic loop 안에서 도구 호출 결정.
2. **cowork-core는 포크(수정 금지)**: `AgentRuntimeExtension.beforeSessionRun()/afterSessionRun()` + `ToolDefinition.execute` 래퍼로만 통합 ([docs/cowork-hooks.md](docs/cowork-hooks.md)).
3. **게이트웨이 불변식**: 모든 LLM은 `VELUGA_LLM_GATEWAY_URL` 경유. `api.anthropic.com`/`api.openai.com` 하드코딩 금지 — CI([.github/workflows/phase1-guards.yml](.github/workflows/phase1-guards.yml))가 차단. 텔레메트리 SaaS SDK 금지. 화이트아웃(패키지 앱 공개 엔드포인트로 0바이트, [docs/phase1-verification.md](docs/phase1-verification.md)).
4. **영속 계층**: Node 내장 `node:sqlite`(`DatabaseSync`) + 해시 체인 + PII 마스킹 ([packages/veluga-main/src/audit-logger.ts](packages/veluga-main/src/audit-logger.ts)). (`better-sqlite3`는 cowork-core 의존성으로 별개.)
5. **IPC**: Main→Renderer는 기존 `server-event` 채널(`sendToRenderer` → preload → `useIPC` → Zustand). 새 브리지 금지.
6. **킬스위치**: `policy.veluga.enable_veluga_orchestration=false`면 바닐라 Open Cowork로 바이패스.

> 결론: "포크 안에서 LLM 워커를 다수 병렬 기동"은 불가. **워커 = 단일 cowork 세션에 투입할 컨텍스트를 병렬 준비하는 veluga-side I/O 태스크**.

---

## 성공 기준

- 독립 컨텍스트 수집이 병렬로 진행되어 체감 지연 감소(E2E 측정).
- 단일 비필수 게이트 실패가 전체 응답을 막지 않음(degrade 동작).
- 크래시 후 재시작 시 멱등 태스크가 재실행되지 않고 미완만 재개/정리.
- 모든 태스크 전이·토큰 사용량이 audit/스팬에 기록되고 해시 체인 무결.
- 킬스위치 OFF 시 upstream 동작과 패리티(회귀 없음).
- 폐쇄망 화이트아웃 0바이트 유지 + 연결망 egress 허용목록 동작.
