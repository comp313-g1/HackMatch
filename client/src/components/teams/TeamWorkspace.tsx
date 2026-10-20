import React, { useState, useEffect, useCallback } from 'react';
import type { TeamView } from './teamTypes';
import { fetchMyTeam, TeamApiError, AuthRequiredError } from './teamApi';
import { TeamListingForm } from './TeamListingForm';
import { VacancyPanel } from './VacancyPanel';
import { OwnerInvitationsPanel } from './OwnerInvitationsPanel';
import { TeamRosterPanel } from './TeamRosterPanel';
import { LeaveTeamPanel } from './LeaveTeamPanel';
import { RosterStatusView } from './RosterStatusView';

export interface TeamWorkspaceProps {
  eventId: string;
}

export function TeamWorkspace({ eventId }: TeamWorkspaceProps): React.JSX.Element {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [invitationsRefreshKey, setInvitationsRefreshKey] = useState(0);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setAuthError(null);
    setForbiddenError(null);

    try {
      const data = await fetchMyTeam(eventId);
      setTeam(data);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setAuthError('You need to sign in to manage a team.');
      } else if (err instanceof TeamApiError) {
        if (err.status === 401) {
          setAuthError('You need to sign in to manage a team.');
        } else if (err.status === 403) {
          setForbiddenError(err.message || 'You do not have permission to access this team.');
        } else {
          setLoadError(err.message || 'Failed to load team data.');
        }
      } else {
        setLoadError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  // Loading state
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="max-w-4xl mx-auto p-12 text-center text-sm font-medium text-forest-800 bg-white border border-cream-200 rounded-lg shadow-sm"
      >
        Loading your team…
      </div>
    );
  }

  // Unauthorized state
  if (authError) {
    return (
      <div
        role="alert"
        className="max-w-lg mx-auto p-6 bg-red-50 border border-red-200 rounded-lg text-red-900 space-y-3"
      >
        <h3 className="text-sm font-semibold">Sign in Required</h3>
        <p className="text-xs">{authError}</p>
      </div>
    );
  }

  // Forbidden state (e.g. unverified participant or forbidden role)
  if (forbiddenError) {
    return (
      <div
        role="alert"
        className="max-w-lg mx-auto p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 space-y-3"
      >
        <h3 className="text-sm font-semibold">Access Restricted</h3>
        <p className="text-xs">{forbiddenError}</p>
      </div>
    );
  }

  // Initial load error with retry button
  if (loadError) {
    return (
      <div
        role="alert"
        className="max-w-lg mx-auto p-6 bg-red-50 border border-red-200 rounded-lg text-red-900 space-y-4"
      >
        <h3 className="text-sm font-semibold">Error Loading Team</h3>
        <p className="text-xs">{loadError}</p>
        <button
          type="button"
          onClick={loadTeam}
          className="px-4 py-2 bg-forest text-white text-xs font-semibold rounded-md hover:bg-forest-800"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state: no team yet for this event
  if (!team) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        {statusNotice && (
          <div
            role="status"
            aria-live="polite"
            className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-md"
          >
            {statusNotice}
          </div>
        )}

        <div
          role="status"
          className="p-6 bg-cream-50 border border-cream-200 rounded-lg text-center space-y-2"
        >
          <h3 className="text-base font-semibold text-forest-900">
            Create Your Hackathon Team
          </h3>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            You don't have a team for this event yet. Create your recruitment listing below
            to find targeted teammates and skill partners.
          </p>
        </div>

        <TeamListingForm
          mode="create"
          eventId={eventId}
          onSaved={(newTeam) => {
            setTeam(newTeam);
            setStatusNotice(
              "Team created. You're its owner. Add the roles you're recruiting for."
            );
          }}
        />
      </div>
    );
  }

  const isLocked = team.lifecycle && !team.lifecycle.mutable;
  const isMemberViewer = team.viewerRole === 'Member' || team.canLeave;
  const getLifecycleNotice = () => {
    if (!team.lifecycle || team.lifecycle.mutable) return null;
    switch (team.lifecycle.reason) {
      case 'Locked':
        return 'Team recruitment is locked. Editing and slot management are disabled.';
      case 'Disbanded':
        return 'This team has been disbanded. All recruitment and editing are closed.';
      case 'EventNotRecruiting':
        return 'The event recruitment period has concluded. Changes can no longer be made.';
      default:
        return 'This team listing is currently read-only.';
    }
  };

  const lifecycleNotice = getLifecycleNotice();

  if (isMemberViewer) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 px-4 sm:px-6">
        {statusNotice && (
          <div
            role="status"
            aria-live="polite"
            className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-md"
          >
            {statusNotice}
          </div>
        )}

        <RosterStatusView
          team={team}
          viewState="success"
          viewerParticipantId={team.viewerParticipantId}
          leaveSlot={
            <LeaveTeamPanel
              teamId={team.id}
              teamName={team.name}
              disabled={!team.canLeave || isLocked}
              onLeft={(notice) => {
                setTeam(null);
                setStatusNotice(notice);
              }}
            />
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 px-4 sm:px-6">
      {statusNotice && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-md"
        >
          {statusNotice}
        </div>
      )}

      {/* Lifecycle Read-Only Notice */}
      {isLocked && lifecycleNotice && (
        <div
          role="note"
          className="p-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg flex items-center gap-3"
        >
          <span className="font-semibold text-xs uppercase tracking-wider px-2 py-0.5 bg-amber-200/60 rounded">
            Read-only
          </span>
          <span>{lifecycleNotice}</span>
        </div>
      )}

      {/* Responsive layout: 1 col on mobile, 2 cols on lg+ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: Team Listing Form */}
        <div>
          <TeamListingForm
            mode="edit"
            eventId={eventId}
            team={team}
            disabled={isLocked}
            onSaved={(updated) => {
              setTeam(updated);
              setStatusNotice('Team listing updated.');
            }}
          />
        </div>

        {/* Right Column: Vacancy Management & Team Roster */}
        <div className="space-y-6">
          <VacancyPanel
            teamId={team.id}
            vacancies={team.vacancies}
            limits={team.limits}
            disabled={isLocked}
            onChanged={(updated) => {
              setTeam(updated);
            }}
            onInvitationIssued={() => {
              setInvitationsRefreshKey((k) => k + 1);
            }}
          />

          <OwnerInvitationsPanel
            teamId={team.id}
            vacancies={team.vacancies}
            disabled={isLocked}
            refreshKey={invitationsRefreshKey}
          />

          <TeamRosterPanel
            teamId={team.id}
            members={team.members}
            disabled={isLocked}
            onChanged={(updated) => {
              setTeam(updated);
            }}
            onDisbanded={() => {
              setTeam(null);
              setStatusNotice('Team disbanded. All pending requests were canceled.');
            }}
          />
        </div>
      </div>
    </div>
  );
}
