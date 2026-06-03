# KB Traverse Consumer

Phase 4 adds `kb_traverse` as an optional external KB MCP tool consumed by Veluga. Veluga does not create or own the graph store; it validates and post-filters the external response before citation analysis.

Required tool name: `kb_traverse`

Input fields:

- `start_node`: KB doc or chunk id from a report citation.
- `edge_types`: graph relation names such as `revised_by`, `superseded_by`, `references`, or `cites`.
- `depth`: integer from 1 to 3.
- `as_of_date`: citation date in `YYYY-MM-DD`.
- `user_scopes`: scopes from `PolicyContext.active_kb_scopes`.
- `policy_token`: Veluga policy version id.

Output fields:

- `nodes`: graph nodes with `id`, `label`, optional `scope`, optional `classification`, optional validity dates, and `properties`.
- `edges`: graph edges with `type`, `from_node`, `to_node`, and `properties`.
- `summary`: external KB summary text.

Veluga post-processing:

- rejects malformed inputs and outputs in `packages/veluga-main/src/kb/kb-contract.ts`;
- removes nodes outside active KB scopes or above user clearance in `KbMcpAdapter.traverse`;
- removes edges whose endpoints were removed;
- records `kb.over_classification` for removed graph nodes;
- lets `citation-tracer` interpret `revised_by` as yellow and `superseded_by` or missing start nodes as red.
