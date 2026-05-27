import type { AuditLogger } from '../audit-logger.js';
import type { ApprovalSystemConnector, SealedReport } from './connector.js';

export type ComplianceVerdict = 'green' | 'yellow' | 'red';
export type ApprovalItemStatus = 'submitted' | 'ready_for_review' | 'approved' | 'rejected' | 'revising';

export interface ApprovalItem {
  approval_id: string;
  report_id: string;
  author: { user_id: string; name: string };
  approver_id: string;
  submitted_at: string;
  title: string;
  body: string;
  compliance_verdict: ComplianceVerdict;
  compliance_summary: string;
  citation_tree_ready: boolean;
  status: ApprovalItemStatus;
  sealed_report?: SealedReport;
}

export interface ApprovalQueueData {
  approver_id: string;
  items: ApprovalItem[];
}

export interface Notification {
  to: string;
  title: string;
  body: string;
  project_id?: string;
}

const VERDICT_ORDER: Record<ComplianceVerdict, number> = { green: 1, yellow: 2, red: 3 };
const ACTIVE_REVIEW_STATUSES = new Set<ApprovalItemStatus>(['submitted', 'ready_for_review']);

export class ApprovalQueue {
  private items = new Map<string, ApprovalItem>();
  private notifications: Notification[] = [];

  constructor(private readonly options: { connector: ApprovalSystemConnector; audit?: AuditLogger; policyVersionId?: string } ) {}

  seed(items: ApprovalItem[]): void {
    for (const item of items) this.items.set(item.approval_id, { ...item });
  }

  enqueue(item: ApprovalItem): ApprovalItem {
    if (this.items.has(item.approval_id)) {
      return { ...this.requireItem(item.approval_id) };
    }
    const stored = { ...item };
    this.items.set(item.approval_id, stored);
    this.options.audit?.append({
      session_id: 'approval-queue',
      user_id: item.author.user_id,
      event_type: 'approval.submitted',
      payload: { approval_id: item.approval_id, report_id: item.report_id, approver: item.approver_id },
      policy_version_id: this.options.policyVersionId ?? 'approval'
    });
    return { ...stored };
  }

  list(approver_id: string): ApprovalQueueData {
    return {
      approver_id,
      items: [...this.items.values()]
        .filter((item) => item.approver_id === approver_id && ACTIVE_REVIEW_STATUSES.has(item.status))
        .sort((a, b) => VERDICT_ORDER[a.compliance_verdict] - VERDICT_ORDER[b.compliance_verdict] || a.submitted_at.localeCompare(b.submitted_at))
    };
  }

  async bulkApprove(approvalIds: string[], approver: string, explicitPermission: boolean): Promise<{ approved: string[]; rejected: string[] }> {
    if (!explicitPermission) throw new Error('explicit_permission is required for bulk approval');
    const approved: string[] = [];
    const rejected: string[] = [];

    for (const approvalId of approvalIds) {
      const item = this.requireItem(approvalId);
      this.assertAssignedApprover(item, approver);
      if (!ACTIVE_REVIEW_STATUSES.has(item.status) || item.compliance_verdict !== 'green' || !item.sealed_report) {
        rejected.push(approvalId);
        continue;
      }
      await this.options.connector.submit_for_approval(item.sealed_report, approver);
      item.status = 'approved';
      approved.push(approvalId);
      this.options.audit?.append({
        session_id: 'approval-queue',
        user_id: approver,
        event_type: 'approval.granted',
        payload: { approval_id: approvalId, report_id: item.report_id, sealed_path: item.sealed_report.sealed_path },
        policy_version_id: this.options.policyVersionId ?? 'approval'
      });
    }

    return { approved, rejected };
  }

  reject(approvalId: string, approver: string, comment: string, project_id?: string): Notification {
    if (!comment.trim()) throw new Error('rejection comment is required');
    const item = this.requireItem(approvalId);
    this.assertAssignedApprover(item, approver);
    if (!ACTIVE_REVIEW_STATUSES.has(item.status)) throw new Error(`Approval item is not reviewable: ${approvalId}`);
    item.status = 'rejected';
    const notification = {
      to: item.author.user_id,
      title: `${item.title} 반려`,
      body: comment,
      project_id
    };
    this.notifications.push(notification);
    this.options.audit?.append({
      session_id: 'approval-queue',
      user_id: approver,
      event_type: 'approval.rejected',
      payload: { approval_id: approvalId, report_id: item.report_id, author: item.author.user_id, comment },
      policy_version_id: this.options.policyVersionId ?? 'approval'
    });
    return notification;
  }

  get sentNotifications(): Notification[] {
    return [...this.notifications];
  }

  private requireItem(approvalId: string): ApprovalItem {
    const item = this.items.get(approvalId);
    if (!item) throw new Error(`Unknown approval item: ${approvalId}`);
    return item;
  }

  private assertAssignedApprover(item: ApprovalItem, approver: string): void {
    if (item.approver_id !== approver) {
      throw new Error(`Approval item ${item.approval_id} is assigned to ${item.approver_id}`);
    }
  }
}
