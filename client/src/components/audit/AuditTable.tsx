import React from 'react';
import { formatActionLabel, formatSummary, formatUtcTimestamp } from './auditFormat';
import { AUDIT_CATEGORY_LABELS, type AuditRecord } from './auditTypes';

export interface AuditTableProps {
  records: AuditRecord[];
}

const CATEGORY_STYLES: Record<AuditRecord['category'], string> = {
  event: 'bg-sky-50 text-sky-900 border-sky-200',
  moderation: 'bg-amber-50 text-amber-900 border-amber-200',
  account: 'bg-violet-50 text-violet-900 border-violet-200',
};

/**
 * Read-only audit table (US-028 / #259, AC 2): record ID, actor, action, target,
 * reason, outcome, UTC time, plus the safe state summary on demand. There are
 * deliberately no edit or delete controls (AC 3: append-only).
 */
export function AuditTable({ records }: AuditTableProps): React.JSX.Element {
  return (
    <div
      className="overflow-x-auto rounded-md border border-cream-200 bg-white"
      data-testid="audit-table-scroll"
    >
      <table className="min-w-full text-left text-sm" data-testid="audit-table">
        <caption className="sr-only">
          Administrative action records, newest first. Times are in UTC.
        </caption>
        <thead className="bg-cream-50 text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Record ID</th>
            <th scope="col" className="px-3 py-2 font-semibold">Actor</th>
            <th scope="col" className="px-3 py-2 font-semibold">Action</th>
            <th scope="col" className="px-3 py-2 font-semibold">Target</th>
            <th scope="col" className="px-3 py-2 font-semibold">Reason</th>
            <th scope="col" className="px-3 py-2 font-semibold">Outcome</th>
            <th scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">Time (UTC)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-cream-200">
          {records.map((record) => (
            <tr key={record.id} data-testid={`audit-row-${record.id}`} className="align-top">
              <td className="px-3 py-2">
                <code className="break-all text-xs text-ink" data-testid="audit-cell-id">
                  {record.id}
                </code>
              </td>
              <td className="px-3 py-2">
                <code className="break-all text-xs text-ink" data-testid="audit-cell-actor">
                  {record.actorId}
                </code>
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[record.category]}`}
                  data-testid="audit-cell-category"
                >
                  {AUDIT_CATEGORY_LABELS[record.category] ?? record.category}
                </span>
                <div className="mt-1 font-medium text-forest-900" data-testid="audit-cell-action">
                  {formatActionLabel(record.actionType)}
                </div>
                <code className="text-xs text-ink-muted">{record.actionType}</code>
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-ink" data-testid="audit-cell-target-type">
                  {record.targetType}
                </div>
                <code className="break-all text-xs text-ink-muted" data-testid="audit-cell-target-id">
                  {record.targetId}
                </code>
              </td>
              <td className="px-3 py-2 max-w-xs break-words text-ink" data-testid="audit-cell-reason">
                {record.reason}
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-medium text-forest-800">
                    State summary
                  </summary>
                  <pre
                    className="mt-1 max-w-xs overflow-x-auto rounded bg-cream-50 p-2 text-xs text-ink"
                    data-testid="audit-cell-summary"
                  >
                    {formatSummary(record.safeStateSummary)}
                  </pre>
                </details>
              </td>
              <td className="px-3 py-2 text-ink" data-testid="audit-cell-outcome">
                {record.outcome}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-ink">
                <time dateTime={record.createdAt} title={record.createdAt} data-testid="audit-cell-time">
                  {formatUtcTimestamp(record.createdAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
