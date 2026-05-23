# Sandbox Ops

Phase 4 privileged tool execution is represented by `DockerSandbox` in `packages/veluga-main/src/sandbox/docker-sandbox.ts`.

Default hardening:

- `--network none`
- `--read-only`
- `--cap-drop ALL`
- `--security-opt no-new-privileges`
- non-root user `65534:65534`
- constrained memory and CPU
- explicit bind mounts only

Operational expectations:

- set `VELUGA_SANDBOX_IMAGE` to the approved image tag;
- mount input directories read-only and output directories read-write;
- do not add capabilities;
- keep the image pre-pulled or pre-built to meet cold-start targets;
- record every sandboxed privileged run as `sandbox.run` in the audit log.
