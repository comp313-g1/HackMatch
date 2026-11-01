import React, { useState, useEffect } from 'react';
import {
  type ExperienceBadge,
  type HackathonHistoryItem,
  type HackathonHistoryFormDraft,
  computeExperienceBadge,
  validateHackathonHistoryDraft,
  SELF_REPORTED_HISTORY_NOTICE,
  HISTORY_MAX_ENTRIES,
} from './hackathonHistoryValidation';
import { PRIMARY_ROLES } from './profileValidation';
import type { ProfileViewerCategory } from './CandidateProfileCard';

export interface HackathonHistorySectionProps {
  participantId?: string;
  viewerCategory: ProfileViewerCategory;
  initialHistory?: HackathonHistoryItem[];
  getIdToken?: () => Promise<string>;
  onHistoryUpdated?: (history: HackathonHistoryItem[], badge: ExperienceBadge) => void;
}

const emptyDraft: HackathonHistoryFormDraft = {
  eventName: '',
  eventDate: '',
  teamRole: 'Frontend',
  projectTitle: '',
  projectUrl: '',
};

export function HackathonHistorySection({
  participantId,
  viewerCategory,
  initialHistory,
  getIdToken,
  onHistoryUpdated,
}: HackathonHistorySectionProps): React.JSX.Element {
  const [history, setHistory] = useState<HackathonHistoryItem[]>(initialHistory ?? []);
  const [loading, setLoading] = useState<boolean>(!initialHistory && Boolean(getIdToken));
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState<HackathonHistoryFormDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const canEdit = viewerCategory === 'OWNER';
  const badge = computeExperienceBadge(history.length);

  useEffect(() => {
    if (initialHistory) {
      setHistory(initialHistory);
    }
  }, [initialHistory]);

  useEffect(() => {
    if (initialHistory || !getIdToken) return;

    let mounted = true;
    async function fetchHistory() {
      try {
        setLoading(true);
        const token = await getIdToken!();
        if (!token) {
          if (mounted) {
            setLoading(false);
          }
          return;
        }
        const endpoint =
          viewerCategory === 'OWNER'
            ? '/api/profiles/me/history'
            : `/api/profiles/${participantId}/history`;

        const res = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          throw new Error('Failed to load hackathon history.');
        }

        const data = await res.json();
        if (mounted && Array.isArray(data.history)) {
          setHistory(data.history);
          onHistoryUpdated?.(data.history, computeExperienceBadge(data.history.length));
        }
      } catch (err: unknown) {
        if (mounted) {
          setBannerError(err instanceof Error ? err.message : 'Error loading history.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchHistory();
    return () => {
      mounted = false;
    };
  }, [getIdToken, initialHistory, participantId, viewerCategory, onHistoryUpdated]);

  const handleOpenAddForm = () => {
    setDraft(emptyDraft);
    setFieldErrors({});
    setBannerError(null);
    setStatusMessage(null);
    setEditingId(null);
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (item: HackathonHistoryItem) => {
    setDraft({
      eventName: item.eventName,
      eventDate: item.eventDate,
      teamRole: item.teamRole,
      projectTitle: item.projectTitle,
      projectUrl: item.projectUrl,
    });
    setFieldErrors({});
    setBannerError(null);
    setStatusMessage(null);
    setEditingId(item.id);
    setIsFormOpen(true);
  };

  const handleCancelForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setFieldErrors({});
    setBannerError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setStatusMessage(null);

    // Client-side validation
    const validation = validateHackathonHistoryDraft(draft);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      setBannerError('Please resolve validation errors before saving.');
      return;
    }

    setFieldErrors({});

    if (!getIdToken) {
      // In offline or local preview mode without token callback
      const newItem: HackathonHistoryItem = {
        id: editingId ?? `local-${Date.now()}`,
        participantId: participantId || 'me',
        eventName: validation.sanitized!.eventName,
        eventDate: validation.sanitized!.eventDate,
        teamRole: validation.sanitized!.teamRole,
        projectTitle: validation.sanitized!.projectTitle,
        projectUrl: validation.sanitized!.projectUrl,
      };

      const updatedHistory = editingId
        ? history.map((h) => (h.id === editingId ? newItem : h))
        : [newItem, ...history];

      setHistory(updatedHistory);
      setIsFormOpen(false);
      setEditingId(null);
      setDraft(emptyDraft);
      const newBadge = computeExperienceBadge(updatedHistory.length);
      setStatusMessage('Hackathon history saved successfully.');
      onHistoryUpdated?.(updatedHistory, newBadge);
      return;
    }

    try {
      setSubmitting(true);
      const token = await getIdToken();
      const endpoint = editingId
        ? `/api/profiles/me/history/${editingId}`
        : '/api/profiles/me/history';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validation.sanitized),
      });

      const data = await res.json();
      if (!res.ok) {
        setBannerError(data.message || data.error || 'Failed to save history entry.');
        return;
      }

      const updatedHistory = Array.isArray(data.history)
        ? data.history
        : editingId
          ? history.map((h) => (h.id === editingId ? data.entry : h))
          : [data.entry, ...history];

      setHistory(updatedHistory);
      setIsFormOpen(false);
      setEditingId(null);
      setDraft(emptyDraft);
      const newBadge = computeExperienceBadge(updatedHistory.length);
      setStatusMessage(data.message || 'Hackathon history saved successfully.');
      onHistoryUpdated?.(updatedHistory, newBadge);
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Network error while saving.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (historyId: string) => {
    if (!window.confirm('Are you sure you want to remove this hackathon history record?')) {
      return;
    }

    setBannerError(null);
    setStatusMessage(null);

    if (!getIdToken) {
      const remaining = history.filter((h) => h.id !== historyId);
      setHistory(remaining);
      const newBadge = computeExperienceBadge(remaining.length);
      setStatusMessage('Hackathon history record removed.');
      onHistoryUpdated?.(remaining, newBadge);
      return;
    }

    try {
      setDeletingId(historyId);
      const token = await getIdToken();
      const res = await fetch(`/api/profiles/me/history/${historyId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        setBannerError(data.message || data.error || 'Failed to delete record.');
        return;
      }

      const remaining = Array.isArray(data.history)
        ? data.history
        : history.filter((h) => h.id !== historyId);

      setHistory(remaining);
      const newBadge = computeExperienceBadge(remaining.length);
      setStatusMessage(data.message || 'Hackathon history record removed.');
      onHistoryUpdated?.(remaining, newBadge);
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Network error while deleting.');
    } finally {
      setDeletingId(null);
    }
  };

  // 1. Visitor restriction boundary (US-007 AC 3 / FR-015)
  if (viewerCategory === 'VISITOR') {
    return (
      <section
        aria-label="Hackathon History"
        className="p-5 bg-white rounded-xl border border-cream-200 shadow-sm space-y-3"
      >
        <h4 className="font-display text-base font-semibold text-forest-900">
          Hackathon & Project Portfolio History
        </h4>
        <div
          data-testid="visitor-history-restricted"
          role="note"
          className="p-3 bg-cream-50 border border-cream-200 rounded-md text-xs text-ink-muted"
        >
          Sign in as a registered participant to view self-reported hackathon history and project links.
        </div>
      </section>
    );
  }

  // Badge pill colors
  const badgeColors: Record<ExperienceBadge, string> = {
    Beginner: 'bg-cream-100 text-ink-800 border-cream-300',
    Competitor: 'bg-forest-50 text-forest-800 border-forest-300',
    Veteran: 'bg-amber-50 text-amber-900 border-amber-300',
  };

  return (
    <section
      aria-label="Hackathon History"
      className="p-5 bg-white rounded-xl border border-cream-200 shadow-sm space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-cream-200">
        <div>
          <h4 className="font-display text-base font-semibold text-forest-900">
            Hackathon & Project History
          </h4>
          <p className="text-xs text-ink-muted mt-0.5">
            Self-declared participation records and project portfolio links.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="experience-badge-pill"
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${badgeColors[badge]}`}
          >
            {badge}
          </span>
          <span data-testid="experience-record-count" className="text-xs font-medium text-ink-muted">
            ({history.length} {history.length === 1 ? 'record' : 'records'})
          </span>
        </div>
      </div>

      <div
        role="note"
        aria-label="Self-reported disclaimer"
        className="p-3 bg-cream-50 border border-cream-200 rounded-md text-xs text-ink-muted"
      >
        {SELF_REPORTED_HISTORY_NOTICE}
      </div>

      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800"
        >
          {statusMessage}
        </div>
      )}

      {bannerError && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800"
        >
          {bannerError}
        </div>
      )}

      {canEdit && !isFormOpen && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleOpenAddForm}
            disabled={history.length >= HISTORY_MAX_ENTRIES}
            className="py-1.5 px-3 rounded-md text-xs font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {history.length >= HISTORY_MAX_ENTRIES
              ? `Limit Reached (${HISTORY_MAX_ENTRIES}/${HISTORY_MAX_ENTRIES})`
              : '+ Add Past Hackathon'}
          </button>
        </div>
      )}

      {/* Form (NR-010: Form draft inputs preserved on validation error) */}
      {canEdit && isFormOpen && (
        <form
          onSubmit={handleSubmit}
          className="p-4 bg-cream-50 border border-cream-300 rounded-lg space-y-3"
          aria-label={editingId ? 'Edit hackathon record' : 'Add hackathon record'}
        >
          <h5 className="text-xs font-bold uppercase tracking-wider text-forest-900">
            {editingId ? 'Edit Hackathon Record' : 'Add Hackathon Record'}
          </h5>

          <div>
            <label htmlFor="history-event-name" className="block text-xs font-medium text-ink">
              Event Name <span className="text-red-500">*</span>
            </label>
            <input
              id="history-event-name"
              type="text"
              value={draft.eventName}
              onChange={(e) => setDraft({ ...draft, eventName: e.target.value })}
              placeholder="e.g. Hack The North 2024"
              className="mt-1 block w-full px-3 py-1.5 border border-cream-300 rounded-md shadow-sm text-xs focus:ring-forest focus:border-forest"
            />
            {fieldErrors.eventName && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.eventName}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="history-event-date" className="block text-xs font-medium text-ink">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                id="history-event-date"
                type="date"
                value={draft.eventDate}
                onChange={(e) => setDraft({ ...draft, eventDate: e.target.value })}
                className="mt-1 block w-full px-3 py-1.5 border border-cream-300 rounded-md shadow-sm text-xs focus:ring-forest focus:border-forest"
              />
              {fieldErrors.eventDate && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.eventDate}</p>
              )}
            </div>

            <div>
              <label htmlFor="history-team-role" className="block text-xs font-medium text-ink">
                Team Role <span className="text-red-500">*</span>
              </label>
              <select
                id="history-team-role"
                value={draft.teamRole}
                onChange={(e) => setDraft({ ...draft, teamRole: e.target.value })}
                className="mt-1 block w-full px-3 py-1.5 border border-cream-300 rounded-md shadow-sm text-xs focus:ring-forest focus:border-forest"
              >
                {PRIMARY_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              {fieldErrors.teamRole && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.teamRole}</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="history-project-title" className="block text-xs font-medium text-ink">
              Project Title <span className="text-red-500">*</span>
            </label>
            <input
              id="history-project-title"
              type="text"
              value={draft.projectTitle}
              onChange={(e) => setDraft({ ...draft, projectTitle: e.target.value })}
              placeholder="e.g. EcoTrack AI"
              className="mt-1 block w-full px-3 py-1.5 border border-cream-300 rounded-md shadow-sm text-xs focus:ring-forest focus:border-forest"
            />
            {fieldErrors.projectTitle && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.projectTitle}</p>
            )}
          </div>

          <div>
            <label htmlFor="history-project-url" className="block text-xs font-medium text-ink">
              Project HTTPS URL <span className="text-red-500">*</span>
            </label>
            <input
              id="history-project-url"
              type="url"
              value={draft.projectUrl}
              onChange={(e) => setDraft({ ...draft, projectUrl: e.target.value })}
              placeholder="https://github.com/org/repo"
              className="mt-1 block w-full px-3 py-1.5 border border-cream-300 rounded-md shadow-sm text-xs focus:ring-forest focus:border-forest"
            />
            {fieldErrors.projectUrl && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.projectUrl}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleCancelForm}
              disabled={submitting}
              className="py-1.5 px-3 border border-cream-300 rounded-md text-xs font-medium text-ink hover:bg-cream-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="py-1.5 px-4 rounded-md text-xs font-semibold text-white bg-forest hover:bg-forest-800 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : editingId ? 'Update Record' : 'Save Record'}
            </button>
          </div>
        </form>
      )}

      {/* History List */}
      {loading ? (
        <div role="status" aria-live="polite" className="text-xs text-ink-muted py-3">
          Loading hackathon history...
        </div>
      ) : history.length === 0 ? (
        <p className="text-xs text-ink-muted py-2 italic">
          No hackathon history recorded yet. Experience tier defaults to Beginner.
        </p>
      ) : (
        <ul className="space-y-2.5" aria-label="Hackathon records list">
          {history.map((item) => (
            <li
              key={item.id}
              className="p-3 bg-white border border-cream-200 rounded-lg shadow-2xs space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h5 className="text-xs font-bold text-forest-900">{item.eventName}</h5>
                  <p className="text-[11px] text-ink-muted">{item.eventDate}</p>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-forest-50 text-forest-800 border border-forest-100">
                  {item.teamRole}
                </span>
              </div>

              <div className="text-xs text-ink">
                <span className="font-semibold text-ink-muted">Project: </span>
                {item.projectTitle}
              </div>

              {item.projectUrl && (
                <div className="text-xs break-all">
                  <a
                    href={item.projectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-forest-700 underline hover:text-forest-900"
                  >
                    {item.projectUrl}
                  </a>
                </div>
              )}

              {canEdit && (
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-cream-100">
                  <button
                    type="button"
                    onClick={() => handleOpenEditForm(item)}
                    className="text-[11px] font-medium text-forest-700 hover:text-forest-900 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    disabled={deletingId === item.id}
                    className="text-[11px] font-medium text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
                  >
                    {deletingId === item.id ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default HackathonHistorySection;
