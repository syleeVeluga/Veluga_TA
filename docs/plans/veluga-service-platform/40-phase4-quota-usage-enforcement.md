# 40 — Phase 4: Quota & Usage Enforcement

> 목표 한 줄: 조직/그룹/사용자별 사용량을 gateway에서 계측하고, quota 초과를 서버 측에서 강제한다.

---

## 1. 범위

**In scope**

- Usage ledger schema.
- LLM gateway request attribution.
- Veluga model id allowlist validation.
- org/group/user quota policy.
- preflight reservation + final usage commit.
- quota exceeded error contract.
- admin quota UI와 desktop quota summary 연동.

**Out of scope**

- 결제 overage 청구.
- provider별 원가 최적화 자동 라우팅.
- 외부 SaaS analytics SDK.

---

## 2. 원칙

1. **Gateway가 집행자다.** Desktop은 quota를 표시하지만 차단 판단을 신뢰하지 않는다.
2. **Usage event는 audit와 분리하되 연결 가능해야 한다.** usage ledger는 집계와 quota에 최적화하고, audit는 추적과 무결성에 최적화한다.
3. **Group quota는 사용자 quota보다 넓은 guardrail이다.** user limit을 통과해도 group/org limit 초과면 차단한다.
4. **정책 변경은 다음 요청부터 적용한다.** 진행 중 streaming 요청은 reservation 기준으로 처리한다.

---

## 3. Quota 모델

```ts
export interface QuotaPolicy {
  id: string;
  tenantId: string;
  scope:
    | { kind: 'tenant' }
    | { kind: 'group'; groupId: string }
    | { kind: 'user'; userId: string };
  cycle: 'daily' | 'monthly';
  limits: {
    requests?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    maxSingleRequestTokens?: number;
  };
  modelAllowlist?: string[]; // Veluga model ids only; cannot widen tenant/group/user allowlist
  overageBehavior: 'deny' | 'warn';
}

export interface UsageEvent {
  id: string;
  tenantId: string;
  userId: string;
  groupIds: string[];
  sessionId: string;
  model: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}
```

---

## 4. Gateway 흐름

```
Desktop Main
  → gateway request with service token, tenantId, userId, sessionId
  → Gateway validates token
  → Gateway validates requested Veluga model id against service catalog + allowlist
  → Service API quota preflight/reserve
  → Provider call through VELUGA_LLM_GATEWAY_URL route
  → Usage measured
  → Service API usage commit
  → Desktop receives response or quota error
```

Streaming 응답은 시작 시 보수적으로 reservation을 잡고, 완료 시 실제 토큰으로 정산한다. 실패/취소 시 reservation을 release한다.

Gateway는 quota preflight 전에 `model`이 Veluga model id이고 tenant/group/user allowlist 안에 있는지 확인한다. 검증 후에만 server-side route table에서 실제 provider model id와 credential을 찾는다. B2B/B2G 폐쇄망 custom provider도 이 route table에 등록된 정식 route로만 호출한다.

---

## 5. Error contract

```ts
export interface QuotaExceededError {
  code: 'quota_exceeded';
  scope: 'tenant' | 'group' | 'user';
  limitName: 'requests' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'maxSingleRequestTokens';
  cycle: 'daily' | 'monthly';
  resetAt: string;
  message: string;
}
```

Desktop UI는 scope와 resetAt을 표시하고, admin 권한이 있으면 admin quota 화면으로 연결한다.

---

## 6. PolicyContext 연동

`PolicyContext`에 quota 자체를 모두 넣지 않는다. 세션 시작에 필요한 summary와 routing hint만 넣는다.

```ts
export interface PolicyContextUsageSummary {
  tenantRemaining?: number;
  groupRemaining?: number;
  userRemaining?: number;
  resetAt?: string;
  enforcement: 'gateway' | 'disabled';
}
```

상세 quota policy는 service/gateway가 조회한다. desktop은 summary로 UX만 제공한다.

---

## 7. Admin 연동

Admin console의 Quotas 화면은 다음을 제공한다.

- tenant 기본 quota template
- group override
- user override
- model allowlist
- deny/warn behavior
- current cycle usage
- quota 변경 audit trail

변경 즉시 service API의 quota resolver cache를 invalidate한다.

---

## 8. 검증

- Preflight unit test: tenant/group/user 중 가장 제한적인 limit이 적용됨.
- Model allowlist test: allowlist 밖 Veluga model id와 base raw model id가 모두 provider 호출 전에 거부됨.
- Custom route test: 등록되지 않은 custom provider endpoint로는 gateway 호출이 불가능함.
- Gateway integration test: quota 초과 시 provider 호출 전 차단.
- Streaming reservation test: 완료/취소/실패 시 reservation 정산.
- Admin update test: quota 변경 후 다음 request부터 새 limit 적용.
- Desktop UI test: quota exceeded error가 일반 network error와 구분 표시됨.

---

## 9. 완료 조건

- 모든 managed gateway LLM 호출이 tenant/user/session attribution을 갖는다.
- 모든 managed gateway LLM 호출이 Veluga catalog model id를 사용한다.
- 폐쇄망 custom provider 호출도 catalog route와 allowlist를 통과한다.
- quota 초과 요청은 gateway에서 provider 호출 전 차단된다.
- admin quota 변경이 audit에 남고 다음 요청부터 적용된다.
- desktop은 quota summary와 exceeded 상태를 사용자에게 명확히 표시한다.
