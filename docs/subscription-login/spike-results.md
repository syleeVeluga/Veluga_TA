# Phase 1 Spike Results

Date: 2026-05-29
Branch: `feat/subscription-login`

## Automated Checks

Run:

```bash
npm run spike:subscription-login
```

Result:

| Question | Status | Evidence |
| --- | --- | --- |
| Q1. `openai-codex` OAuth provider is usable | PASS | Public `@mariozechner/pi-ai/oauth` export exposes `openaiCodexOAuthProvider` with `login`, `getApiKey`, and `refreshToken`. |
| Q2. ChatGPT Plus base URL is handled by pi-ai | PASS | `getModels('openai-codex')` returns models using API `openai-codex-responses` and base URL `https://chatgpt.com/backend-api`. |
| Q3. Real OAuth browser flow | MANUAL PENDING | Script supports it with `npm --prefix packages/cowork-core run spike:subscription-login -- all`, but it requires a local ChatGPT Plus/Pro account session. |
| Q4. Real LLM response from OAuth access token | MANUAL PENDING | Script supports direct verification with `node scripts/spike/subscription-login-phase1.mjs call --access-token=<token>` from `packages/cowork-core`. |
| Q5. pi-coding-agent integration | PARTIAL PASS | Dry run shows runtime auth must be set under provider `openai-codex`; `setRuntimeApiKey('openai', token)` does not satisfy an `openai-codex` model. |

## Decision

Use pi-ai's built-in `openai-codex` OAuth/provider path for the next phase, but do not wire it as plain `openai`.

Required implementation detail for Phase 2:

```ts
authStorage.setRuntimeApiKey('openai-codex', accessToken);
```

Do not use this for Codex subscription models:

```ts
authStorage.setRuntimeApiKey('openai', accessToken);
```

## Base URL And Model Catalog

Observed selected model:

```text
provider: openai-codex
api: openai-codex-responses
baseUrl: https://chatgpt.com/backend-api
```

The provider code resolves requests to:

```text
https://chatgpt.com/backend-api/codex/responses
```

The provider adds the required `Authorization`, `chatgpt-account-id`, `originator`, and streaming headers internally after extracting `chatgpt_account_id` from the access token.

## Local Manual Commands

Run static checks:

```bash
npm run spike:subscription-login
```

Run OAuth login, then Q4 and Q5 in one process:

```bash
cd packages/cowork-core
node scripts/spike/subscription-login-phase1.mjs all
```

Run Q4 with an existing token without printing the token:

```bash
cd packages/cowork-core
node scripts/spike/subscription-login-phase1.mjs call --access-token=<token>
```

Run Q5 with an existing token:

```bash
cd packages/cowork-core
node scripts/spike/subscription-login-phase1.mjs agent --access-token=<token>
```

The script masks tokens in output and does not persist credentials.
