# Veluga Agents

> *Cowork(open source)가 골격을 주고, Skill이 능력을 주고, 정책이 권한을 주고, 시스템 에이전트 7개가 결정만 한다.*

폐쇄망 공공기관·금융권 업무 담당자가 결재 라인까지 안전하게 흘려보낼 수 있는 agentic 작업 환경.  
**Open Cowork(MIT)를 독립 repo의 clone snapshot으로 가져와 화이트라벨링**한 Electron 데스크톱 앱 기반이며, 기관 KB(Vector DB, RDB, Graph)는 외부에서 MCP/API로 제공받는 **consumer** 역할만 수행한다.

---

## 시스템 구성

| 패키지 | 역할 |
|---|---|
| `packages/cowork-core` | Open Cowork 업스트림 clone snapshot (repo 내 vendored source, 직접 수정 금지) |
| `packages/veluga-main` | 핵심 에이전트 A1~A7, LLM 게이트웨이, 정책 가드, 감사 로거, 샌드박스, 결재 커넥터 |
| `packages/veluga-renderer` | Electron 렌더러 어댑터, PolicyProvider, UI 바인딩 |
| `packages/veluga-ui` | 화이트라벨 UI 컴포넌트 (로고, 스플래시, 설정, 크레딧) |
| `packages/policy-service` | PolicyContext 빌더, 5-티어 머지 엔진, 모의 SSO, YAML 로더 |
| `packages/shared-types` | 공유 TypeScript 타입 (PolicyContext, IntentPlan, Audit, Clearance 등) |
| `skills/core` | 핵심 Skill: `compliance-checker`, `system-self-help` |
| `skills/domain` | 기관별 도메인 Skill: `gov-proposal` (확장 가능) |

---

## 디렉토리 구조

```
Veluga_TA/
├── docs/                       # 문서 맵: docs/README.md (수명 기준)
│   ├── README.md               # 문서 네비게이션 허브
│   ├── reference/              # 상시 참조 — 현재 코드 계약 (에이전트 신뢰 대상)
│   │   ├── cowork-hooks.md · whiteout-endpoints.md · sandbox-ops.md
│   │   ├── kb-connector-plugin.md · kb-traverse-consumer.md
│   │   ├── connector-approval-spec.md · markdown-mermaid-integration.md
│   │   └── model-and-thinking-ui.md · phase1-verification.md
│   ├── plans/                  # 기능별 설계 계획 (구현 시점 스냅샷) — plans/README.md
│       ├── agent-orchestration/ · ask-user-question/
│       ├── file-viewer-panel/ · subscription-login/
│       └── model-and-thinking-ui.md · network-error-handling.md · 기타 *.md
│   ├── prd/                    # 아카이브 안내 스텁
│   └── archive/
│       └── prd-initial-draft/  # 초기 PRD 초안 보관본 (현재 요구사항 아님)
├── packages/                   # 모노레포 패키지
├── skills/                     # core / domain Skill
├── tests/                      # phase1~4 테스트 스위트
├── dev-policies/               # institution·org·project·user YAML
└── package.json
```

---

## 개발 환경 설정

**요건**: Node ≥ 22, npm ≥ 10

```bash
# 업스트림 의존성 설치 (packages/cowork-core)
cd packages/cowork-core
npm ci

# 루트 타입체크 + 전체 테스트
cd ../..
npm run verify
```

> `better-sqlite3`를 Electron ABI로 재빌드해야 할 경우:
> ```bash
> cd packages/cowork-core && npm rebuild better-sqlite3
> ```

---

## 주요 문서

| 문서 | 용도 |
|---|---|
| [docs/README.md](docs/README.md) | 문서 네비게이션 허브 — reference / plans / archive 수명 기준 맵 |
| [docs/reference/cowork-hooks.md](docs/reference/cowork-hooks.md) | Veluga 어댑터가 붙는 Cowork IPC 훅 진입점 |
| [docs/archive/prd-initial-draft/](docs/archive/prd-initial-draft/) | 초기 PRD 초안 보관본 — 현재 요구사항이나 구현 지침으로 사용하지 않음 |
