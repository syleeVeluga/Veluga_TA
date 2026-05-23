# Upstream Base

## Source

- Upstream repository: `https://github.com/OpenCoworkAI/open-cowork`
- Integration location: `packages/cowork-core`
- Integration method: Git submodule
- Upstream branch: `main`
- Baseline commit: `d4318943fb070d0863bed930eb70a95c6e7c4487`
- Upstream package name/version: `open-cowork@3.3.0`
- License file: `packages/cowork-core/LICENSE` (MIT)

Veluga Phase 1 work should treat `packages/cowork-core` as protected upstream source. Veluga-owned code should be added through adapter packages or explicit hook shims rather than editing upstream files directly, unless a hook shim is unavoidable and documented in `docs/cowork-hooks.md`.

## Local Baseline Verification

Environment:

- OS: Windows
- Node: `v24.13.0`
- npm: `11.12.1`
- Upstream engine requirement: `node >=22`

Commands run from `packages/cowork-core`:

| Command | Result | Notes |
|---|---|---|
| `npm ci` | PASS | Installed 1224 packages. Postinstall downloaded Node `v22.22.0` for `win32-x64` into ignored `resources/node/` and rebuilt `better-sqlite3` for Electron. `npm audit` reports 26 vulnerabilities: 14 moderate, 11 high, 1 critical. |
| `npm run typecheck` | PASS | `tsc --noEmit`. |
| `npm test -- --run` | PARTIAL | Initial run failed because `better-sqlite3` was rebuilt for Electron ABI. After `npm rebuild better-sqlite3`, 819/822 tests passed. Remaining 3 failures are Windows path expectation mismatches where tests expect `/repo/...` and runtime returns `D:\repo\...`. |
| `npm run build:wsl-agent` | PASS | Builds `dist-wsl-agent/index.js`. |
| `npm run build:lima-agent` | PASS | Builds `dist-lima-agent/index.js`. |
| `npm run build:mcp` | PASS | Builds `.bundle-resources/mcp/*` bundles. |
| `npx vite build` | PASS | Builds renderer, Electron main, and preload outputs. Large chunk warnings only. |
| `npm run pre-build-check` | PASS | 7 passed, 0 warnings, 0 failed after the Vite and MCP builds. |

Full `npm run build` was not run in this baseline pass because it proceeds into packaging via `electron-builder`. The build prerequisites immediately before packaging are present and pass.

## Build Artifacts

The following generated paths are ignored by the upstream checkout and should not be committed from the parent repository:

- `packages/cowork-core/node_modules/`
- `packages/cowork-core/resources/node/`
- `packages/cowork-core/dist/`
- `packages/cowork-core/dist-electron/`
- `packages/cowork-core/dist-mcp/`
- `packages/cowork-core/dist-wsl-agent/`
- `packages/cowork-core/dist-lima-agent/`
- `packages/cowork-core/.bundle-resources/`
