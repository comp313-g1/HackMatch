import React, { useState, useRef, useEffect } from 'react';
import type { TeamView, TeamMemberView } from './teamTypes';
import { codePointLength, validateRemovalReason } from './teamValidation';
import { removeMember, disbandTeam, TeamApiError, AuthRequiredError } from './teamApi';

export interface TeamRosterPanelProps {
  teamId: string;
  members: TeamMemberView[];
  disabled: boolean;
  onChanged: (t: TeamView) => void;
  onDisbanded: () => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';

export function TeamRosterPanel({
  teamId,
  members,
  disabled,
  onChanged,
  onDisbanded,
}: TeamRosterPanelProps): React.JSX.Element {
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [removalReason, setRemovalReason] = useState<string>('');
  const [removalError, setRemovalError] = useState<string | null>(null);

  const [confirmDisband, setConfirmDisband] = useState<boolean>(false);
  const [disbandError, setDisbandError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const cancelDisbandRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (confirmDisband) {
      cancelDisbandRef.current?.focus();
    }
  }, [confirmDisband]);

  const isPanelDisabled = disabled || busy;
  const reasonCount = codePointLength(removalReason);

  const resetRemovalState = () => {
    setRemovingMemberId(null);
    setRemovalReason('');
    setRemovalError(null);
  };

  const handleConfirmMemberRemoval = async (participantId: string) => {
    if (isPanelDisabled) return;

    const validation = validateRemovalReason(removalReason);
    if (Object.keys(validation.errors).length > 0) {
      setRemovalError(validation.errors.reason ?? 'Removal reason is required.');
      return;
    }

    setBusy(true);
    setRemovalError(null);

    try {
      const { team } = await removeMember(
        teamId,
        participantId,
        validation.sanitized!.reason
      );
      resetRemovalState();
      onChanged(team);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setRemovalError('You need to sign in to remove team members.');
        return;
      }
      if (err instanceof TeamApiError) {
        setRemovalError(err.message || 'Failed to remove member.');
        return;
      }
      setRemovalError(err instanceof Error ? err.message : 'Failed to remove member.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDisband = async () => {
    if (isPanelDisabled) return;

    setBusy(true);
    setDisbandError(null);

    try {
      await disbandTeam(teamId);
      setConfirmDisband(false);
      onDisbanded();
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setDisbandError('You need to sign in to disband the team.');
        return;
      }
      if (err instanceof TeamApiError) {
        setDisbandError(err.message || 'Failed to disband the team.');
        return;
      }
      setDisbandError(err instanceof Error ? err.message : 'Failed to disband the team.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-busy={busy}
      className="bg-white p-6 rounded-lg border border-cream-200 shadow-sm space-y-6"
    >
      <div className="border-b border-cream-200 pb-4">
        <h3 className="text-lg font-semibold text-forest-900">Team Roster</h3>
        <p className="text-xs text-ink-muted mt-0.5">
          {members.length} confirmed member{members.length === 1 ? '' : 's'}
        </p>
      </div>

      {disbandError && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-md"
        >
          {disbandError}
        </div>
      )}

      {/* Members list */}
      <ul className="divide-y divide-cream-100">
        {members.map((member) => {
          const isOwner = member.role === 'Owner';
          const isRemovingThis = removingMemberId === member.participantId;

          return (
            <li key={member.participantId} className="py-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-forest-900">
                      {member.displayName}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        isOwner
                          ? 'bg-purple-50 text-purple-800 border border-purple-200'
                          : 'bg-cream-100 text-ink-muted'
                      }`}
                    >
                      {member.role}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted mt-1">
                    Joined on {new Date(member.joinedAt).toLocaleDateString()}
                  </p>
                </div>

                {!isOwner && !isRemovingThis && (
                  <button
                    type="button"
                    onClick={() => {
                      resetRemovalState();
                      setRemovingMemberId(member.participantId);
                    }}
                    disabled={isPanelDisabled}
                    className="self-end sm:self-auto px-3 py-1 text-xs font-medium text-red-700 bg-white border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Inline member removal form */}
              {isRemovingThis && (
                <div
                  role="region"
                  aria-labelledby={`remove-member-heading-${member.participantId}`}
                  className="p-4 bg-red-50 border border-red-200 rounded-md space-y-3"
                >
                  <div className="flex justify-between items-center">
                    <h4
                      id={`remove-member-heading-${member.participantId}`}
                      className="text-xs font-semibold text-red-900"
                    >
                      Removal Reason for {member.displayName}
                    </h4>
                    <span
                      id={`member-reason-counter-${member.participantId}`}
                      aria-live="polite"
                      className={`text-xs ${reasonCount > 500 ? 'text-red-600 font-semibold' : 'text-ink-muted'}`}
                    >
                      {reasonCount}/500
                    </span>
                  </div>

                  {removalError && (
                    <p role="alert" className="text-xs text-red-700">
                      {removalError}
                    </p>
                  )}

                  <textarea
                    rows={2}
                    value={removalReason}
                    onChange={(e) => {
                      setRemovalReason(e.target.value);
                      if (removalError) setRemovalError(null);
                    }}
                    disabled={isPanelDisabled}
                    aria-label={`Reason for removing ${member.displayName}`}
                    aria-describedby={`member-reason-counter-${member.participantId}`}
                    placeholder="Provide a constructive reason for removing this teammate..."
                    className={`${inputClass} border-red-300`}
                  />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirmMemberRemoval(member.participantId)}
                      disabled={isPanelDisabled}
                      className="px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      {busy ? 'Removing...' : 'Confirm Remove'}
                    </button>
                    <button
                      type="button"
                      onClick={resetRemovalState}
                      disabled={isPanelDisabled}
                      className="px-3 py-1.5 bg-white border border-cream-300 text-ink text-xs font-medium rounded hover:bg-cream-100 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Disband Team Region */}
      <div className="pt-6 border-t border-cream-200">
        {confirmDisband ? (
          <div
            role="alertdialog"
            aria-labelledby="disband-dialog-title"
            aria-describedby="disband-dialog-desc"
            className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3"
          >
            <h4 id="disband-dialog-title" className="text-sm font-semibold text-red-900">
              Are you sure you want to disband this team?
            </h4>
            <p id="disband-dialog-desc" className="text-xs text-red-800">
              Disbanding the team will release all confirmed members, cancel all pending
              requests, and mark the team as Disbanded. This action cannot be undone.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleConfirmDisband}
                disabled={isPanelDisabled}
                className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Disbanding...' : 'Yes, Disband Team'}
              </button>
              <button
                ref={cancelDisbandRef}
                type="button"
                onClick={() => setConfirmDisband(false)}
                disabled={isPanelDisabled}
                className="px-4 py-2 bg-white border border-cream-300 text-ink text-xs font-medium rounded-md hover:bg-cream-100 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink">Disband Team</p>
              <p className="text-xs text-ink-muted">
                Dissolves this team, releases all confirmed members, and cancels pending requests.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmDisband(true)}
              disabled={isPanelDisabled}
              className="px-4 py-2 border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold rounded-md disabled:opacity-50"
            >
              Disband Team
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
