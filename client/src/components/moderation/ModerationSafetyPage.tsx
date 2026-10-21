import React, { useCallback, useEffect, useState } from 'react';
import {
  AuthRequiredError,
  ModerationApiError,
  createModerationCase,
  decideModerationCase,
  fetchModerationActionRecords,
  fetchModerationCaseDetail,
  fetchModerationCases,
  probeAdminModerationAccess,
  sortCasesNewestFirst,
} from './moderationApi';
import { ModerationQueueView } from './ModerationQueueView';
import { ModerationCaseView } from './ModerationCaseView';
import { OpenModerationCaseForm } from './OpenModerationCaseForm';
import { ModerationActionPanel } from './ModerationActionPanel';
import { ModerationActionRecordPanel } from './ModerationActionRecordPanel';
import type {
  CreateModerationCaseInput,
  DecideModerationCaseInput,
  ModerationAccessState,
  ModerationActionRecordView,
  ModerationCaseDetail,
  ModerationCaseView as CaseRow,
  ModerationDetailState,
  ModerationFieldErrors,
  ModerationListState,
  ModerationRecordsState,
} from './moderationTypes';

export interface ModerationSafetyPageProps {
  onNavigateAway?: () => void;
}

/**
 * ADMIN safety queue + case view + reason-gated decisions with safe action records
 * (US-026 / #241–#243). Form values are preserved when validation fails (NR-017).
 */
export function ModerationSafetyPage({
  onNavigateAway,
}: ModerationSafetyPageProps): React.JSX.Element {
  const [accessState, setAccessState] = useState<ModerationAccessState>('loading');
  const [accessError, setAccessError] = useState<string | null>(null);

  const [listState, setListState] = useState<ModerationListState>('loading');
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<ModerationDetailState>('idle');
  const [detail, setDetail] = useState<ModerationCaseDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ModerationFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const [deciding, setDeciding] = useState(false);
  const [decideFieldErrors, setDecideFieldErrors] = useState<ModerationFieldErrors>({});
  const [decideFormError, setDecideFormError] = useState<string | null>(null);
  const [decideSuccess, setDecideSuccess] = useState<string | null>(null);

  const [recordsState, setRecordsState] = useState<ModerationRecordsState>('idle');
  const [records, setRecords] = useState<ModerationActionRecordView[]>([]);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  const checkAccess = useCallback(async () => {
    setAccessState('loading');
    setAccessError(null);
    try {
      const result = await probeAdminModerationAccess();
      setAccessState(result === 'granted' ? 'granted' : 'denied');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setAccessState('denied');
        setAccessError('You need to sign in as an administrator.');
      } else if (err instanceof ModerationApiError) {
        setAccessState('error');
        setAccessError(err.message);
      } else {
        setAccessState('error');
        setAccessError('Could not verify administrator access.');
      }
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setListState('loading');
    setListError(null);
    try {
      const rows = await fetchModerationCases();
      setCases(sortCasesNewestFirst(rows));
      setListState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setListError('You need to sign in to view the moderation queue.');
      } else if (err instanceof ModerationApiError) {
        if (err.status === 403 || err.code === 'FORBIDDEN_ROLE') {
          setAccessState('denied');
        }
        setListError(err.message || 'Could not load the moderation queue.');
      } else {
        setListError('Could not load the moderation queue.');
      }
      setListState('error');
    }
  }, []);

  const loadDetail = useCallback(async (caseId: string) => {
    setDetailState('loading');
    setDetailError(null);
    try {
      const data = await fetchModerationCaseDetail(caseId);
      setDetail(data);
      setDetailState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setDetailError('You need to sign in to view this case.');
      } else if (err instanceof ModerationApiError) {
        setDetailError(err.message || 'Could not load this case.');
      } else {
        setDetailError('Could not load this case.');
      }
      setDetailState('error');
    }
  }, []);

  const loadRecords = useCallback(async (caseId: string) => {
    setRecordsState('loading');
    setRecordsError(null);
    try {
      const rows = await fetchModerationActionRecords(caseId);
      setRecords(rows);
      setRecordsState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setRecordsError('You need to sign in to view action records.');
      } else if (err instanceof ModerationApiError) {
        setRecordsError(err.message || 'Could not load action records.');
      } else {
        setRecordsError('Could not load action records.');
      }
      setRecordsState('error');
    }
  }, []);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  useEffect(() => {
    if (accessState === 'granted') {
      void loadQueue();
    }
  }, [accessState, loadQueue]);

  const handleSelect = (caseId: string) => {
    setSelectedCaseId(caseId);
    setDecideFieldErrors({});
    setDecideFormError(null);
    setDecideSuccess(null);
    setRecords([]);
    void loadDetail(caseId);
    void loadRecords(caseId);
  };

  const handleDecide = async (input: DecideModerationCaseInput) => {
    if (!selectedCaseId) return;
    setDeciding(true);
    setDecideFieldErrors({});
    setDecideFormError(null);
    setDecideSuccess(null);
    try {
      const result = await decideModerationCase(selectedCaseId, input);
      setDecideSuccess(
        `Applied ${result.action}. A safe action record was created (outcome: ${result.outcome}).`
      );
      setCases((prev) =>
        sortCasesNewestFirst(prev.map((c) => (c.id === result.case.id ? result.case : c)))
      );
      setDetail((prev) =>
        prev && prev.case.id === result.case.id ? { ...prev, case: result.case } : prev
      );
      void loadDetail(result.case.id);
      void loadRecords(result.case.id);
      void loadQueue();
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setDecideFormError('You need to sign in as an administrator.');
      } else if (err instanceof ModerationApiError) {
        if (err.errors) setDecideFieldErrors(err.errors);
        setDecideFormError(
          err.message || 'Could not apply the decision. Your entered values were kept.'
        );
      } else {
        setDecideFormError('Could not apply the decision. Your entered values were kept.');
      }
    } finally {
      setDeciding(false);
    }
  };

  const handleOpenCase = async (input: CreateModerationCaseInput) => {
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setSuccessNotice(null);
    try {
      const created = await createModerationCase(input);
      setSuccessNotice('Case opened. It appears at the top of the queue.');
      setCases((prev) => sortCasesNewestFirst([created, ...prev.filter((c) => c.id !== created.id)]));
      setListState('success');
      setSelectedCaseId(created.id);
      void loadDetail(created.id);
      void loadRecords(created.id);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setFormError('You need to sign in as an administrator.');
      } else if (err instanceof ModerationApiError) {
        if (err.errors) setFieldErrors(err.errors);
        setFormError(err.message || 'Could not open the case. Your entered values were kept.');
      } else {
        setFormError('Could not open the case. Your entered values were kept.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (accessState === 'loading') {
    return (
      <div className="max-w-5xl mx-auto" data-testid="moderation-access-loading">
        <p role="status" className="text-sm text-forest-800">
          Checking administrator access…
        </p>
      </div>
    );
  }

  if (accessState === 'denied') {
    return (
      <div
        className="max-w-lg mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm space-y-3"
        data-testid="moderation-access-denied"
      >
        <h2 className="font-display text-xl font-semibold text-forest-900">Moderation queue</h2>
        <div role="alert" className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md">
          {accessError ||
            'Access denied. Only platform administrators can open the safety queue.'}
        </div>
        {onNavigateAway ? (
          <button
            type="button"
            onClick={onNavigateAway}
            className="text-sm font-medium text-forest-800 hover:underline"
          >
            ← Back
          </button>
        ) : null}
      </div>
    );
  }

  if (accessState === 'error') {
    return (
      <div
        className="max-w-lg mx-auto p-6 bg-white rounded-xl border border-cream-200 space-y-3"
        data-testid="moderation-access-error"
      >
        <div role="alert" className="text-sm text-red-800">
          {accessError}
        </div>
        <button
          type="button"
          onClick={() => void checkAccess()}
          className="px-3 py-1.5 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6" data-testid="moderation-safety-page">
      <header className="space-y-1">
        <h2 className="font-display text-2xl font-semibold text-forest-900">Safety queue</h2>
        <p className="text-sm text-ink-muted">
          Review flagged team listings, profiles, and suspicious links. Newest cases appear first.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="moderation-queue-heading" className="space-y-3">
          <h3 id="moderation-queue-heading" className="text-sm font-semibold text-forest-900">
            Cases
          </h3>
          <ModerationQueueView
            cases={cases}
            listState={listState}
            listError={listError}
            selectedCaseId={selectedCaseId}
            onSelect={handleSelect}
            onRetry={() => void loadQueue()}
          />
          <OpenModerationCaseForm
            submitting={submitting}
            fieldErrors={fieldErrors}
            formError={formError}
            successNotice={successNotice}
            onSubmit={handleOpenCase}
          />
        </section>

        <section aria-labelledby="moderation-detail-heading" className="space-y-3">
          <h3 id="moderation-detail-heading" className="text-sm font-semibold text-forest-900">
            Case view
          </h3>
          <ModerationCaseView
            detail={detail}
            detailState={detailState}
            detailError={detailError}
            onRetry={() => {
              if (selectedCaseId) void loadDetail(selectedCaseId);
            }}
            onBackToQueue={() => {
              setSelectedCaseId(null);
              setDetail(null);
              setDetailState('idle');
              setDetailError(null);
              setDecideFieldErrors({});
              setDecideFormError(null);
              setDecideSuccess(null);
              setRecords([]);
              setRecordsState('idle');
              setRecordsError(null);
            }}
          />
          <ModerationActionPanel
            caseId={selectedCaseId}
            caseStatus={detail?.case.status ?? null}
            submitting={deciding}
            fieldErrors={decideFieldErrors}
            formError={decideFormError}
            successNotice={decideSuccess}
            onSubmit={handleDecide}
          />
          <ModerationActionRecordPanel
            records={records}
            recordsState={recordsState}
            recordsError={recordsError}
            onRetry={() => {
              if (selectedCaseId) void loadRecords(selectedCaseId);
            }}
          />
        </section>
      </div>
    </div>
  );
}
