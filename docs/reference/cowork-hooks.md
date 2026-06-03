# Cowork Hook Mapping

Baseline source: `packages/cowork-core` at upstream commit `d4318943fb070d0863bed930eb70a95c6e7c4487`.

## Confirmed Integration Points

| Veluga need | Upstream hook candidate | Status | Integration note |
|---|---|---|---|
| Renderer-to-main IPC entry for Veluga Mode and fast-path routing | `src/preload/index.ts` exposes `window.electronAPI.send()` over `ipcRenderer.send('client-event', event)` and `window.electronAPI.invoke()` over `ipcRenderer.invoke('client-invoke', event)`. `src/main/index.ts` handles these at `ipcMain.on('client-event', ...)` and `ipcMain.handle('client-invoke', ...)`, both delegating to `handleClientEvent`. | Confirmed | Add a Veluga adapter before the `handleClientEvent` session switch, or wrap `handleClientEvent` with a small shim. This is the cleanest point for `VelugaIpcMiddleware`. |
| First message / session start | `src/main/index.ts` routes `ClientEvent` type `session.start` to `SessionManager.startSession(...)`. `src/main/session/session-manager.ts` creates the `Session`, persists it, then calls `enqueuePrompt(...)`. | Confirmed | `PolicyContextInjector` can run before `sm.startSession(...)` or at the start of `SessionManager.startSession(...)`. Prefer the outer IPC route if avoiding upstream edits; use a shim if session-local state must be attached. |
| Prompt processing before model call | `src/main/session/session-manager.ts` `processPrompt(...)` prepares attachments, saves the user message, and calls `this.agentRunner.run(...)`. `src/main/claude/agent-runner.ts` invokes `AgentRuntimeExtensionManager.beforeSessionRun(...)` before building the contextual prompt and tools. | Confirmed | Veluga A1/A6/A7 prompt-prefix, context injection, and custom tool additions can be implemented as an `AgentRuntimeExtension`. This is lower risk than changing the core runner. |
| Session post-run hook | `src/main/session/session-manager.ts` calls `extensionManager.afterSessionRun(...)` after `agentRunner.run(...)`. | Confirmed | Use for Phase 2+ session summary work and Phase 1 audit post-processing that does not need to block the answer path. |
| Tool list construction | `src/main/claude/agent-runner.ts` builds MCP custom tools via `buildMcpCustomTools(...)`, extension custom tools through `beforeSessionRun(...)`, and built-in coding tools through `createCodingTools(...)`. It then applies wrappers such as `wrapBashToolWithDefaultTimeout(...)` and `wrapBashToolForSudo(...)`. | Confirmed with caveat | There is no exported first-class `beforeToolCall` hook. `ToolInterceptor` should be implemented by wrapping each `ToolDefinition.execute(...)` near this wrapper stage, covering built-in, MCP, and extension tools before execution. |
| Permission request / HITL gate | `SessionManager.requestPermission(...)` sends `ServerEvent` type `permission.request`; `SessionManager.handlePermissionResponse(...)` receives `permission.response`. Renderer handles it through `useIPC` and `PermissionDialog`. | Confirmed | This is the existing human approval channel. A4 Policy Guard can either deny before permission display or annotate/log dry-run findings before allowing the existing flow to proceed. |
| Main-to-renderer broadcast | `src/main/index.ts` `sendToRenderer(event)` calls `mainWindow.webContents.send('server-event', event)`. `src/preload/index.ts` listens to `server-event`, and `src/renderer/hooks/useIPC.ts` dispatches server events into the Zustand store. | Confirmed | Use this path for `policy.updated`, stale-policy banners, audit notices, and Veluga status events. Add typed events before renderer handling. |
| Settings UI insertion point | `src/renderer/components/SettingsPanel.tsx` defines local `tabs` and renders tab content for `api`, `sandbox`, `connectors`, `skills`, `memory`, `schedule`, `remote`, `logs`, and `general`. | Confirmed | Add the Veluga Mode toggle either as a new settings tab or inside `SettingsGeneral`. For Phase 1, `SettingsGeneral` is the least invasive insertion point. |
| Permission dialog UI | `src/renderer/components/PermissionDialog.tsx` renders tool name/input and responds through `useIPC().respondToPermission(...)`. | Confirmed | Keep existing UI for user approval. Add Veluga-specific dry-run policy context only if needed, without replacing the dialog. |

## Recommended Phase 1 Adapter Shape

- Add Veluga-owned code outside `packages/cowork-core` first.
- Add a minimal upstream shim only where Open Cowork lacks an extension point.
- Use `AgentRuntimeExtension` for pre-run prompt/context behavior and post-run hooks.
- Use a `ToolDefinition.execute` wrapper for A4/A5 tool interception because no dedicated `beforeToolCall` extension exists.
- Use the existing `server-event` channel for policy broadcasts instead of introducing another renderer bridge.

## Hook Gap

The only material mismatch with the PRD is the lack of a named, exported `beforeToolCall` hook. The practical hook is the tool wrapper stage inside `src/main/claude/agent-runner.ts`, before tools are passed into `createAgentSession(...)`. Track this as `GAP-P1-09` until a Veluga shim or upstream extension API is chosen.
