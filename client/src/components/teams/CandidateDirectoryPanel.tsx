import React, { useState, useCallback } from 'react';
import type { TeamVacancyView } from './teamTypes';
import { TEAM_ROLES, TEAM_GOALS } from './teamTypes';
import {
  fetchTeamCandidateDirectory,
  validateCandidateDirectoryFilterDraft,
  CandidateDirectoryApiError,
  AuthRequiredError,
  type CandidateDirectoryFilterDraft,
  type CandidateDirectoryFieldErrors,
  type CandidateDirectoryResponse,
  type DirectoryCandidate,
  type SkillMatchMode,
} from './candidateDirectoryApi';
import type { ExperienceBadge } from '../profile/hackathonHistoryValidation';
import { CandidateProfileCard } from '../profile/CandidateProfileCard';
import { isValidHttpsPortfolioUrl } from '../profile/profileValidation';
import {
  issueTeamInvitation,
  InvitationsApiError,
} from './invitationsApi';

export interface CandidateDirectoryPanelProps {
  teamId: string;
  openVacancies?: TeamVacancyView[];
  disabled?: boolean;
  onInvitationIssued?: () => void;
}

type LoadState = 'idle' | 'loading' | 'success' | 'error';

function getBadgeClasses(badge: ExperienceBadge): string {
  switch (badge) {
    case 'Veteran':
      return 'bg-amber-50 text-amber-900 border-amber-300';
    case 'Competitor':
      return 'bg-forest-50 text-forest-800 border-forest-300';
    case 'Beginner':
    default:
      return 'bg-cream-100 text-ink-muted border-cream-300';
  }
}

const initialDraft: CandidateDirectoryFilterDraft = {
  skillsInput: '',
  skillMatchMode: 'AND',
  role: '',
  desiredRole: '',
  badge: '',
  minHours: '',
  maxHours: '',
  goal: '',
  search: '',
};

export function CandidateDirectoryPanel({
  teamId,
  openVacancies = [],
  disabled = false,
  onInvitationIssued,
}: CandidateDirectoryPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState<CandidateDirectoryFilterDraft>(initialDraft);
  const [fieldErrors, setFieldErrors] = useState<CandidateDirectoryFieldErrors>({});
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [result, setResult] = useState<CandidateDirectoryResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inspectedParticipantId, setInspectedParticipantId] = useState<string | null>(null);

  // US-017 Invitation states (US-014-T6 / FR-049)
  const [inviteDraftParticipantId, setInviteDraftParticipantId] = useState<string | null>(null);
  const [selectedVacancyId, setSelectedVacancyId] = useState<string>('');
  const [inviting, setInviting] = useState<boolean>(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteFieldErrors, setInviteFieldErrors] = useState<{ vacancyId?: string; inviteeParticipantId?: string }>({});
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [invitedParticipantIds, setInvitedParticipantIds] = useState<Set<string>>(() => new Set());

  const updateDraft = (field: keyof CandidateDirectoryFilterDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSearch = useCallback(
    async (e?: React.FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      if (disabled) return;

      const validation = validateCandidateDirectoryFilterDraft(draft);
      if (!validation.ok) {
        setFieldErrors(validation.errors);
        return;
      }

      setFieldErrors({});
      setLoadState('loading');
      setErrorMessage(null);

      try {
        const data = await fetchTeamCandidateDirectory(teamId, validation.filters);
        setResult(data);
        setLoadState('success');
      } catch (err: unknown) {
        if (err instanceof AuthRequiredError) {
          setErrorMessage('You need to sign in to search the candidate directory.');
        } else if (err instanceof CandidateDirectoryApiError) {
          if (err.errors) {
            setFieldErrors(err.errors);
          }
          setErrorMessage(err.message || 'Could not load candidates.');
        } else {
          setErrorMessage(err instanceof Error ? err.message : 'Could not load candidates.');
        }
        setLoadState('error');
      }
    },
    [teamId, draft, disabled]
  );

  const handleReset = () => {
    setDraft(initialDraft);
    setFieldErrors({});
    setErrorMessage(null);
  };

  const handleOpenInvite = (candidate: DirectoryCandidate) => {
    setInviteError(null);
    setInviteFieldErrors({});
    setInviteSuccess(null);
    setInviteDraftParticipantId(candidate.participantId);

    // Auto-defaults to a vacancy matching the candidate's desiredRole or primaryRole, or openVacancies[0]?.id
    const matchingVacancy = openVacancies.find(
      (v) =>
        (candidate.desiredRole && v.role === candidate.desiredRole) ||
        (candidate.primaryRole && v.role === candidate.primaryRole)
    );
    setSelectedVacancyId(matchingVacancy?.id ?? openVacancies[0]?.id ?? '');
  };

  const handleSendInvitation = async (inviteeParticipantId: string) => {
    if (!selectedVacancyId) {
      setInviteFieldErrors({ vacancyId: 'Please select an open vacancy slot.' });
      return;
    }
    setInviting(true);
    setInviteError(null);
    setInviteFieldErrors({});

    try {
      const invitation = await issueTeamInvitation(teamId, {
        vacancyId: selectedVacancyId,
        inviteeParticipantId,
        source: 'direct',
      });

      setInvitedParticipantIds((prev) => new Set(prev).add(inviteeParticipantId));
      setInviteDraftParticipantId(null);
      setInviteSuccess(
        `Invitation sent for the ${invitation.vacancyRole} slot. Expires ${new Date(
          invitation.expiresAt
        ).toLocaleString()}.`
      );
      onInvitationIssued?.();
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setInviteError('You need to sign in to send invitations.');
      } else if (err instanceof InvitationsApiError) {
        if (err.errors) {
          setInviteFieldErrors({
            vacancyId: err.errors.vacancyId,
            inviteeParticipantId: err.errors.inviteeParticipantId,
          });
        }
        setInviteError(err.message || 'Failed to send invitation.');
      } else {
        setInviteError(err instanceof Error ? err.message : 'Failed to send invitation.');
      }
    } finally {
      setInviting(false);
    }
  };

  return (
    <section
      className="rounded-lg border border-cream-200 bg-white p-5 shadow-sm space-y-4"
      data-testid="candidate-directory-panel"
      aria-label="Candidate Directory Search and Filter"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-200 pb-3">
        <div>
          <h3 className="text-base font-semibold text-forest-900">
            Candidate Directory
          </h3>
          <p className="text-xs text-ink-muted">
            Search and filter eligible Looking-for-Team participants for this event.
          </p>
        </div>
      </div>

      {/* Filter controls form */}
      <form onSubmit={handleSearch} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Skills Input */}
          <div className="sm:col-span-2">
            <label
              htmlFor="directory-skills-input"
              className="block text-xs font-semibold text-forest-900 mb-1"
            >
              Skills (comma-separated, max 10)
            </label>
            <input
              id="directory-skills-input"
              data-testid="directory-skills-input"
              type="text"
              value={draft.skillsInput ?? ''}
              onChange={(e) => updateDraft('skillsInput', e.target.value)}
              placeholder="e.g. React, TypeScript, Python"
              disabled={disabled || loadState === 'loading'}
              className="w-full text-xs px-3 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
            />
            {fieldErrors.skills && (
              <p role="alert" data-testid="skills-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.skills}
              </p>
            )}
          </div>

          {/* Skill Match Mode */}
          <div>
            <label
              htmlFor="directory-skill-mode"
              className="block text-xs font-semibold text-forest-900 mb-1"
            >
              Skill Match Mode
            </label>
            <select
              id="directory-skill-mode"
              data-testid="directory-skill-mode"
              value={draft.skillMatchMode ?? 'AND'}
              onChange={(e) => updateDraft('skillMatchMode', e.target.value as SkillMatchMode)}
              disabled={disabled || loadState === 'loading'}
              className="w-full text-xs px-2.5 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
            >
              <option value="AND">Match ALL listed skills (AND)</option>
              <option value="OR">Match ANY listed skill (OR)</option>
            </select>
            {fieldErrors.skillMatchMode && (
              <p role="alert" data-testid="skillMatchMode-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.skillMatchMode}
              </p>
            )}
          </div>

          {/* Primary Role */}
          <div>
            <label
              htmlFor="directory-role-select"
              className="block text-xs font-semibold text-forest-900 mb-1"
            >
              Primary Role
            </label>
            <select
              id="directory-role-select"
              data-testid="directory-role-select"
              value={draft.role ?? ''}
              onChange={(e) => updateDraft('role', e.target.value)}
              disabled={disabled || loadState === 'loading'}
              className="w-full text-xs px-2.5 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
            >
              <option value="">All primary roles</option>
              {TEAM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            {fieldErrors.role && (
              <p role="alert" data-testid="role-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.role}
              </p>
            )}
          </div>

          {/* Self-Reported Experience Badge */}
          <div>
            <label
              htmlFor="directory-badge-select"
              className="block text-xs font-semibold text-forest-900 mb-1"
            >
              Experience Badge
            </label>
            <select
              id="directory-badge-select"
              data-testid="directory-badge-select"
              value={draft.badge ?? ''}
              onChange={(e) => updateDraft('badge', e.target.value)}
              disabled={disabled || loadState === 'loading'}
              className="w-full text-xs px-2.5 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
            >
              <option value="">All experience tiers</option>
              <option value="Beginner">Beginner (0 hackathons)</option>
              <option value="Competitor">Competitor (1–3 hackathons)</option>
              <option value="Veteran">Veteran (4+ hackathons)</option>
            </select>
            {fieldErrors.badge && (
              <p role="alert" data-testid="badge-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.badge}
              </p>
            )}
          </div>

          {/* Desired Role */}
          <div>
            <label
              htmlFor="directory-desired-role-select"
              className="block text-xs font-semibold text-forest-900 mb-1"
            >
              Desired Role
            </label>
            <select
              id="directory-desired-role-select"
              data-testid="directory-desired-role-select"
              value={draft.desiredRole ?? ''}
              onChange={(e) => updateDraft('desiredRole', e.target.value)}
              disabled={disabled || loadState === 'loading'}
              className="w-full text-xs px-2.5 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
            >
              <option value="">All desired roles</option>
              {TEAM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            {fieldErrors.desiredRole && (
              <p role="alert" data-testid="desiredRole-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.desiredRole}
              </p>
            )}
          </div>

          {/* Goal */}
          <div>
            <label
              htmlFor="directory-goal-select"
              className="block text-xs font-semibold text-forest-900 mb-1"
            >
              Goal
            </label>
            <select
              id="directory-goal-select"
              data-testid="directory-goal-select"
              value={draft.goal ?? ''}
              onChange={(e) => updateDraft('goal', e.target.value)}
              disabled={disabled || loadState === 'loading'}
              className="w-full text-xs px-2.5 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
            >
              <option value="">All goals</option>
              {TEAM_GOALS.map((goal) => (
                <option key={goal} value={goal}>
                  {goal}
                </option>
              ))}
            </select>
            {fieldErrors.goal && (
              <p role="alert" data-testid="goal-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.goal}
              </p>
            )}
          </div>

          {/* Min & Max Hours */}
          <div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="directory-min-hours"
                  className="block text-xs font-semibold text-forest-900 mb-1"
                >
                  Min Hours
                </label>
                <input
                  id="directory-min-hours"
                  data-testid="directory-min-hours"
                  type="number"
                  min={1}
                  max={168}
                  value={draft.minHours ?? ''}
                  onChange={(e) => updateDraft('minHours', e.target.value)}
                  placeholder="1"
                  disabled={disabled || loadState === 'loading'}
                  className="w-full text-xs px-2.5 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
                />
              </div>
              <div>
                <label
                  htmlFor="directory-max-hours"
                  className="block text-xs font-semibold text-forest-900 mb-1"
                >
                  Max Hours
                </label>
                <input
                  id="directory-max-hours"
                  data-testid="directory-max-hours"
                  type="number"
                  min={1}
                  max={168}
                  value={draft.maxHours ?? ''}
                  onChange={(e) => updateDraft('maxHours', e.target.value)}
                  placeholder="168"
                  disabled={disabled || loadState === 'loading'}
                  className="w-full text-xs px-2.5 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
                />
              </div>
            </div>
            {fieldErrors.minHours && (
              <p role="alert" data-testid="minHours-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.minHours}
              </p>
            )}
            {fieldErrors.maxHours && (
              <p role="alert" data-testid="maxHours-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.maxHours}
              </p>
            )}
            {fieldErrors.hours && (
              <p role="alert" data-testid="hours-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.hours}
              </p>
            )}
          </div>

          {/* Search Input */}
          <div className="sm:col-span-2 lg:col-span-1">
            <label
              htmlFor="directory-search-input"
              className="block text-xs font-semibold text-forest-900 mb-1"
            >
              Search Handle or Name
            </label>
            <input
              id="directory-search-input"
              data-testid="directory-search-input"
              type="text"
              value={draft.search ?? ''}
              onChange={(e) => updateDraft('search', e.target.value)}
              placeholder="Filter by name or @handle"
              disabled={disabled || loadState === 'loading'}
              className="w-full text-xs px-3 py-1.5 border border-cream-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest disabled:bg-cream-100"
            />
            {fieldErrors.search && (
              <p role="alert" data-testid="search-error" className="text-xs text-red-600 mt-1">
                {fieldErrors.search}
              </p>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            data-testid="directory-search-submit"
            disabled={disabled || loadState === 'loading'}
            className="px-4 py-2 bg-forest text-white text-xs font-semibold rounded-md hover:bg-forest-800 disabled:opacity-50"
          >
            {loadState === 'loading' ? 'Searching…' : 'Search Candidates'}
          </button>
          <button
            type="button"
            data-testid="directory-reset-filters"
            onClick={handleReset}
            disabled={disabled || loadState === 'loading'}
            className="px-3 py-2 bg-white text-ink border border-cream-300 text-xs font-medium rounded-md hover:bg-cream-50 disabled:opacity-50"
          >
            Reset Filters
          </button>
        </div>
      </form>

      {/* Loading state */}
      {loadState === 'loading' && !result && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-testid="directory-loading"
          className="p-4 text-center text-xs font-medium text-forest-800 bg-cream-50/50 rounded-md border border-cream-200"
        >
          Loading candidates…
        </div>
      )}

      {/* Idle state */}
      {loadState === 'idle' && !result && (
        <p data-testid="directory-idle-hint" className="text-xs text-ink-muted">
          Search and filter eligible Looking-for-Team candidates for your team.
        </p>
      )}

      {/* Error Banner */}
      {loadState === 'error' && errorMessage && (
        <div
          role="alert"
          data-testid="directory-error-banner"
          className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md space-y-1"
        >
          <p className="font-semibold">{errorMessage}</p>
          <p className="text-ink-muted">Existing search filters and results have been preserved.</p>
        </div>
      )}

      {/* Empty State */}
      {result && result.empty && (
        <div
          role="status"
          aria-live="polite"
          data-testid="directory-empty-state"
          className="p-6 text-center text-xs text-ink-muted border border-dashed border-cream-300 rounded-lg bg-cream-50/30 space-y-2"
        >
          <p className="font-semibold text-ink text-sm">
            {result.message || 'No candidates match your criteria.'}
          </p>
          <p>
            Confirmed event participants and inactive accounts are excluded. Try adjusting your skills or filter criteria.
          </p>
        </div>
      )}

      {/* Candidate Result Cards */}
      {result && !result.empty && (
        <div className="space-y-4" data-testid="directory-results-container">
          <div
            role="status"
            aria-live="polite"
            data-testid="directory-results-summary"
            className="text-xs font-medium text-forest-900 bg-forest-50/70 border border-forest-200 px-3 py-2 rounded-md"
          >
            Found {result.totalMatched} matching candidate{result.totalMatched === 1 ? '' : 's'} (out of {result.totalEligible} eligible in event pool)
          </div>

          {inviteSuccess && (
            <div
              role="status"
              aria-live="polite"
              data-testid="directory-invite-success"
              className="p-3 text-xs text-forest-900 bg-forest-50 border border-forest-200 rounded-md flex items-center justify-between gap-2"
            >
              <p>{inviteSuccess}</p>
              <button
                type="button"
                onClick={() => setInviteSuccess(null)}
                className="text-forest-800 hover:text-forest-950 font-bold px-1"
                aria-label="Dismiss confirmation"
              >
                ×
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.candidates.map((candidate: DirectoryCandidate) => (
              <div
                key={candidate.participantId}
                data-testid="directory-candidate-card"
                className="p-4 rounded-lg border border-cream-300 bg-white shadow-sm space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4
                        data-testid="candidate-display-name"
                        className="text-sm font-bold text-forest-900"
                      >
                        {candidate.displayName}
                      </h4>
                      {candidate.handle && (
                        <p className="text-xs text-forest-800 font-mono">
                          @{candidate.handle}
                        </p>
                      )}
                      {candidate.institution && (
                        <p className="text-xs text-ink-muted mt-0.5">
                          {candidate.institution}
                        </p>
                      )}
                    </div>

                    <span
                      data-testid="candidate-badge"
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getBadgeClasses(
                        candidate.experienceBadge
                      )}`}
                    >
                      {candidate.experienceBadge} (Self-reported)
                    </span>
                  </div>

                  {/* Attributes */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {candidate.primaryRole && (
                      <span className="text-xs px-2 py-0.5 rounded bg-cream-100 text-forest-900 font-medium">
                        {candidate.primaryRole}
                      </span>
                    )}
                    {candidate.desiredRole && (
                      <span className="text-xs px-2 py-0.5 rounded bg-cream-100 text-ink-muted">
                        Desired: {candidate.desiredRole}
                      </span>
                    )}
                    {candidate.commitmentHours !== null && (
                      <span className="text-xs px-2 py-0.5 rounded bg-cream-100 text-ink-muted">
                        {candidate.commitmentHours} hrs/wk
                      </span>
                    )}
                    {candidate.goal && (
                      <span className="text-xs px-2 py-0.5 rounded bg-cream-100 text-ink-muted">
                        Goal: {candidate.goal}
                      </span>
                    )}
                  </div>

                  {/* Self-reported Experience Summary (US-007) */}
                  <p className="text-xs text-ink-muted" data-testid="candidate-experience-summary">
                    {candidate.experienceBadge} · {candidate.hackathonCount} self-reported hackathon{candidate.hackathonCount === 1 ? '' : 's'}
                  </p>

                  {/* Skills List with Non-Color Matched Indicator (FR-042) */}
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-semibold text-ink-muted">Skills:</p>
                    <div className="flex flex-wrap gap-1.5" data-testid="candidate-skills-list">
                      {candidate.skills.map((skill) => {
                        const isMatched = candidate.matchedSkills.some(
                          (ms) => ms.trim().toLowerCase() === skill.trim().toLowerCase()
                        );
                        return isMatched ? (
                          <span
                            key={skill}
                            data-testid="matched-skill-chip"
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-forest-100 text-forest-900 border border-forest-400"
                          >
                            ✓ {skill} (Matched)
                          </span>
                        ) : (
                          <span
                            key={skill}
                            data-testid="skill-chip"
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-cream-100 text-ink-muted border border-cream-200"
                          >
                            {skill}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Self-Declared Portfolio Links */}
                  {candidate.portfolioLinks && candidate.portfolioLinks.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <p className="text-xs font-semibold text-ink-muted">Portfolio Links:</p>
                      <ul className="flex flex-wrap gap-2 text-xs" data-testid="candidate-portfolio-links">
                        {candidate.portfolioLinks
                          .filter((link) => isValidHttpsPortfolioUrl(link.url))
                          .map((link, idx) => (
                            <li key={idx}>
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-forest hover:underline inline-flex items-center gap-1 font-medium"
                              >
                                {link.label || 'Portfolio'}
                                <span className="text-[10px] text-ink-muted">(Self-declared)</span>
                              </a>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}

                  {candidate.selfDeclaredNotice && (
                    <p className="text-[11px] text-ink-muted italic pt-1">
                      {candidate.selfDeclaredNotice}
                    </p>
                  )}
                </div>

                {/* Profile Inspection & Invitation Action Area (US-014 AC 4 / FR-049) */}
                <div className="pt-2 border-t border-cream-200 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    data-testid={`inspect-candidate-${candidate.participantId}`}
                    aria-expanded={inspectedParticipantId === candidate.participantId}
                    onClick={() => {
                      setInspectedParticipantId((prev) =>
                        prev === candidate.participantId ? null : candidate.participantId
                      );
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-forest border border-forest/30 rounded bg-forest-50/50 hover:bg-forest-100 transition-colors"
                  >
                    {inspectedParticipantId === candidate.participantId ? 'Hide Profile' : 'Inspect Profile'}
                  </button>

                  <div>
                    <button
                      type="button"
                      data-testid={`directory-open-invite-${candidate.participantId}`}
                      disabled={
                        disabled ||
                        openVacancies.length === 0 ||
                        invitedParticipantIds.has(candidate.participantId) ||
                        inviteDraftParticipantId === candidate.participantId
                      }
                      onClick={() => handleOpenInvite(candidate)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-forest rounded hover:bg-forest-800 disabled:opacity-50 transition-colors"
                    >
                      {invitedParticipantIds.has(candidate.participantId)
                        ? 'Invitation sent'
                        : 'Invite to Team'}
                    </button>
                    {openVacancies.length === 0 && (
                      <p className="text-[11px] text-ink-muted mt-1">
                        Add an open vacancy slot on your team to invite candidates.
                      </p>
                    )}
                  </div>
                </div>

                {/* Inline US-017 Invitation Composer */}
                {inviteDraftParticipantId === candidate.participantId && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSendInvitation(candidate.participantId);
                    }}
                    data-testid="directory-invite-form"
                    className="p-3 bg-cream-50/70 border border-cream-300 rounded-md space-y-3 mt-2"
                  >
                    <div>
                      <label
                        htmlFor={`directory-invite-slot-${candidate.participantId}`}
                        className="block text-xs font-semibold text-forest-900 mb-1"
                      >
                        Select open vacancy slot
                      </label>
                      <select
                        id={`directory-invite-slot-${candidate.participantId}`}
                        data-testid="directory-invite-slot-select"
                        value={selectedVacancyId}
                        onChange={(e) => setSelectedVacancyId(e.target.value)}
                        disabled={inviting}
                        className="w-full text-xs px-2.5 py-1.5 border border-cream-300 rounded-md shadow-sm bg-white focus:outline-none focus:ring-1 focus:ring-forest focus:border-forest"
                      >
                        {openVacancies.map((vacancy) => (
                          <option key={vacancy.id} value={vacancy.id}>
                            {vacancy.role}
                            {vacancy.skills && vacancy.skills.length > 0
                              ? ` (${vacancy.skills.join(', ')})`
                              : ''}
                          </option>
                        ))}
                      </select>
                      {inviteFieldErrors.vacancyId && (
                        <p role="alert" className="text-xs text-red-600 mt-1">
                          {inviteFieldErrors.vacancyId}
                        </p>
                      )}
                    </div>

                    {inviteError && (
                      <div
                        role="alert"
                        data-testid="directory-invite-error"
                        className="p-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded space-y-1"
                      >
                        <p className="font-semibold">{inviteError}</p>
                        <p className="text-ink-muted">
                          Your invitation details and candidate directory results have been kept.
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        data-testid="directory-confirm-invite"
                        disabled={inviting || !selectedVacancyId}
                        className="px-3 py-1.5 bg-forest text-white text-xs font-semibold rounded hover:bg-forest-800 disabled:opacity-50"
                      >
                        {inviting ? 'Sending…' : 'Send Invitation'}
                      </button>
                      <button
                        type="button"
                        data-testid="directory-cancel-invite"
                        disabled={inviting}
                        onClick={() => {
                          setInviteDraftParticipantId(null);
                          setInviteError(null);
                          setInviteFieldErrors({});
                        }}
                        className="px-3 py-1.5 bg-white text-ink border border-cream-300 text-xs font-medium rounded hover:bg-cream-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {inspectedParticipantId === candidate.participantId && (
                  <div
                    data-testid={`inspected-profile-${candidate.participantId}`}
                    className="pt-3 border-t border-cream-200 mt-2"
                  >
                    <CandidateProfileCard
                      viewerCategory="PART"
                      profile={{
                        displayName: candidate.displayName,
                        handle: candidate.handle,
                        primaryRole: candidate.primaryRole,
                        institution: candidate.institution,
                        skills: candidate.skills,
                        portfolioLinks: candidate.portfolioLinks,
                        selfDeclaredNotice: candidate.selfDeclaredNotice,
                        hackathonCount: candidate.hackathonCount,
                        experienceBadge: candidate.experienceBadge,
                        experienceBadgeSelfReported: candidate.experienceBadgeSelfReported,
                        hackathonHistory: candidate.hackathonHistory,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
