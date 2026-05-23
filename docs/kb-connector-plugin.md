# KB Connector Plugin

외부 KB(기관 Knowledge Base)를 Veluga에 연결하는 플러그인 시스템.

## 기본 상태: 비활성(OFF)

KB 연결은 **기본적으로 꺼져 있다.** 플러그인을 등록하지 않으면:

- `IntentRouter`는 모든 메시지를 `use_kb: false`로 분류한다.
- `knowledgeGate`는 즉시 `reason: 'kb_connector_disabled'`를 반환한다.
- `gov-proposal` 등 KB 의존 Skill은 프로젝트 파일 전용 초안을 생성한다.

이 동작은 외부 KB 서버가 준비되지 않은 상태에서도 Veluga를 안전하게 실행할 수 있게 한다.

---

## 아키텍처 요약

```
KbConnectorRegistry          ← 플러그인 등록소 (마스터 스위치)
  └─ KbConnectorPlugin       ← 하나의 KB 백엔드 (인터페이스)
       └─ createAdapter()    ← KbMcpAdapter 생성 팩토리

IntentRouter(gateway, registry)
  └─ registry.isEnabled() == false  →  use_kb: false (분류 전 차단)

knowledgeGate(intent, policy, { kbAvailable, kbConnectorEnabled })
  └─ kbConnectorEnabled == false    →  reason: 'kb_connector_disabled'

draftGovProposal({ kb: null })
  └─                                →  kb_disabled: true, 프로젝트 전용 초안
```

---

## 빠른 시작 — HTTP MCP 엔드포인트

```typescript
import { KbConnectorRegistry, HttpKbConnectorPlugin } from './kb/kb-connector-registry.js';
import { IntentRouter } from './agents/intent-router.js';

const registry = new KbConnectorRegistry();

// KB 서버 URL이 확정된 시점에 한 줄로 활성화
registry.register(new HttpKbConnectorPlugin('기관-kb', 'http://kb.gov.internal'));

const router = new IntentRouter(llmGateway, registry);
```

`HttpKbConnectorPlugin`은 내부적으로 `VELUGA_KB_MCP_URL` 환경변수를 사용하는 `KbMcpAdapter`를 생성한다. URL 대신 환경변수만 설정해도 동작한다:

```typescript
// VELUGA_KB_MCP_URL=http://kb.gov.internal 환경변수가 설정된 경우
registry.register(new HttpKbConnectorPlugin('기관-kb', process.env.VELUGA_KB_MCP_URL!));
```

---

## 런타임 ON/OFF 토글

```typescript
// 점검 시간 — KB 일시 중단
registry.setEnabled('기관-kb', false);

// 점검 종료
registry.setEnabled('기관-kb', true);
```

`setEnabled`는 즉시 반영된다. 이후 들어오는 메시지부터 적용된다.

---

## 커스텀 플러그인 구현 (KB API가 MCP 비호환인 경우)

외부 KB API 명세가 확정되기 전, 또는 MCP 프로토콜을 따르지 않는 경우 `KbMcpClient` 인터페이스를 구현하고 `KbConnectorPlugin`으로 감싼다.

```typescript
import type { KbMcpClient, KbToolName } from '../kb/kb-mcp-adapter.js';
import type { KbConnectorPlugin } from '../kb/kb-connector-registry.js';
import { KbMcpAdapter } from '../kb/kb-mcp-adapter.js';

// 1. 외부 KB API에 맞게 KbMcpClient 구현
class MyKbClient implements KbMcpClient {
  async listTools(): Promise<string[]> {
    // 실제 API로 사용 가능한 도구 목록 조회
    return ['kb_search', 'kb_metadata', 'kb_hybrid'];
  }

  async callTool(name: KbToolName, input: unknown): Promise<unknown> {
    // 실제 KB API 호출 — REST, gRPC, GraphQL 등 무엇이든 가능
    const response = await myKbApi.call(name, input);
    return response.data;
  }
}

// 2. KbConnectorPlugin으로 감싸서 등록
const myPlugin: KbConnectorPlugin = {
  id: 'my-custom-kb',
  enabled: true,
  createAdapter: (opts) => new KbMcpAdapter({ client: new MyKbClient(), ...opts }),
};

registry.register(myPlugin);
```

`KbMcpAdapter`는 입출력 검증(`kb-contract.ts`), 권한 필터링(`kb-redactor.ts`), 타임아웃 처리를 모두 담당하므로 플러그인은 **API 변환만** 책임진다.

---

## `handleUserMessage`에 레지스트리 주입

`ipc-middleware`의 `handleUserMessage`는 세 번째 인수로 레지스트리를 받는다. 생략하면 빈 레지스트리(KB OFF)를 사용한다.

```typescript
import { handleUserMessage } from './ipc-middleware.js';

// KB 없이 동작 (기본값)
await handleUserMessage(message, policy, fallback);

// KB 활성화
await handleUserMessage(message, policy, fallback, registry);
```

---

## KnowledgeGate에서 이유 코드 구분

| `kbConnectorEnabled` 값 | `kbAvailable` 값 | `reason` |
|---|---|---|
| `false` | 무관 | `'kb_connector_disabled'` — 설정 레벨 OFF |
| `true` 또는 미설정 | `false` | `'KB service is temporarily unavailable'` — 런타임 장애 |
| `true` 또는 미설정 | `true` | 스코프·권한 검증 진행 |

`kb_connector_disabled`는 "KB 자체가 이 배포에 없다"는 의미이고, `temporarily unavailable`은 "설정은 됐지만 지금 연결이 안 된다"는 의미다. 감사 로그에서 두 경우를 구분할 수 있다.

---

## GAP 현황 (98_Gap_Analysis.md 연동)

| GAP ID | 내용 | 플러그인 대응 방법 |
|---|---|---|
| GAP-P3-01 | 외부 KB MCP 도구 명세 미확정 | `KbMcpClient` 구현체를 커스텀 플러그인으로 감싸 교체 가능 |
| GAP-P3-02 | 외부 KB 서비스 제공 시점·SLA 미정 | 빈 레지스트리로 시작 → KB 준비되면 플러그인 등록 |
| GAP-P3-04 | 외부 KB 인증·세션 토큰 전달 방식 미정 | `KbMcpClient.callTool()`에서 헤더 추가 (플러그인 내부) |
| GAP-P4-01 | `kb_traverse` 제공 여부 미정 | `listTools()` 결과로 자동 감지 (`KbMcpAdapter.hasTraverseTool()`) |

관련 GAP은 외부 KB 운영 주체와의 합의 후 해소 처리한다.
