
# Project Guidelines

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## 5. Project Overview

Veluga is an enterprise AI agent platform built for closed-network government and finance workflows. It forks [Open Cowork](https://github.com/open-cowork/cowork) (MIT) and layers policy enforcement, KB integration, approval routing, and audit on top.

**Core principles:**

- **Policy-first**: `PolicyContext` is the single source of truth for all authorization. Never bypass it.
- **Audit-everything**: All tool calls, agent decisions, and LLM outputs go to the append-only SQLite audit log.
- **Trust tags**: Every LLM output sentence must carry one of: `[src:id|kb]`, `[src:id|nb]`, `[parametric:high]`, `[parametric:low]`.
- **LLM via gateway**: All LLM calls must go through `VELUGA_LLM_GATEWAY_URL`. Never hardcode `api.anthropic.com` or `api.openai.com`.
- **Feature toggle**: `VelugaModeToggle` lets users run vanilla Open Cowork. Don't break it.

## 6. Repository Structure

```text
Veluga_TA/
├── packages/
│   ├── cowork-core/          # Upstream Open Cowork fork (Electron + React)
│   │   ├── src/main/         # Electron main process
│   │   ├── src/renderer/     # React UI
│   │   └── src/preload/      # IPC bridge
│   ├── veluga-main/src/      # Core Veluga logic
│   │   ├── agents/           # 7 system agents (intent-router, knowledge-gate, etc.)
│   │   ├── kb/               # KB connector, MCP adapter, redactor, citation-tracer
│   │   ├── approval/         # Approval workflow connectors
│   │   ├── sandbox/          # WSL/Lima sandbox ops
│   │   ├── llm-gateway.ts    # All LLM routing — use this, never direct SDK calls
│   │   ├── policy-injector.ts
│   │   └── audit-logger.ts
│   ├── veluga-renderer/src/  # Electron renderer adapter (React components + i18n)
│   ├── veluga-ui/            # White-label theme and i18n
│   ├── policy-service/src/   # 5-tier policy merge engine + SSO
│   └── shared-types/src/     # Canonical TypeScript schemas (policy, intent, audit, kb, project)
├── skills/
│   ├── core/                 # compliance-checker, system-self-help
│   └── domain/               # Institution-specific skills (extensible)
├── tests/
│   ├── phase1/               # Foundation, agents, audit, policy, whiteout, UI
│   ├── phase2/               # Project management
│   ├── phase3/               # KB integration
│   └── phase4/               # Approval workflows
├── dev-policies/             # institution/org/project/user YAML policy fixtures
├── docs/                     # Architecture specs and PRD
└── .github/workflows/        # CI guards (phase1-guards.yml)
```

## 7. Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop | Electron 35, Node ≥22 |
| UI | React 18, TypeScript 5.3 (strict), Vite 7, TailwindCSS 3 |
| State | Zustand 5 |
| LLM SDKs | Anthropic 0.39, OpenAI 6.32, Google GenAI 1.44 |
| Agent protocol | MCP SDK 1.26 (`@modelcontextprotocol/sdk`) |
| Persistence | better-sqlite3 12 (local DB + audit log) |
| i18n | i18next 25, react-i18next 16 |
| Testing | Vitest 4, @vitest/coverage-v8 |
| Linting | ESLint 8, Prettier 3, CommitLint 20 |
| Packaging | electron-builder 26 |

## 8. Development Commands

```bash
# Root — runs across all packages
npm run verify          # typecheck + test (required before PR)
npm run typecheck       # TypeScript validation only
npm run test            # Full test suite (vitest)

# cowork-core package
npm run dev             # Dev server (Electron + Vite HMR)
npm run build           # Production build (Windows/Mac)
npm run lint            # ESLint
npm run format          # Prettier
npm run test:coverage   # Coverage report

# After native dependency changes
npm run rebuild         # Rebuild better-sqlite3 for Electron ABI
```

Always run `npm run verify` before pushing. CI will reject failures.

## 9. CI Guards (Never Break These)

The CI workflow (`.github/workflows/phase1-guards.yml`) runs `npm run verify` and three hard checks:

| Guard | Rule |
| --- | --- |
| **Telemetry** | No posthog, Sentry, Vercel Analytics, Datadog, Segment, Mixpanel, or react-ga |
| **LLM endpoint** | No hardcoded `api.anthropic.com` or `api.openai.com` — use `VELUGA_LLM_GATEWAY_URL` |
| **License** | `packages/cowork-core/LICENSE` must exist (MIT upstream attribution) |

If you add a new dependency that includes telemetry in its client bundle, flag it explicitly.

## 10. Key Architectural Invariants

**Agents (packages/veluga-main/src/agents/):**
The 7 system agents form a fixed pipeline. Don't add new agents without discussion. Order: `intent-router` → `policy-guard` → `knowledge-gate` → `skill-resolver` → `general-planner` → `general-responder` → `compliance-checker`.

**Policy (packages/policy-service/src/merge.ts):**
Policies merge across 5 tiers: `institution → org → project → user → session`. Lower tiers can only restrict, never escalate. Don't break this invariant.

**KB integration (packages/veluga-main/src/kb/):**
KB connectors are external MCP servers. Veluga consumes them via `kb-mcp-adapter.ts`. Never call a KB connector directly — always go through the registry.

**Shared types (packages/shared-types/src/):**
`PolicyContext`, `IntentPlan`, `AuditEntry`, `KbResult`, `ProjectMeta` are the canonical contracts between packages. If you need a new cross-package type, add it here and export from `index.ts`.

**Environment variables:**

- `ANTHROPIC_AUTH_TOKEN` — API key (never commit)
- `CLAUDE_MODEL` — model override
- `CLAUDE_CODE_PATH` — Windows path, must use forward slashes
- `VELUGA_LLM_GATEWAY_URL` — all LLM traffic must route here

## 11. Testing Conventions

- Tests live in `tests/phase{N}/` mirroring the PRD phases.
- Test files match `tests/**/*.test.ts` (vitest picks them up automatically).
- No mocking of the policy engine or audit logger — they are cheap and must be exercised.
- For agent tests, use the fixture policies in `dev-policies/`.
- Coverage is tracked but not gated; focus on behavior tests over coverage%.

## 12. Commit Conventions

This repo uses CommitLint. Format: `type(scope): message`

```text
feat(kb): add citation-tracer fallback for empty source IDs
fix(policy): correct tier-merge order for session overrides
test(phase2): add project reentry smoke tests
docs(agents): update intent-router decision table
```

Common types: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `ci`

## 13. User-Facing Settings

Model preset, chat-header model switching, and `thinkingLevel` UI architecture are documented in `docs/model-and-thinking-ui.md`.
