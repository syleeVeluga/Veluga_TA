# Approval Connector Spec

Phase 4 defines a small connector surface for institution-specific approval systems. Site adapters should implement the interface from `packages/veluga-main/src/approval/connector.ts`.

Required methods:

- `submit_for_approval(report, approver)`: submits a sealed report and returns the approval id.
- `query_status(approval_id)`: returns `submitted`, `ready_for_review`, `approved`, `rejected`, or `recalled`.
- `recall(approval_id, reason)`: recalls a submitted item.
- `add_comment(approval_id, comment)`: attaches an approver comment.

`SealedReport` must include:

- `approval_id`
- `report_id`
- `sealed_path`
- `hash_self`

The repository includes `MockApprovalConnector` for tests and local integration. Real connectors should keep site-specific authentication and API mapping outside Veluga core packages.
