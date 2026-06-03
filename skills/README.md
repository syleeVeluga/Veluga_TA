# Veluga Skills

This directory is the Veluga workflow and policy skill catalog.

It is not the Office artifact skill bundle. Built-in DOCX, PPTX, XLSX, and PDF
artifact skills live under `packages/cowork-core/.claude/skills/` and are loaded
by Open Cowork's `SkillsManager`.

Use this directory for Veluga-specific skills that need policy metadata such as
clearance, KB scopes, HITL requirements, compliance checks, and workflow
dependencies.

Examples:

- `core/system-self-help`: reports active Veluga capabilities from `PolicyContext`
  without calling an LLM.
- `core/compliance-checker`: checks draft outputs against Veluga compliance rules.
- `domain/gov-proposal`: routes government proposal work through the required
  KB scopes and follow-up skills.

When adding a new skill here, keep it policy-aware and declare its dependencies
in `packages/veluga-main/src/agents/skill-resolver.ts`.
