# Phase 1 Verification

This file records Phase 1 manual verification items that cannot be fully proven by the unit tests in this workspace.

## Manual Checks

| Check | Status | Evidence / Gap |
|---|---|---|
| White-out network monitor | Gap recorded | Run the packaged Veluga artifact behind `mitmproxy` for 5 minutes. Expected result: 0 bytes to public LLM, telemetry, or updater endpoints. Current automated coverage enforces code-level guardrails only. |
| Veluga Mode OFF regression | Gap recorded | Run the packaged app with Veluga Mode OFF and execute the upstream Open Cowork smoke flow. Expected result: parity with upstream behavior. Current automated coverage checks bindings and metadata only. |

## Automated Coverage

- LLM gateway creation requires `VELUGA_LLM_GATEWAY_URL`.
- Veluga-owned code is scanned for hardcoded public LLM endpoints and telemetry packages.
- Open Cowork MIT attribution remains in `packages/veluga-ui/credits/LICENSES.md` and `docs/upstream-base.md`.
