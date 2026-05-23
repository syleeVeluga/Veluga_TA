# Cowork Hook Mapping

This workspace currently contains the Veluga PRD and the Veluga-owned Phase 1/2 core implementation, but not an Open Cowork source checkout. The concrete Electron/Cowork hook names therefore remain integration placeholders.

| Veluga adapter | Expected Cowork hook | Status |
|---|---|---|
| `openProjectWithVeluga` | project open event | Pending upstream checkout |
| `initializeProjectPolicy` | project create event | Pending upstream checkout |
| `summarizeEndedSession` | session end event | Pending upstream checkout |
| `renderProjectReentryBanner` | renderer project sidebar/header | Pending upstream checkout |

The adapter functions are intentionally pure or filesystem-bound so they can be called from the actual hook layer once the upstream fork is present.
