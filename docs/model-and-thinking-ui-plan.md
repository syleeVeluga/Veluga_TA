# Plan — Latest-model Updates, Chat-header Model Switcher, Thinking-level Selector

> **상태(Status):** ✅ **전체 완료 — 2026-05-25 (commit `3ee82a8`)**
> 계획 수립 + 구현 모두 `main` 브랜치 반영됨. 이 문서는 변경 이력(change-log)으로 보존.
>
> | 단계 | 내용 | 상태 | 핵심 산출물 |
> |------|------|------|------|
> | 계획 수립 | 본 문서 작성 및 `docs/` 등록 | ✅ 완료 | commit `87e2709` |
> | A | Anthropic 4.7 / OpenAI 5.5 / Gemini 3.5-flash 프리셋 갱신 | ✅ 완료 | [api-model-presets.ts](../packages/cowork-core/src/shared/api-model-presets.ts) `(latest)` 태그 부착 |
> | B | `enableThinking` → `thinkingLevel` 스키마 승격 | ✅ 완료 | [shared/thinking.ts](../packages/cowork-core/src/shared/thinking.ts) 신규 + config-store · agent-runner 통합 |
> | C | SettingsAPI 6단계 세그먼트 UI | ✅ 완료 | [ThinkingLevelSegmentedControl.tsx](../packages/cowork-core/src/renderer/components/ThinkingLevelSegmentedControl.tsx) 신규 |
> | D | Chat 헤더 모델 스위처 | ✅ 완료 | [ChatHeaderModelSwitcher.tsx](../packages/cowork-core/src/renderer/components/ChatHeaderModelSwitcher.tsx) 신규 + [ChatView.tsx](../packages/cowork-core/src/renderer/components/ChatView.tsx) 연결 |
> | E2 | `docs/model-and-thinking-ui.md` 아키텍처 노트 | ✅ 완료 | [model-and-thinking-ui.md](model-and-thinking-ui.md) + AGENTS.md 크로스 링크 |
> | i18n | 한국어/영어 라벨 추가 | ✅ 완료 | en.json / ko.json 12 lines each |
> | 테스트 | config-set 마이그레이션 회귀 테스트 | ✅ 완료 | tests/config-store-config-sets.test.ts |

## Context

Veluga_TA (Electron + React, forked from Cowork) currently lists outdated Anthropic
models in its provider presets, hides model switching behind Settings → API even
after multiple provider keys are configured, and exposes pi-ai's six-level
extended-thinking budget as a single binary checkbox. The result is:

- Users on Claude 4.7 cannot pick the latest Opus/Sonnet/Haiku from the dropdown
  ([packages/cowork-core/src/shared/api-model-presets.ts:50-59](packages/cowork-core/src/shared/api-model-presets.ts#L50-L59)
  — current top entry is `claude-opus-4-6`).
- Switching models mid-session requires opening Settings, scrolling to API,
  changing the dropdown, saving, and starting a new session — there is no
  in-chat affordance ([packages/cowork-core/src/renderer/components/ChatView.tsx:322](packages/cowork-core/src/renderer/components/ChatView.tsx#L322)
  shows the model name as static text).
- `agent-runner.ts` already supports `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`
  ([packages/cowork-core/src/main/claude/agent-runner.ts:1542](packages/cowork-core/src/main/claude/agent-runner.ts#L1542))
  but the UI hard-codes the active level to `medium` whenever `enableThinking`
  is true ([…agent-runner.ts:1543](packages/cowork-core/src/main/claude/agent-runner.ts#L1543)).

Goal: keep the existing multi-profile `ApiConfigSet` model intact while
(1) refreshing the curated Anthropic preset list to include 4.7, (2) adding a
chat-header dropdown that lets users hop between *any* configured profile's
model in one click, and (3) replacing the thinking checkbox with a six-segment
control wired to the existing `PiThinkingLevel` type. A short architectural
note will be added under `docs/` so future contributors find the entry points.

---

## Scope summary

| # | Change                                                          | Risk   |
|---|-----------------------------------------------------------------|--------|
| A | Update model presets — add Anthropic 4.7, OpenAI 5.5, Gemini 3.5-flash | low    |
| B | Promote `enableThinking: boolean` → `thinkingLevel: PiThinkingLevel` (with back-compat read) | medium |
| C | Replace SettingsAPI thinking checkbox with 6-segment control    | low    |
| D | New chat-header model switcher (cross-profile dropdown)         | medium |
| E | Add `docs/model-and-thinking-ui.md` describing the surfaces     | low    |

Latest IDs confirmed by user (2026-05-25): **`claude-opus-4-7`**, **`gpt-5.5`**,
**`gemini-3.5-flash`**. These take the top slot in their respective preset
lists; older ids stay below them as fallbacks.

Out of scope: dynamic remote model discovery for non-Ollama providers,
per-message thinking overrides.

---

## A. Refresh model preset lists (Anthropic, OpenAI, Gemini)

**File:** [packages/cowork-core/src/shared/api-model-presets.ts](packages/cowork-core/src/shared/api-model-presets.ts)

### A1. Anthropic (lines 53-59)

```ts
{ id: 'claude-opus-4-7',          name: 'claude-opus-4-7 (latest)' },
{ id: 'claude-opus-4-6',          name: 'claude-opus-4-6' },
{ id: 'claude-sonnet-4-6',        name: 'claude-sonnet-4-6' },
{ id: 'claude-haiku-4-5',         name: 'claude-haiku-4-5' },
{ id: 'claude-sonnet-4-5',        name: 'claude-sonnet-4-5' },
{ id: 'claude-3-7-sonnet-latest', name: 'claude-3-7-sonnet-latest' },
```

### A2. OpenAI (lines 66-74)

```ts
{ id: 'gpt-5.5',         name: 'gpt-5.5 (latest)' },
{ id: 'gpt-5.5-mini',    name: 'gpt-5.5-mini' },
{ id: 'gpt-5.5-nano',    name: 'gpt-5.5-nano' },
{ id: 'gpt-5.4',         name: 'gpt-5.4' },
{ id: 'gpt-5.4-pro',     name: 'gpt-5.4-pro' },
{ id: 'gpt-5.4-mini',    name: 'gpt-5.4-mini' },
{ id: 'gpt-5.3-codex',   name: 'gpt-5.3-codex' },
{ id: 'o3',              name: 'o3' },
{ id: 'o4-mini',         name: 'o4-mini' },
```

Note: only `gpt-5.5` (and the mini/nano siblings if/when they exist) was
confirmed by the user as latest. If `gpt-5.5-mini` / `gpt-5.5-nano` are not
yet published, drop them during implementation and keep only `gpt-5.5`. The
implementation step should grep the `@mariozechner/pi-ai` registry for the
exact ids that resolve cleanly before committing.

### A3. Gemini (lines 81-87)

```ts
{ id: 'gemini-3.5-flash',          name: 'gemini-3.5-flash (latest)' },
{ id: 'gemini-3.1-pro-preview',    name: 'gemini-3.1-pro-preview' },
{ id: 'gemini-3-flash-preview',    name: 'gemini-3-flash-preview' },
{ id: 'gemini-3.1-flash-lite-preview', name: 'gemini-3.1-flash-lite-preview' },
{ id: 'gemini-2.5-pro',            name: 'gemini-2.5-pro' },
{ id: 'gemini-2.5-flash',          name: 'gemini-2.5-flash' },
{ id: 'gemini-2.5-flash-lite',     name: 'gemini-2.5-flash-lite' },
```

### A4. OpenRouter mirror (lines 37-46)

Add the new ids prefixed with their pi-ai provider key:
`anthropic/claude-opus-4-7`, `openai/gpt-5.5`, `google/gemini-3.5-flash`.
Keep existing entries as fallbacks below.

### A5. Curated picks (lines 122-169)

Update `PI_AI_CURATED_PRESETS.anthropic.pick`,
`PI_AI_CURATED_PRESETS.openai.pick`, `PI_AI_CURATED_PRESETS.gemini.pick`, and
`PI_AI_CURATED_PRESETS.openrouter.pick` with the new ids in the same order so
the pi-ai registry resolver in
[packages/cowork-core/src/main/claude/pi-model-resolution.ts](packages/cowork-core/src/main/claude/pi-model-resolution.ts)
accepts them.

### A6. Defaults

In [packages/cowork-core/src/main/config/config-store.ts](packages/cowork-core/src/main/config/config-store.ts)
default profiles (lines 181-222):

- `anthropic` default model: `claude-sonnet-4-6` → `claude-opus-4-7`
- `openai`    default model: `gpt-5.4`          → `gpt-5.5`
- `gemini`    default model: `gemini-2.5-flash` → `gemini-3.5-flash`
- `ollama` / `openrouter` / `custom:*` left as-is.

### A7. Placeholder hints

Update strings in `getModelInputGuidance` (lines 171-228):

- OpenAI placeholder (line 205): `gpt-5.5, gpt-5.4-mini, o3`
- Gemini placeholder (line 219): `gemini-3.5-flash, gemini-3.1-pro-preview, gemini-2.5-flash`
- Anthropic placeholder (line 225): `claude-opus-4-8, claude-opus-4-7`
- OpenRouter placeholder (line 177): `openai/gpt-5.5, anthropic/claude-opus-4-7, google/gemini-3.5-flash`

**Verification:** open Settings → API. For each of Anthropic, OpenAI, Gemini the
dropdown shows the new latest id at the top tagged `(latest)`. Selecting it,
saving, and reloading keeps the choice. `npm run typecheck` passes. Running a
chat against each new model returns a real response (smoke test, not part of CI).

---

## B. Promote `enableThinking` to `thinkingLevel`

The store, the renderer hook, the IPC payload, and the agent runner all carry
the same boolean today. Adding granularity means threading a new field through
each layer while keeping reads of the old field functional so existing
`electron-store` snapshots load cleanly.

**Type definition** — add to
[packages/cowork-core/src/shared](packages/cowork-core/src/shared) (new file or
co-locate next to model presets):
```ts
export type SharedThinkingLevel =
  | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const THINKING_LEVELS: SharedThinkingLevel[] =
  ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
```

**Config schema** — edit
[packages/cowork-core/src/main/config/config-store.ts](packages/cowork-core/src/main/config/config-store.ts)
(`AppConfig` lines 79-133 and `ApiConfigSet` line 75):
- Add `thinkingLevel?: SharedThinkingLevel` next to `enableThinking`.
- On read, if `thinkingLevel` is absent, derive it from `enableThinking` —
  `enableThinking === true ⇒ 'medium'`, else `'off'`. Continue persisting both
  fields so a downgrade still works.

**Renderer hook** — edit
[packages/cowork-core/src/renderer/hooks/useApiConfigState.ts](packages/cowork-core/src/renderer/hooks/useApiConfigState.ts):
- Extend `ConfigStateSnapshot` (line 49-53), `ApiConfigState` (line 559-599),
  reducer action `SET_ENABLE_THINKING` → rename to `SET_THINKING_LEVEL`, and
  `buildApiConfigSnapshot` (line 279-337) / `buildApiConfigDraftSignature`
  (line 359-375) to track the new field.
- Replace the exposed `setEnableThinking` (line 1275-1277) with
  `setThinkingLevel(level: SharedThinkingLevel)`. Keep `enableThinking` as a
  *derived* getter (`thinkingLevel !== 'off'`) so existing callers do not break.

**Agent runner** — edit
[packages/cowork-core/src/main/claude/agent-runner.ts:1540-1543](packages/cowork-core/src/main/claude/agent-runner.ts#L1540-L1543):
read `configStore.get('thinkingLevel')` first, fall back to the boolean derive
rule. Leave the existing hot-swap logic
([…agent-runner.ts:1929-1937](packages/cowork-core/src/main/claude/agent-runner.ts#L1929-L1937))
untouched — it already compares cached vs. requested level, so a finer-grained
level value just works.

**Verification:** existing config files (with only `enableThinking`) load and
show `medium` or `off`. Setting `xhigh` in UI, restarting the app, and starting
a new chat logs `thinkingLevel=xhigh` in `[ClaudeAgentRunner]`.

---

## C. SettingsAPI — 6-segment thinking control

**File:** [packages/cowork-core/src/renderer/components/settings/SettingsAPI.tsx](packages/cowork-core/src/renderer/components/settings/SettingsAPI.tsx)
(lines 411-431)

1. Remove the `<input type="checkbox" id="enable-thinking">` block.
2. Render a segmented control bound to `thinkingLevel` / `setThinkingLevel`:
   ```tsx
   <fieldset>
     <legend>{t('api.thinkingLevel')}</legend>
     <div role="radiogroup" className="grid grid-cols-6 gap-1">
       {THINKING_LEVELS.map((lvl) => (
         <button
           key={lvl}
           role="radio"
           aria-checked={thinkingLevel === lvl}
           onClick={() => setThinkingLevel(lvl)}
           disabled={!modelSupportsReasoning}
           …
         >{t(`api.thinkingLevel.${lvl}`)}</button>
       ))}
     </div>
     <p className="text-xs text-text-muted">{t('api.thinkingLevelHint')}</p>
   </fieldset>
   ```
3. Compute `modelSupportsReasoning` from the resolved model — for the preset
   path, anything matching the `REASONING_MODEL_PATTERN` in
   [packages/cowork-core/src/main/claude/pi-model-resolution.ts:6-7](packages/cowork-core/src/main/claude/pi-model-resolution.ts#L6-L7)
   or the curated Anthropic 4.x family. If unsupported, force `off` visually
   (still allow the user to flip back when the model changes).
4. Update i18n strings in both locale files under
   [packages/cowork-core/src/renderer/i18n](packages/cowork-core/src/renderer/i18n):
   `api.thinkingLevel`, `api.thinkingLevel.off|minimal|low|medium|high|xhigh`,
   `api.thinkingLevelHint`. Keep `api.enableThinking` / `api.enableThinkingHint`
   in the file for any legacy reference until a follow-up cleanup.

**Verification:** clicking each segment persists after Save → reload. With an
Ollama profile selected, the existing Ollama-warning hint
(line 424-428) still renders below the segments.

---

## D. Chat-header model switcher

**File (new):** `packages/cowork-core/src/renderer/components/ChatHeaderModelSwitcher.tsx`
**File (edit):** [packages/cowork-core/src/renderer/components/ChatView.tsx:322](packages/cowork-core/src/renderer/components/ChatView.tsx#L322)
— swap the static `{appConfig?.model || t('chat.noModel')}` for the new
component.

### Behaviour

- Reads the active `ApiConfigSet` from the Zustand store and lists every
  `profile` whose `apiKey` is non-empty (or whose provider is `ollama` /
  loopback). For each profile, expand the preset's `models` array.
- Groups options by provider label (`Anthropic`, `OpenAI`, `Gemini`,
  `OpenRouter`, `Ollama`, `Custom (anthropic|openai|gemini)`).
- Shows a "Thinking" segment underneath the model list (reuses the same
  6-segment control built in step C).
- On select, calls a new IPC `config.setActiveModel({ profileKey, modelId })`
  that:
  1. Updates `currentConfigSet.activeProfileKey` and the chosen profile's
     `model` field via the existing `config.update` path
     (already exposed by `useApiConfigState.handleSave`-style merges).
  2. Returns the new `AppConfig`, which the renderer threads back into the
     store so `ChatView` re-renders.
- When only one profile is configured, the trigger stays clickable but the
  popup lists only that profile's models — matches the user's note
  "키가 하나면 당연히 하나면 되겠지만".

### Implementation notes

- Reuse the existing presets surface — call
  `modelPresetForProfile` (defined in
  [packages/cowork-core/src/renderer/hooks/useApiConfigState.ts:174-188](packages/cowork-core/src/renderer/hooks/useApiConfigState.ts#L174-L188))
  to enumerate models per profile so the dropdown stays consistent with
  Settings.
- Keep `discoveredModels[profileKey]` (Ollama) in mind: if it's populated, use
  it instead of the static preset. The existing `modelOptions` resolver
  (line 934-938) already follows this rule — extract it into a shared
  selector.
- Hot-swap behaviour: `agent-runner.ts` already hot-swaps `thinkingLevel`
  mid-session (line 1929). For model swaps mid-session, follow the same
  pattern — pi-coding-agent supports `piSession.setModel(...)` (verify in
  `@mariozechner/pi-coding-agent` package types before wiring; if not
  supported, force a new session on swap and surface a small "applies to next
  message" hint instead).

### IPC surface

- Add `setActiveModel` to the preload bridge alongside the existing
  `config.update` (see `electronAPI.config` usage in
  `useApiConfigState.ts`). Main-side handler lives in the file that registers
  the other `config:*` IPC handlers — grep `ipcMain.handle('config:` to find
  the registration site and add the new handler next to them.

### Verification

1. Configure two providers (e.g., Anthropic + OpenAI). Header shows the active
   model. Click → both providers' models appear grouped → choose
   `openai/gpt-5.4-pro` → header label updates → next chat message hits OpenAI
   (confirm via main-process log
   `[ClaudeAgentRunner] Model=gpt-5.4-pro`).
2. Open Settings → API: the active profile and model match the header
   selection (one source of truth).
3. With only Anthropic configured, the popup lists only Anthropic models.

---

## E. Documentation

### E1. Plan-of-record (first deliverable, before any code change)

**File (new):** `docs/model-and-thinking-ui-plan.md`

The very first step of implementation is to copy this plan file verbatim into
`docs/model-and-thinking-ui-plan.md` so the work is reviewable in-repo. The
copy lives alongside the PRD docs and serves as the change-log record for this
refactor.

### E2. Architectural reference (added with the code changes)

**File (new):** `docs/model-and-thinking-ui.md`

Short reference (~80 lines) describing the *result*, not the plan:

- Where model presets live and how to add a new model id.
- Where reasoning-model detection runs (`REASONING_MODEL_PATTERN`).
- The `thinkingLevel` type and how the segmented control maps to pi-ai.
- The two model-switching surfaces (Settings → API, chat header) and which
  one is authoritative (config store; both surfaces read/write it).
- Migration note for the `enableThinking → thinkingLevel` schema bump.

Cross-link from [AGENTS.md](AGENTS.md) under the "User-facing settings"
section if such a section exists; otherwise append a one-liner pointer.

---

## Critical files to modify

| File | What changes |
|------|--------------|
| [packages/cowork-core/src/shared/api-model-presets.ts](packages/cowork-core/src/shared/api-model-presets.ts) | Anthropic + OpenRouter model ids; curated picks; placeholder string |
| [packages/cowork-core/src/main/config/config-store.ts](packages/cowork-core/src/main/config/config-store.ts) | Add `thinkingLevel`; default anthropic model → opus-4-7; back-compat read |
| [packages/cowork-core/src/renderer/hooks/useApiConfigState.ts](packages/cowork-core/src/renderer/hooks/useApiConfigState.ts) | Reducer/snapshot/signature changes; rename setter; export shared selector for `modelOptions` |
| [packages/cowork-core/src/renderer/components/settings/SettingsAPI.tsx](packages/cowork-core/src/renderer/components/settings/SettingsAPI.tsx) | Replace checkbox (lines 411-431) with 6-segment control |
| [packages/cowork-core/src/main/claude/agent-runner.ts](packages/cowork-core/src/main/claude/agent-runner.ts) | Read `thinkingLevel` (line 1540-1543); leave hot-swap untouched |
| [packages/cowork-core/src/renderer/components/ChatView.tsx](packages/cowork-core/src/renderer/components/ChatView.tsx) | Replace static label at line 322 with `<ChatHeaderModelSwitcher />` |
| `packages/cowork-core/src/renderer/components/ChatHeaderModelSwitcher.tsx` (new) | Cross-profile model + thinking popup |
| `packages/cowork-core/src/preload/*` + IPC main | New `config.setActiveModel` channel |
| `packages/cowork-core/src/renderer/i18n/{en,ko}.json` | New keys for thinking level segments + switcher labels |
| `docs/model-and-thinking-ui.md` (new) | Architectural note |

---

## End-to-end verification

1. **Type-check & build** — `npm run typecheck && npm run build` (root). No
   new TS errors.
2. **Fresh install path** — wipe `electron-store` → first launch → Settings →
   API → pick Anthropic + paste key → `claude-opus-4-7` is the default model →
   thinking segment defaults to `Off`.
3. **Schema migration** — copy a pre-change `config.json` (with
   `enableThinking: true`) into the store path → relaunch → segmented control
   reads `Medium`; saving with a different level writes both
   `thinkingLevel` and `enableThinking` for safety.
4. **Multi-provider switch** — configure Anthropic + OpenAI keys → header
   dropdown lists both groups → switch from opus-4-7 to gpt-5.4-pro → send a
   message → main log shows `Model=gpt-5.4-pro`, `thinkingLevel=<chosen>`.
5. **Reasoning-model gate** — switch to `gpt-5.4-nano` (no reasoning) → the
   segments dim and clamp to `Off`; switching back to claude-opus-4-7 unlocks
   them.
6. **i18n** — toggle Korean locale → segment labels render in Korean; no
   missing-key warnings in the console.

---

## Open follow-ups (not in this PR)

- OpenAI / Gemini model refresh — defer until the user supplies the canonical
  latest ids; the current `gpt-5.4` / `gemini-3.1-pro-preview` entries already
  look current.
- Per-message thinking override (chat composer toggle) — possible future
  addition once the segmented control proves comfortable in the header.
- Dynamic remote-model discovery for Anthropic/OpenAI/Gemini (parallel to
  Ollama's `/api/tags`) — out of scope but a natural next step.
