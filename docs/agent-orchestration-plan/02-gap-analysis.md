# 02 — 갭 분석 (원안 ↔ 실제 시스템)

> 상위 인덱스: [README.md](README.md) · 이전: [01-background-research.md](01-background-research.md) · 다음: [03-architecture.md](03-architecture.md)

원안(`docs/agent-orchestration-plan.md`의 동적 DAG + 전역 FSM 초안)을 실제 코드베이스와 대조한 점검 결과. 각 항목은 [03-architecture.md](03-architecture.md)에서 어떻게 해소되는지 표기한다.

---

## A-1. (치명) "병렬 에이전트 워커"의 실행 주체 불명확

- 원안은 `VelugaOrchestrator.runActualAgentWorker(task)`로 에이전트를 병렬 실행한다고 가정하나, 그 함수는 더미 스텁이며 실제 LLM 루프 소유자와 충돌.
- 실제 루프는 upstream `pi-coding-agent`가 [packages/cowork-core/src/main/claude/agent-runner.ts](packages/cowork-core/src/main/claude/agent-runner.ts) 단일 세션에서 소유. cowork-core는 포크(수정 금지), Veluga는 `AgentRuntimeExtension` 훅으로만 통합 ([docs/cowork-hooks.md](docs/cowork-hooks.md)).
- → **해소**: 워커 = LLM 생성 주체가 아니라 **단일 세션에 투입할 컨텍스트를 병렬 준비하는 veluga-side I/O 태스크**. (03 §1·§2)

---

## A-2. 에이전트 분류 체계 불일치

- 원안 `TagType`(`kb-reader|file-analyzer|sandbox-ops|style-checker|compliance-checker`)는 실제 7대 에이전트와도 스킬 체계와도 1:1 매핑되지 않음. 실제 7대 중 다수는 워커가 아니라 **게이트/미들웨어**.
- → **해소**: 병렬화 가능한 단위만 `WorkerType`(`kb-retrieval|file-analysis|policy-preaudit|style-card-load`)로 한정. (03 §3.2)

---

## A-3. IPC 채널 설계가 실제와 다름

- 원안 §5는 신규 채널 `veluga:agent-state-changed` + `ipcMain.webContents.send()`. 실제는 **기존 `server-event` 채널**(`sendToRenderer` → preload → [useIPC] → Zustand). cowork-hooks.md는 새 브리지 금지 권고.
- → **해소**: `server-event`에 타입드 이벤트 `veluga.orchestration.state` 추가. (03 §5)

---

## A-4. 영속 계층 기술 오기

- 원안 §6.3은 `better-sqlite3`. 실제 [packages/veluga-main/src/audit-logger.ts](packages/veluga-main/src/audit-logger.ts)는 **Node 내장 `node:sqlite`(`DatabaseSync`)** + 해시 체인(`hash_prev`/`hash_self`) + PII 마스킹.
- → **해소**: 체크포인트 저장소도 `node:sqlite` 재사용. (03 §6.1)

---

## A-5. 오케스트레이터 엔진 코드의 구체 결함

원안 §3.3 샘플 기준:

| # | 결함 | 해소 (03 §3.3) |
|---|---|---|
| 1 | `while (completedResults.size < tasks.length)` — failed/aborted 미카운트 → 단일 실패가 데드락 throw로 **전체 중단** | 터미널 상태 집합으로 종료 판정 + optional degrade |
| 2 | 사이클/누락 의존성 사전 검증 부재 | 실행 전 Kahn 위상정렬 검증 + 의존성 존재 검사 |
| 3 | `AbortController` 생성자 1회 생성 → `abortAll()` 후 영구 aborted, 인스턴스 재사용 불가 | 호출자(세션) 소유 `AbortSignal` 주입 |
| 4 | 태스크별 abort 리스너 미해제(누수) | `finally`에서 `removeEventListener` |
| 5 | `Promise.race(empty)` 취약 | `active.size>0`일 때만 race |
| 6 | 재시도/백오프/멱등/예산 전무 | 지수 백오프+지터, 멱등성 키, 토큰/스텝 예산 |
| 7 | 느슨한 타이핑(`any`) | `Readonly<Record<...>>` + `ContextFragment` |
| 8 | 취소 정리(임시파일/서브프로세스) 코드 미연결 | abort 시 `fs.unlink` + SIGTERM→SIGKILL (03 §6.5) |

---

## A-6. FSM 설계 한계

- 단일 전역 FSM은 "일부 태스크 running + 한 태스크 approval 대기"를 표현 불가.
- 전이 매트릭스가 정의만 있고 강제 메커니즘 없음.
- 승인 후 재개 시 LLM 재실행으로 인자가 바뀌는 버그(approved-payload-drift) 방지책 없음.
- → **해소**: 세션 FSM + 태스크 라이프사이클 분리, 전이 코드 강제(불법 전이 throw+audit), payload 해시 고정. (03 §4)

---

## A-7. 누락된 프로덕션 계층 (전부)

관측성/트레이싱, 토큰·스텝 예산, 재시도+지터, 멱등성, 내구성/재개, 회로차단기, 취소 정리, 도구 출력 신뢰성(프롬프트 인젝션), 최소권한 도구 스코프 — 원안에 없음.
- → **해소**: 03 §6 전반.

---

## A-8. 플래너 프롬프트/계약 부재

- 현재 `IntentRouter.classify`는 `IntentPlan`만 반환, DAG 생성 프롬프트 없음.
- 서브에이전트 계약 4요소가 `payload`에 없음.
- 노력 스케일링 규칙 없음.
- → **해소**: `intent-router.ts`의 `classify→sanitizePlan` 검증 패턴 재사용 + 4요소·effort-scaling을 프롬프트/타입에 명문화. (03 §7)

---

## A-9. (신규) 배포 프로파일 미고려

- 원안은 망 모드를 다루지 않음. 실제 제품은 폐쇄망을 코드로 강제(게이트웨이 불변식·화이트아웃·텔레메트리 금지)하나 연결망도 고려 필요.
- → **해소**: 게이트웨이 추상화로 망-모드 추상화, 프로파일은 정책(`external_apis` 등)에서 파생. (03 §6.6)
