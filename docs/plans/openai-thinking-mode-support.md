# OpenAI Thinking Mode Support Plan

## Summary

- Official OpenAI documentation confirms that GPT-5 family models such as `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini` support `reasoning.effort`.
- The current app disables the Settings Thinking control for OpenAI models because `modelSupportsReasoning()` does not recognize GPT-5 or o-series model IDs as reasoning-capable.
- This plan is limited to fixing OpenAI reasoning model detection and request delivery. It does not redesign the Settings UI or change model preset lists.

Official references:

- Reasoning guide: https://developers.openai.com/api/docs/guides/reasoning
- Latest model guide: https://developers.openai.com/api/docs/guides/latest-model
- Model list: https://developers.openai.com/api/docs/models

## Key Changes

- Update `packages/cowork-core/src/shared/thinking.ts` so `modelSupportsReasoning()` treats OpenAI reasoning model IDs as supported, including prefixed IDs such as `openai/gpt-5.5`.
- Include `gpt-5`, `gpt-5.x`, `gpt-5.x-mini`, `gpt-5.x-nano`, `gpt-5.x-pro`, `gpt-5.x-codex*`, `o1*`, `o3*`, and `o4-mini*` as reasoning-capable.
- Keep non-reasoning models such as `gpt-4.1*`, `gpt-5-image*`, and unrelated model families unsupported.
- Update synthetic model fallback logic in `packages/cowork-core/src/main/claude/pi-model-resolution.ts` so unknown but valid OpenAI GPT-5 reasoning models still get `reasoning: true`.
- Update the existing `@mariozechner/pi-ai` patch so `supportsXhigh()` includes `gpt-5.5`, preventing `xhigh` from being clamped to `high`.

## Test Plan

- Add or extend tests for `modelSupportsReasoning()`:
  - true: `gpt-5.5`, `openai/gpt-5.5`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.4-pro`, `o3`, `o4-mini`
  - false: `gpt-4.1-mini`, `gpt-5-image`, `llama-4-scout`
- Update `config-store-config-sets.test.ts` so switching to `openai/gpt-5.5` preserves an existing non-off `thinkingLevel`.
- Keep a non-reasoning switch test, but use a truly non-reasoning model such as `openai/gpt-4.1-mini`.
- Extend `pi-model-resolution.test.ts` so synthetic `gpt-5.5` and `gpt-5.4` resolve as `reasoning: true`, while `gpt-4.1-mini` remains `reasoning: false`.

Verification commands for the implementation phase:

```bash
npm --prefix packages/cowork-core test -- --run tests/thinking.test.ts tests/config-store-config-sets.test.ts tests/pi-model-resolution.test.ts
npm run verify
```

## Assumptions

- OpenAI official docs are the source of truth for GPT-5 reasoning support.
- The existing `off/minimal/low/medium/high/xhigh` Settings control remains unchanged.
- `minimal` remains available in the UI for compatibility; OpenAI-specific level filtering is out of scope.
- This plan does not update model presets because `gpt-5.5` is already present in the current preset list.
