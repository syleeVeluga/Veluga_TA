# Phase 1 Verification

Automated verification is implemented in `tests/phase1/*.test.ts`.

Covered locally:

- Policy 5-tier merge, helper methods, stale fallback, and mock SSO.
- A1 fast-path, heuristic intent classification, LLM invocation counter behavior.
- A4 dry-run Policy Guard, A5 SQLite append-only audit log and PII masking.
- A6 confidence rules, A7 parametric citation tag enforcement.
- `system-self-help` LLM-free output bounded by `PolicyContext`.
- White-out static checks for Veluga-owned packages.

External/manual verification still required:

- Electron packaged `.exe` and `.dmg` signing.
- 5-minute mitmproxy traffic capture against final packaged output.
- Full Open Cowork E2E suite in Veluga Mode OFF after upstream shim wiring.
