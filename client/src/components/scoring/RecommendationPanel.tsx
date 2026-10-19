import React, { useCallback, useState } from 'react';
import { CompatibilityRankList, type CompatibilityRankListItem } from './CompatibilityRankList';
import { InviteFromRecommendationForm } from './InviteFromRecommendationForm';
import { ScoreContributionsPanel } from './ScoreContributionsPanel';
import {
  EMPTY_RECOMMENDATIONS_MESSAGE,
  formatExclusionSummary,
} from './recommendationEligibilityMessages';
import {
  AuthRequiredError,
  RecommendationsApiError,
  fetchVacancyRecommendations,
  type RecommendationCandidate,
  type RecommendationsResponse,
} from './recommendationsApi';
import type { IssuedInvitation } from './invitationsApi';

export interface RecommendationPanelProps {
  teamId: string;
  vacancyId: string;
  vacancyLabel: string;
  /** When false, hide the load control (e.g. filled slot). */
  enabled?: boolean;
}

type LoadState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Owner-facing US-015 recommendation list with empty and NR-016 degraded fallback states.
 * Eligible rows open the US-017 invitation draft (FR-048).
 */
export function RecommendationPanel({
  teamId,
  vacancyId,
  vacancyLabel,
  enabled = true,
}: RecommendationPanelProps): React.JSX.Element | null {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [result, setResult] = useState<RecommendationsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inviteDraftId, setInviteDraftId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(() => new Set());
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    setErrorMessage(null);
    // Keep previous result visible until new data arrives (NR-017).
    try {
      const data = await fetchVacancyRecommendations(teamId, vacancyId);
      setResult(data);
      setSelectedId(data.candidates[0]?.participantId ?? null);
      setLoadState('success');
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setErrorMessage('You need to sign in to view recommendations.');
      } else if (err instanceof RecommendationsApiError) {
        setErrorMessage(err.message || 'Could not load recommendations.');
      } else {
        setErrorMessage('Could not load recommendations.');
      }
      setLoadState('error');
    }
  }, [teamId, vacancyId]);

  if (!enabled) return null;

  const selected: RecommendationCandidate | null =
    result?.candidates.find((c) => c.participantId === selectedId) ?? null;
  const inviteCandidate: RecommendationCandidate | null =
    result?.candidates.find((c) => c.participantId === inviteDraftId) ?? null;
  const isDegraded = result?.status === 'degraded';
  const exclusionNote = formatExclusionSummary(result?.exclusions);

  const openInvite = (candidate: CompatibilityRankListItem) => {
    setInviteSuccess(null);
    setInviteDraftId(candidate.participantId);
    setSelectedId(candidate.participantId);
  };

  const handleInviteSuccess = (invitation: IssuedInvitation) => {
    const name =
      inviteCandidate?.handle?.trim() ||
      inviteCandidate?.displayName ||
      'Candidate';
    setInvitedIds((prev) => new Set(prev).add(invitation.inviteeParticipantId));
    setInviteDraftId(null);
    setInviteSuccess(
      `Invitation sent to ${name} for the ${invitation.vacancyRole} slot. Expires ${new Date(
        invitation.expiresAt
      ).toLocaleString()}.`
    );
  };

  return (
    <section
      className="mt-3 rounded-md border border-cream-200 bg-cream-50/40 p-3 space-y-3"
      data-testid="recommendation-panel"
      aria-label={`Recommendations for ${vacancyLabel}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-forest-900 uppercase tracking-wide">
          Recommended candidates
        </h4>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loadState === 'loading'}
          className="px-3 py-1 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800 disabled:opacity-50"
          data-testid="load-recommendations"
        >
          {loadState === 'loading'
            ? 'Loading…'
            : result
              ? 'Refresh recommendations'
              : 'Find compatible candidates'}
        </button>
      </div>

      {loadState === 'idle' && !result ? (
        <p className="text-xs text-ink-muted" data-testid="recommendation-idle">
          Rank eligible Looking-for-Team participants for this open slot using declared skills,
          role, goal, and hours.
        </p>
      ) : null}

      {loadState === 'loading' && !result ? (
        <p role="status" aria-live="polite" className="text-xs text-forest-800">
          Loading recommendations…
        </p>
      ) : null}

      {loadState === 'error' ? (
        <div role="alert" className="text-xs text-red-800 space-y-2" data-testid="recommendation-error">
          <p>{errorMessage}</p>
          <p>Your team and vacancy details were kept.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {result && result.empty ? (
        <div
          role="status"
          className="p-4 text-center text-xs text-ink-muted border border-dashed border-cream-300 rounded-md bg-white"
          data-testid="recommendation-empty"
        >
          <p className="font-medium text-ink">{result.message || EMPTY_RECOMMENDATIONS_MESSAGE}</p>
          {exclusionNote ? <p className="mt-2">{exclusionNote}</p> : null}
        </div>
      ) : null}

      {result && !result.empty ? (
        <div className="space-y-3" data-testid="recommendation-results">
          {isDegraded && result.degradedNotice ? (
            <div
              role="status"
              className="p-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded"
              data-testid="recommendation-degraded"
            >
              {result.degradedNotice}
            </div>
          ) : null}

          <CompatibilityRankList
            unranked={isDegraded}
            showUnrankedBanner={!isDegraded || !result.degradedNotice}
            emptyMessage={EMPTY_RECOMMENDATIONS_MESSAGE}
            onInvite={openInvite}
            invitedParticipantIds={invitedIds}
            invitingParticipantId={inviteDraftId}
            candidates={result.candidates.map((c) => ({
              participantId: c.participantId,
              displayName: c.displayName,
              handle: c.handle,
              rank: c.rank,
              displayScore: c.displayScore,
              score: c.score,
            }))}
          />

          {inviteSuccess ? (
            <div
              role="status"
              className="p-2 text-xs text-forest-900 bg-forest-50 border border-forest-200 rounded"
              data-testid="invite-success"
            >
              {inviteSuccess}
            </div>
          ) : null}

          {inviteCandidate ? (
            <InviteFromRecommendationForm
              teamId={teamId}
              vacancyId={vacancyId}
              vacancyLabel={vacancyLabel}
              candidate={{
                participantId: inviteCandidate.participantId,
                displayName: inviteCandidate.displayName,
                handle: inviteCandidate.handle,
              }}
              onCancel={() => setInviteDraftId(null)}
              onSuccess={handleInviteSuccess}
            />
          ) : null}

          {!isDegraded && result.candidates.length > 1 ? (
            <div>
              <label htmlFor={`rec-select-${vacancyId}`} className="block text-xs font-medium text-ink mb-1">
                Explain contributions for
              </label>
              <select
                id={`rec-select-${vacancyId}`}
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value || null)}
                className="w-full max-w-sm px-2 py-1.5 text-xs border border-cream-300 rounded bg-white"
              >
                {result.candidates.map((c) => (
                  <option key={c.participantId} value={c.participantId}>
                    {c.handle?.trim() || c.displayName}
                    {c.displayScore ? ` — ${c.displayScore}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {selected && !isDegraded ? (
            <ScoreContributionsPanel
              displayScore={selected.displayScore ?? selected.explanation?.displayScore}
              notice={selected.explanation?.notice ?? result.notice}
              items={selected.explanation?.items}
              contributions={selected.contributions}
            />
          ) : null}

          {result.notice && !selected?.explanation?.notice ? (
            <p className="text-xs text-ink-muted">{result.notice}</p>
          ) : null}

          {exclusionNote && result.exclusions.totalExcluded > 0 ? (
            <p className="text-xs text-ink-muted" data-testid="recommendation-exclusions">
              {exclusionNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
