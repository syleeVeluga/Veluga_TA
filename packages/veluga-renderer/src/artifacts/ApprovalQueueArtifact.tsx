import React, { useMemo, useState } from 'react';
import type { ApprovalQueueData } from '../../../veluga-main/src/approval/approval-queue.js';

export function ApprovalQueueArtifact({
  data,
  onBulkApprove,
  onReject
}: {
  data: ApprovalQueueData;
  onBulkApprove?: (approvalIds: string[]) => void;
  onReject?: (approvalId: string, comment: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(data.items[0]?.approval_id ?? null);
  const [comment, setComment] = useState('');
  const greenSelected = useMemo(
    () => data.items.filter((item) => selected.has(item.approval_id) && item.compliance_verdict === 'green'),
    [data.items, selected]
  );
  const openItem = data.items.find((item) => item.approval_id === openId);

  return (
    <section className="grid min-h-0 grid-cols-[minmax(280px,360px)_1fr] gap-4 text-sm">
      <div className="min-h-0 overflow-auto border-r border-border pr-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">결재 큐</h2>
          <button type="button" disabled={!greenSelected.length} onClick={() => onBulkApprove?.(greenSelected.map((item) => item.approval_id))}>
            일괄 승인
          </button>
        </div>
        <ul className="space-y-2">
          {data.items.map((item) => (
            <li key={item.approval_id}>
              <button type="button" className="w-full border border-border p-3 text-left" onClick={() => setOpenId(item.approval_id)}>
                <span className="flex items-center justify-between gap-3">
                  <span>
                    <input
                      type="checkbox"
                      disabled={item.compliance_verdict !== 'green'}
                      checked={selected.has(item.approval_id)}
                      onChange={(event) => {
                        event.stopPropagation();
                        const next = new Set(selected);
                        if (event.currentTarget.checked) next.add(item.approval_id);
                        else next.delete(item.approval_id);
                        setSelected(next);
                      }}
                    />
                    <strong className="ml-2">{item.title}</strong>
                  </span>
                  <Verdict verdict={item.compliance_verdict} />
                </span>
                <span className="mt-1 block text-text-secondary">{item.author.name} · {item.submitted_at}</span>
                <span className="mt-1 block">{item.compliance_summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {openItem ? (
        <article className="min-h-0 overflow-auto">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">{openItem.title}</h3>
            <Verdict verdict={openItem.compliance_verdict} />
          </header>
          <pre className="whitespace-pre-wrap border border-border p-3">{openItem.body}</pre>
          <div className="mt-3 border border-border p-3">
            <strong>인용 트리</strong>
            <p>{openItem.citation_tree_ready ? 'ready' : 'pending'}</p>
          </div>
          <div className="mt-3 border border-border p-3">
            <strong>Compliance</strong>
            <p>{openItem.compliance_summary}</p>
          </div>
          <textarea className="mt-3 w-full border border-border p-2" value={comment} onChange={(event) => setComment(event.currentTarget.value)} />
          <button type="button" className="mt-2" disabled={!comment.trim()} onClick={() => onReject?.(openItem.approval_id, comment)}>
            반려
          </button>
        </article>
      ) : null}
    </section>
  );
}

function Verdict({ verdict }: { verdict: 'green' | 'yellow' | 'red' }) {
  return <span data-verdict={verdict}>{verdict}</span>;
}
