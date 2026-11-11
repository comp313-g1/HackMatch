import React, { useId, useState } from 'react';
import type { RecommendedTeam } from './recommendedTeamsApi';

export interface RecommendedTeamCardProps {
  team: RecommendedTeam;
  /** Shown only when the parent supplies it (the US-018 application hook-up). */
  onApply?: (team: RecommendedTeam) => void;
}

/** "1 skill" / "3 skills". */
function skillCount(count: number): string {
  return `${count} skill${count === 1 ? '' : 's'}`;
}

/**
 * One suggested team: the open role, a match percentage, and which required skills the participant
 * already has (highlighted) or still lacks. All text comes from the server's allowlisted fields and
 * is rendered as plain text.
 */
export function RecommendedTeamCard({ team, onApply }: RecommendedTeamCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const required = team.matchedSkills.length + team.missingSkills.length;

  return (
    <li
      data-testid="recommended-team"
      className="rounded-xl border border-cream-300 bg-white p-4 shadow-sm space-y-3"
      aria-label={`${team.teamName}, ${team.matchPercent}% match`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-forest-900 break-words">{team.teamName}</h3>
          <p className="mt-0.5 text-sm text-ink-muted">
            Open role: <span className="font-medium text-ink">{team.vacancyRole}</span>
            {team.goal ? <> · Goal: {team.goal}</> : null}
            {team.commitmentHours !== null ? <> · {team.commitmentHours} h/week</> : null}
          </p>
        </div>
        <div className="shrink-0 text-right" data-testid="match-percent">
          <p className="text-2xl font-bold text-forest-900" aria-hidden="true">
            {team.matchPercent}%
          </p>
          <p className="text-xs text-ink-muted">
            <span className="sr-only">{team.matchPercent} percent </span>match
          </p>
        </div>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-cream-200"
        role="progressbar"
        aria-label="Match percentage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={team.matchPercent}
      >
        <div className="h-full rounded-full bg-forest" style={{ width: `${team.matchPercent}%` }} />
      </div>

      <div className="space-y-2">
        {required === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="no-required-skills">
            This role does not list any required skills.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink">
              You have {team.matchedSkills.length} of {skillCount(required)} this role asks for.
            </p>
            {team.matchedSkills.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Skills you have" data-testid="matched-skills">
                {team.matchedSkills.map((skill) => (
                  <li
                    key={skill}
                    className="rounded-full border border-forest-200 bg-forest-50 px-2.5 py-0.5 text-xs font-medium text-forest-900"
                  >
                    <span className="sr-only">Matched: </span>
                    {skill}
                  </li>
                ))}
              </ul>
            ) : null}
            {team.missingSkills.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Skills you could learn" data-testid="missing-skills">
                {team.missingSkills.map((skill) => (
                  <li
                    key={skill}
                    className="rounded-full border border-cream-300 bg-cream-100 px-2.5 py-0.5 text-xs text-ink-muted"
                  >
                    <span className="sr-only">Not yet: </span>
                    {skill}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={detailsId}
          className="text-xs font-medium text-forest-800 underline underline-offset-2 hover:text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest rounded"
          data-testid="toggle-why"
        >
          {open ? 'Hide why this matches' : 'Why this match?'}
        </button>
        {onApply ? (
          <button
            type="button"
            onClick={() => onApply(team)}
            className="rounded-md bg-forest px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2"
            data-testid="apply-to-team"
          >
            Apply to {team.teamName}
          </button>
        ) : null}
      </div>

      {open ? (
        <ul id={detailsId} className="space-y-1 text-xs text-ink-muted" data-testid="match-details">
          <li>{team.contributions.skill}</li>
          <li>{team.contributions.goal}</li>
          <li>{team.contributions.hours}</li>
        </ul>
      ) : null}
    </li>
  );
}
