# Model And Thinking UI

This note describes the implemented model preset, model switching, and thinking
level surfaces in `packages/cowork-core`.

## Model Presets

Curated provider models live in
`packages/cowork-core/src/shared/api-model-presets.ts`.

To add a new curated model:

1. Add it to `API_PROVIDER_PRESETS.<provider>.models`.
2. Add the same id to `PI_AI_CURATED_PRESETS.<provider>.pick`.
3. If OpenRouter should expose it, add the provider-prefixed id to both the
   `openrouter` preset list and the `openrouter.pick` list.
4. Update `getModelInputGuidance` placeholders when the new id should be shown
   as the recommended example.

`getPiAiModelPresets()` in
`packages/cowork-core/src/main/config/config-store.ts` overlays pi-ai registry
names when available, but keeps curated fallback ids so a newer user-confirmed
model can appear before the bundled pi-ai registry is updated.

Default first-run profile models are defined in `defaultProfiles` in
`config-store.ts`.

## Thinking Level

The shared type is in `packages/cowork-core/src/shared/thinking.ts`:

```ts
export type SharedThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
```

`thinkingLevel` is the canonical setting. `enableThinking` is still persisted
and read for downgrade and old-config compatibility:

- missing `thinkingLevel` + `enableThinking: true` maps to `medium`
- missing `thinkingLevel` + false or missing `enableThinking` maps to `off`
- saving a level also writes `enableThinking = thinkingLevel !== 'off'`

The config migration and normalization live in `config-store.ts`. The renderer
state threading lives in
`packages/cowork-core/src/renderer/hooks/useApiConfigState.ts`. The agent
runner reads the normalized level in
`packages/cowork-core/src/main/claude/agent-runner.ts` before creating or
reusing a pi-coding-agent session.

## Reasoning Support

Reasoning detection uses `modelSupportsReasoning()` in
`packages/cowork-core/src/shared/thinking.ts`. It shares
`REASONING_MODEL_PATTERN` with
`packages/cowork-core/src/main/claude/pi-model-resolution.ts` and also treats
the curated Claude 4.x family as reasoning-capable.

The UI disables the six-level control when the selected model does not support
reasoning. Disabling is visual and does not destroy the saved preference, so a
user can switch back to a reasoning-capable model and keep the previous level.

## UI Surfaces

Settings -> API renders the six-level selector in
`packages/cowork-core/src/renderer/components/settings/SettingsAPI.tsx` via
`ThinkingLevelSegmentedControl`.

The chat composer header renders
`packages/cowork-core/src/renderer/components/ChatHeaderModelSwitcher.tsx`.
It reads the active `AppConfig`, groups configured profiles by provider, and
switches models through `config.setActiveModel`.

The authoritative state is still the config store. Settings -> API and the chat
header both read and write the same active config set, active profile, model,
and thinking level.

## IPC

The model switcher uses `config.setActiveModel({ profileKey, modelId })`,
exposed in `packages/cowork-core/src/preload/index.ts` and handled in
`packages/cowork-core/src/main/index.ts`. The handler updates the active
profile and selected model through `configStore.update()`, then emits the same
`config.status` event used by the rest of the app.
