# 11 — Phase 2: 내구성 & HITL (상세 구현)

> 상위 인덱스: [README.md](README.md) · 이전: [10-phase1-orchestrator-worker.md](10-phase1-orchestrator-worker.md) · 다음: [12-phase3-dynamic-optional.md](12-phase3-dynamic-optional.md)

**목표**: 크래시 후 재개(`node:sqlite` 체크포인트), HITL 승인 payload 해시 고정 + 승인 큐 연동, 취소 시 리소스 정리.

**전제**: Phase 1 완료. **완료 정의(DoD)**: 모의 크래시 후 재시작 시 멱등 태스크가 재실행되지 않고 미완만 재개/정리되며, 승인된 payload가 재개 시 변조되면 실행이 거부되고, 취소 시 임시파일/서브프로세스가 정리된다.

---

## 1. 체크포인트 저장소 — `packages/veluga-main/src/orchestrator/checkpoint-store.ts` (신규)

- [ ] [audit-logger.ts](packages/veluga-main/src/audit-logger.ts)와 동일한 `node:sqlite`(`DatabaseSync`) 패턴 사용(`async init()`로 테이블 생성).
- [ ] 스키마:

```sql
CREATE TABLE IF NOT EXISTS orchestration_checkpoint (
  session_id   TEXT PRIMARY KEY,
  state        TEXT NOT NULL,        -- 세션 FSM 상태
  plan_json    TEXT NOT NULL,        -- WorkPlan + 태스크 상태 직렬화
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orchestration_task_result (
  session_id      TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,     -- 멱등 캐시 키
  result_json     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (session_id, idempotency_key)
);
```

- [ ] API: `save(sessionId, state, plan)`, `loadOpenSessions()`, `getCachedResult(sessionId, idempotencyKey)`, `putResult(...)`, `clear(sessionId)`.
- **수용 기준**: 부작용 태스크 완료 시 결과가 멱등 키로 저장.

---

## 2. 엔진 결선 (orchestrator.ts 보강)

- [ ] 태스크 상태 전이마다 `checkpointStore.save(...)` 호출(단계 체크포인트).
- [ ] 태스크 실행 직전 `getCachedResult`로 멱등 캐시 조회 → 있으면 재실행 없이 `completed` 처리.
- [ ] 정상 완료 시 `clear(sessionId)`로 체크포인트 정리(audit는 보존).

---

## 3. 재개 로직 — 앱 시작 시

- [ ] 부팅 시 `loadOpenSessions()` → 미완 세션 발견 시:
  - 멱등 캐시가 있는 `running`/`completed` 태스크는 캐시로 복원.
  - 부작용 없는 I/O 게이트(`kb/file/policy/style`)는 안전 재실행.
  - 재개 불가/모호한 태스크는 `failed`로 깔끔히 종료하고 사용자 통지(`server-event`).
- [ ] 결정성 주의(Temporal 차용): 재개 경로는 비결정 입력을 캐시에서 읽어 동일 결과 보장.
- **수용 기준**: 모의 크래시(프로세스 강제 종료) 후 재시작 시 멱등 태스크 미재실행.

---

## 4. HITL 승인 payload 고정 — agent-state-manager.ts + tool-interceptor.ts

- [ ] `AWAITING_APPROVAL` 진입 시 승인 대상 도구 인자를 정규화 후 `sha256` 해시로 고정해 체크포인트/큐에 기록.
- [ ] 승인 응답 수신·재개 시 현재 인자 해시와 비교 → 불일치면 실행 거부 + audit(`approval.payload_drift`).
- [ ] [tool-interceptor.ts](packages/veluga-main/src/tool-interceptor.ts): 현재 `require_approval`에서 `throw`하는 부분을 [approval-queue.ts](packages/veluga-main/src/approval/approval-queue.ts) enqueue + cowork `SessionManager.requestPermission`/`permission.request` 연동으로 교체. 응답은 `permission.response` 경로로 수신.
- [ ] FSM: `RUNNING_PARALLEL → AWAITING_APPROVAL → RUNNING_PARALLEL|IDLE`.
- **수용 기준**: 승인 후 인자 변조 시 실행 거부 테스트. 기존 `PermissionDialog` UI 재사용.

---

## 5. 취소·정리 — orchestrator.ts `abortAll` + 워커

- [ ] 취소 IPC(`cancel-agent-session`) → 세션 `AbortController.abort()`.
- [ ] 워커는 abort 시 진행 중 임시파일 경로를 추적해 `fs.promises.unlink`로 정리(특히 `dataPassingMode='project_temp'`).
- [ ] 서브프로세스(WSL/Lima/Docker)는 SIGTERM → 5s 후 SIGKILL 에스컬레이션. 'error'/'exit' 리스너로 정리 확인.
- [ ] 부분 부작용은 멱등 키로 추후 중복 방지(보상은 Phase 3 검토).
- **수용 기준**: 취소 후 임시파일 0개 잔존, 서브프로세스 종료 확인.

---

## 6. 테스트

- [ ] 체크포인트 저장/조회/클리어.
- [ ] 모의 크래시 → 재시작 재개(멱등 스킵, 미완 정리).
- [ ] payload 해시 drift 거부.
- [ ] 승인 큐 연동(throw 제거 회귀).
- [ ] 취소 시 임시파일 정리 + 서브프로세스 kill.

---

## 7. 리스크 / 주의

- `node:sqlite` 동시 쓰기 → 단일 라이터(메인 프로세스)로 직렬화, audit DB와 파일 분리 가능.
- 재개 결정성: 비결정 워커 출력은 반드시 캐시에서 복원(재실행 분기 금지).
- 승인 대기 중 정책 버전 변경 가능 → 재개 시 `policy_version_id` 재검증.
