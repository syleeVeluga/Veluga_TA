import type { AuditLogger } from '../audit-logger.js';

export type ApprovalStatus = 'submitted' | 'ready_for_review' | 'approved' | 'rejected' | 'recalled';

export interface SealedReport {
  approval_id: string;
  report_id: string;
  sealed_path: string;
  hash_self: string;
}

export interface ApprovalSystemConnector {
  submit_for_approval(report: SealedReport, approver: string): Promise<string>;
  query_status(approval_id: string): Promise<ApprovalStatus>;
  recall(approval_id: string, reason: string): Promise<boolean>;
  add_comment(approval_id: string, comment: string): Promise<boolean>;
}

export class MockApprovalConnector implements ApprovalSystemConnector {
  private statuses = new Map<string, ApprovalStatus>();
  private comments = new Map<string, string[]>();

  constructor(private readonly options: { audit?: AuditLogger; userId?: string; policyVersionId?: string } = {}) {}

  async submit_for_approval(report: SealedReport, approver: string): Promise<string> {
    this.statuses.set(report.approval_id, 'submitted');
    this.options.audit?.append({
      session_id: 'approval-connector',
      user_id: this.options.userId ?? approver,
      event_type: 'approval.submitted',
      payload: { approval_id: report.approval_id, report_id: report.report_id, approver, sealed_path: report.sealed_path },
      policy_version_id: this.options.policyVersionId ?? 'mock'
    });
    return report.approval_id;
  }

  async query_status(approval_id: string): Promise<ApprovalStatus> {
    return this.statuses.get(approval_id) ?? 'ready_for_review';
  }

  async recall(approval_id: string): Promise<boolean> {
    this.statuses.set(approval_id, 'recalled');
    return true;
  }

  async add_comment(approval_id: string, comment: string): Promise<boolean> {
    this.comments.set(approval_id, [...(this.comments.get(approval_id) ?? []), comment]);
    return true;
  }
}
