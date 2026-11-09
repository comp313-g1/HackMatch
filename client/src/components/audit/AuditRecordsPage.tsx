
import { useEffect, useState } from 'react';
import { fetchAuditRecords } from './auditApi';
import type { AuditRecord } from './auditTypes';

export function AuditRecordsPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [actorId, setActorId] = useState('');
  const [actionType, setActionType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [filters, setFilters] = useState({
    actorId: '',
    actionType: '',
    from: '',
    to: '',
  });

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const pageSize = 20;

  useEffect(() => {
    let cancelled = false;

    async function loadRecords() {
      setLoading(true);
      setError('');

      try {
        const result = await fetchAuditRecords({
          ...filters,
          page,
          pageSize,
        });

        if (!cancelled) {
          setRecords(result.records);
          setTotal(result.pagination.total);
          setTotalPages(result.pagination.totalPages);
        }
      } catch (err) {
        if (!cancelled) {
          setRecords([]);
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load audit records.'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRecords();

    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setPage(1);
    setFilters({
      actorId: actorId.trim(),
      actionType: actionType.trim(),
      from: fromDate,
      to: toDate,
    });
  }

  function clearFilters() {
    setActorId('');
    setActionType('');
    setFromDate('');
    setToDate('');
    setPage(1);
    setFilters({
      actorId: '',
      actionType: '',
      from: '',
      to: '',
    });
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">
        Administrative Audit Records
      </h1>

      <p className="mb-6">
        Review historical administrative actions.
        Records are read-only.
      </p>

      <form onSubmit={applyFilters} className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label>
            <span className="block mb-1">Actor ID</span>
            <input
              type="text"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="Administrator ID"
              className="border rounded p-2 w-full"
            />
          </label>

          <label>
            <span className="block mb-1">Action Type</span>
            <input
              type="text"
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              placeholder="Action type"
              className="border rounded p-2 w-full"
            />
          </label>

          <label>
            <span className="block mb-1">From Date (UTC)</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="border rounded p-2 w-full"
            />
          </label>

          <label>
            <span className="block mb-1">To Date (UTC)</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="border rounded p-2 w-full"
            />
          </label>
        </div>

        <div className="flex gap-3 mt-4">
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            Apply Filters
          </button>

          <button
            type="button"
            onClick={clearFilters}
            className="border px-4 py-2 rounded"
          >
            Clear Filters
          </button>
        </div>
      </form>

      {loading && (
        <p role="status">Loading audit records...</p>
      )}

      {error && (
        <p role="alert" className="text-red-600 mb-4">
          {error}
        </p>
      )}

      {!loading && !error && records.length === 0 && (
        <p role="status">
          No audit records found. Try adjusting your filters.
        </p>
      )}

      {!loading && !error && records.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {[
                    'Record ID',
                    'Actor',
                    'Action',
                    'Target',
                    'Reason',
                    'Outcome',
                    'UTC Time',
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="border p-3 text-left"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className="border p-3">{record.id}</td>
                    <td className="border p-3">{record.actorId}</td>
                    <td className="border p-3">{record.actionType}</td>
                    <td className="border p-3">
                      {record.targetType}: {record.targetId}
                    </td>
                    <td className="border p-3">{record.reason}</td>
                    <td className="border p-3">{record.outcome}</td>
                    <td className="border p-3">
                      {new Date(record.createdAt).toLocaleString(
                        'en-CA',
                        { timeZone: 'UTC' }
                      )} UTC
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-6">
            <p>
              Page {page} of {totalPages} — {total} records
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="border rounded px-4 py-2 disabled:opacity-50"
              >
                Previous
              </button>

              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="border rounded px-4 py-2 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
