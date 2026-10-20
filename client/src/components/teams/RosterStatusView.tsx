import React from 'react';
import type { TeamView, TeamMemberView, TeamVacancyView } from './teamTypes';
import { LockedRosterBadge } from './LockedRosterBadge';

export type RosterStatusViewState = 'loading' | 'success' | 'empty' | 'error';

export interface RosterStatusViewProps {
  /** Full team view when available (preferred). */
  team?: TeamView | null;
  /** Lightweight fallback when only accept-response fields are known. */
  snapshot?: {
    teamName: string;
    vacancyRole: string | null;
    vacancyStatus?: string | null;
    memberCount?: number | null;
    maxTeamSize?: number | null;
    membershipRole?: string | null;
    membershipStatus?: string | null;
    joinedAt?: string | null;
    availabilityCleared?: boolean;
  } | null;
  viewState?: RosterStatusViewState;
  errorMessage?: string | null;
  emptyMessage?: string | null;
  /** Highlight the signed-in viewer in the members list. */
  viewerParticipantId?: string | null;
  onRetry?: () => void;
  onViewTeam?: () => void;
  /** Optional leave control slot for non-owners. */
  leaveSlot?: React.ReactNode;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'Open':
      return 'bg-emerald-50 text-emerald-900 border-emerald-200';
    case 'Locked':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'Disbanded':
      return 'bg-red-50 text-red-900 border-red-200';
    case 'Filled':
      return 'bg-slate-100 text-slate-800 border-slate-200';
    case 'Confirmed':
      return 'bg-forest-50 text-forest-900 border-forest-200';
    default:
      return 'bg-cream-100 text-ink-muted border-cream-200';
  }
}

function MemberRow({
  member,
  isViewer,
}: {
  member: TeamMemberView;
  isViewer: boolean;
}): React.JSX.Element {
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2 py-2"
      data-testid={`roster-member-${member.participantId}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium text-forest-900 truncate">{member.displayName}</span>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${
            member.role === 'Owner'
              ? 'bg-cream-100 text-ink border-cream-300'
              : 'bg-white text-ink-muted border-cream-200'
          }`}
        >
          {member.role}
        </span>
        {isViewer ? (
          <span className="text-[10px] font-medium text-forest-800" data-testid="roster-you-badge">
            You
          </span>
        ) : null}
      </div>
      <span className="text-[11px] text-ink-muted">
        Joined {new Date(member.joinedAt).toLocaleDateString()}
      </span>
    </li>
  );
}

function VacancyRow({ vacancy }: { vacancy: TeamVacancyView }): React.JSX.Element {
  return (
    <li
      className="flex items-center justify-between gap-2 py-1.5"
      data-testid={`roster-vacancy-${vacancy.id}`}
    >
      <span className="text-ink">{vacancy.role}</span>
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusBadgeClass(vacancy.status)}`}
        data-testid={`roster-vacancy-status-${vacancy.id}`}
      >
        {vacancy.status}
      </span>
    </li>
  );
}

/**
 * US-019 / #185 — roster status for invitees after accept and for confirmed members.
 * Shows capacity, confirmed members, slot statuses, and lifecycle without owner-only controls.
 */
export function RosterStatusView({
  team = null,
  snapshot = null,
  viewState = 'success',
  errorMessage = null,
  emptyMessage = null,
  viewerParticipantId = null,
  onRetry,
  onViewTeam,
  leaveSlot,
}: RosterStatusViewProps): React.JSX.Element {
  if (viewState === 'loading') {
    return (
      <div
        role="status"
        aria-busy="true"
        className="p-4 text-xs text-forest-800 border border-cream-200 rounded-lg bg-white"
        data-testid="roster-status-loading"
      >
        Loading roster status…
      </div>
    );
  }

  if (viewState === 'error') {
    return (
      <div
        role="alert"
        className="p-4 text-xs text-red-800 border border-red-200 rounded-lg bg-red-50 space-y-2"
        data-testid="roster-status-error"
      >
        <p>{errorMessage || 'Could not load roster status.'}</p>
        <p>Previous roster details were kept when available.</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1 text-xs font-medium border border-red-200 rounded bg-white hover:bg-red-50"
            data-testid="roster-status-retry"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (viewState === 'empty' || (!team && !snapshot)) {
    return (
      <div
        role="status"
        className="p-4 text-center text-xs text-ink-muted border border-dashed border-cream-300 rounded-lg"
        data-testid="roster-status-empty"
      >
        {emptyMessage || 'You are not on a team roster for this event yet.'}
      </div>
    );
  }

  const teamName = team?.name ?? snapshot?.teamName ?? 'Your team';
  const recruitmentStatus = team?.recruitmentStatus ?? 'Open';
  const confirmed = team?.limits.confirmedMembers ?? snapshot?.memberCount ?? null;
  const maxSize = team?.limits.maxTeamSize ?? snapshot?.maxTeamSize ?? null;
  const openSlots = team?.limits.openSlots ?? null;
  const remaining = team?.limits.remainingCapacity ?? null;
  const lifecycle = team?.lifecycle;
  const members = team?.members ?? [];
  const vacancies = team?.vacancies ?? [];

  return (
    <section
      className="rounded-lg border border-cream-200 bg-white p-4 space-y-4 shadow-sm"
      data-testid="roster-status-view"
      aria-labelledby="roster-status-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h3
            id="roster-status-heading"
            className="text-sm font-semibold text-forest-900 uppercase tracking-wide"
          >
            Roster status
          </h3>
          <p className="text-base font-semibold text-ink truncate" data-testid="roster-team-name">
            {teamName}
          </p>
          {team?.pitch ? (
            <p className="text-xs text-ink-muted leading-relaxed" data-testid="roster-team-pitch">
              {team.pitch}
            </p>
          ) : null}
        </div>
        {recruitmentStatus === 'Locked' ? (
          <span data-testid="roster-recruitment-status">
            <LockedRosterBadge lockedAt={team?.lockedAt ?? null} variant="badge" />
          </span>
        ) : (
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded text-[11px] font-semibold border ${statusBadgeClass(recruitmentStatus)}`}
            data-testid="roster-recruitment-status"
          >
            {recruitmentStatus}
          </span>
        )}
      </div>

      {lifecycle && !lifecycle.mutable && lifecycle.reason === 'Locked' ? (
        <div data-testid="roster-lifecycle-note">
          <LockedRosterBadge lockedAt={team?.lockedAt ?? null} variant="note" />
        </div>
      ) : lifecycle && !lifecycle.mutable && lifecycle.reason ? (
        <div
          role="note"
          className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2"
          data-testid="roster-lifecycle-note"
        >
          {lifecycle.reason === 'Disbanded'
            ? 'This team was disbanded.'
            : 'Event recruitment has ended. Roster changes are closed.'}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs" data-testid="roster-capacity">
        <div className="rounded-md border border-cream-200 bg-cream-50/60 p-2">
          <dt className="text-ink-muted">Confirmed</dt>
          <dd className="font-semibold text-forest-900" data-testid="roster-confirmed-count">
            {confirmed ?? '—'}
            {maxSize != null ? ` / ${maxSize}` : ''}
          </dd>
        </div>
        <div className="rounded-md border border-cream-200 bg-cream-50/60 p-2">
          <dt className="text-ink-muted">Open slots</dt>
          <dd className="font-semibold text-forest-900" data-testid="roster-open-slots">
            {openSlots ?? (snapshot?.vacancyStatus === 'Filled' ? 0 : '—')}
          </dd>
        </div>
        <div className="rounded-md border border-cream-200 bg-cream-50/60 p-2">
          <dt className="text-ink-muted">Remaining capacity</dt>
          <dd className="font-semibold text-forest-900" data-testid="roster-remaining">
            {remaining ?? '—'}
          </dd>
        </div>
        <div className="rounded-md border border-cream-200 bg-cream-50/60 p-2">
          <dt className="text-ink-muted">Your status</dt>
          <dd className="font-semibold text-forest-900" data-testid="roster-your-status">
            {snapshot?.membershipStatus ||
              (viewerParticipantId &&
              members.find((m) => m.participantId === viewerParticipantId)?.role) ||
              'Member'}
            {snapshot?.membershipRole ? ` · ${snapshot.membershipRole}` : ''}
          </dd>
        </div>
      </dl>

      {snapshot?.vacancyRole ? (
        <p className="text-xs text-ink-muted" data-testid="roster-slot-outcome">
          Slot:{' '}
          <span className="font-medium text-ink">{snapshot.vacancyRole}</span>
          {snapshot.vacancyStatus ? (
            <>
              {' '}
              ·{' '}
              <span
                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${statusBadgeClass(snapshot.vacancyStatus)}`}
              >
                {snapshot.vacancyStatus}
              </span>
            </>
          ) : null}
          {snapshot.availabilityCleared ? (
            <span className="block mt-1">Looking-for-Team was cleared for this event.</span>
          ) : null}
        </p>
      ) : null}

      {members.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-forest-900 uppercase tracking-wide">
            Confirmed members
          </h4>
          <ul className="divide-y divide-cream-100" data-testid="roster-members-list">
            {members.map((member) => (
              <MemberRow
                key={member.participantId}
                member={member}
                isViewer={member.participantId === viewerParticipantId}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {vacancies.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-forest-900 uppercase tracking-wide">
            Recruitment slots
          </h4>
          <ul className="divide-y divide-cream-100" data-testid="roster-vacancies-list">
            {vacancies.map((vacancy) => (
              <VacancyRow key={vacancy.id} vacancy={vacancy} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {onViewTeam ? (
          <button
            type="button"
            onClick={onViewTeam}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800"
            data-testid="roster-view-team"
          >
            View team workspace
          </button>
        ) : null}
      </div>

      {leaveSlot}
    </section>
  );
}
