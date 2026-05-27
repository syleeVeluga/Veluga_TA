# 20 — 검증 방법

> 상위 인덱스: [README.md](README.md)

각 단계의 완료 정의(DoD)를 검증하는 테스트 매트릭스·명령·E2E·회귀 가드.

---

## 1. 명령

- `npm run verify` = `npm run typecheck`(`tsc --noEmit`) + `npm test`(`vitest run`).
- 기존 회귀: [tests/phase1](tests/phase1)(agents-and-audit, policy-merge, whiteout-and-ui), phase2~4.

---

## 2. 단위/통합 테스트 매트릭스

| 영역 | 케이스 | 기대 | 단계 |
|---|---|---|---|
| validate | 사이클 / 누락 의존성 | PLANNING 거부(`{ok:false}`) | P1 |
| executePlan | optional 실패 | `skipped` degrade, 전체 진행 | P1 |
| executePlan | 필수 실패 | 의존 태스크 `aborted` cascade | P1 |
| executePlan | 동시성 | `active.size ≤ maxConcurrency` | P1 |
| executePlan | 데드락 | 미완+무활성 시 강등 후 break | P1 |
| runWithRetry | 일시 오류 | 백오프+지터 N회 후 성공/실패 | P1 |
| runWithRetry | 비재시도 오류 | 즉시 throw(재시도 없음) | P1 |
| withTimeout | 타임아웃 | reject + 리스너 해제(누수 없음) | P1 |
| FSM | 불법 전이 | throw + audit 기록 | P1 |
| planner | 미허가 스코프/스킬 | sanitize 제거 | P1 |
| ipc-middleware | 킬스위치 OFF | `fallback`만 호출(패리티) | P1 |
| checkpoint | 저장/조회/클리어 | 멱등 키로 결과 캐시 | P2 |
| 재개 | 모의 크래시→재시작 | 멱등 태스크 미재실행, 미완 정리 | P2 |
| HITL | 승인 후 payload 변조 | 실행 거부 + `approval.payload_drift` | P2 |
| HITL | require_approval | throw 제거, 승인 큐 enqueue | P2 |
| 취소 | abort | 임시파일 0 잔존, 서브프로세스 kill | P2 |
| 배포 프로파일 | `external_apis='deny'` | 외부 커넥터/웹툴 차단 | P1/P2 |

---

## 3. 수동 E2E

- [ ] `enable_veluga_orchestration=true` + KB·파일 혼합 질의 → 병렬 게이트 동시 진행 확인(태스크 그리드).
- [ ] 비필수 게이트(예: style) 강제 실패 주입 → 응답이 막히지 않고 degrade.
- [ ] 채팅 취소 버튼 → 진행 태스크 중단, 임시파일/서브프로세스 정리.
- [ ] 승인 필요 도구 → `PermissionDialog` 표시 → 승인 후 동일 payload로만 실행.
- [ ] 앱 강제 종료 후 재시작 → 미완 세션 재개/정리 통지.

---

## 4. 관측성 점검

- [ ] audit 로그에 세션 root + 태스크 child 스팬, `gen_ai.usage.*` 토큰 회계, 전이(`from/to_status`) 기록.
- [ ] 해시 체인(`hash_prev`/`hash_self`) 무결, PII 마스킹 동작.

---

## 5. 가드레일 회귀 (양쪽 배포 프로파일)

- [x] [whiteout-and-ui.test.ts](tests/phase1/whiteout-and-ui.test.ts): 게이트웨이 URL 필수 + 공개 LLM 엔드포인트 하드코딩 부재.
- [x] [phase1-guards.yml](.github/workflows/phase1-guards.yml): `api.(anthropic|openai).com` 스캔 통과.
- [ ] 폐쇄망 화이트아웃(mitmproxy 5분 0바이트, [phase1-verification.md](docs/phase1-verification.md)).
- [x] 텔레메트리 SaaS SDK 미도입 확인.

---

## 6. 비용/예산 점검

- [ ] 세션 토큰 예산/최대 스텝 초과 시 `CRITICAL_ERROR`로 안전 중단.
- [ ] `effortTier`별 동시성/예산 스케일 동작.
