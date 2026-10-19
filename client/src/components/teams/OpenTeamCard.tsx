import React from 'react';
import type {
  OpenTeamPartCard,
  OpenTeamVisitorPreview,
  OpenTeamApplyTarget,
} from './openTeamsApi';

export interface OpenTeamCardProps {
  team: OpenTeamPartCard | OpenTeamVisitorPreview;
  viewer: 'PART' | 'VISITOR';
  onApply: (target: OpenTeamApplyTarget) => void;
  onSignIn: () => void;
}

export function OpenTeamCard({
  team,
  viewer,
  onApply,
  onSignIn,
}: OpenTeamCardProps): React.JSX.Element {
  if (viewer === 'PART') {
    const partTeam = team as OpenTeamPartCard;
    return (
      <article
        aria-label={`Team ${partTeam.name}`}
        className="bg-white p-5 rounded-xl border border-cream-200 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow"
      >
        <div className="space-y-2">
          {/* Header: Name, badges */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-ink leading-tight">{partTeam.name}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="inline-block px-2 py-0.5 text-xs font-semibold bg-forest-50 text-forest-800 rounded border border-forest-200">
                  {partTeam.goal}
                </span>
                <span className="text-xs text-ink-muted">
                  ⏱ {partTeam.commitmentHours} hrs/wk
                </span>
                {partTeam.isViewerMember && (
                  <span className="inline-block px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded border border-emerald-200">
                    Your team
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Pitch */}
          <p className="text-sm text-ink-muted line-clamp-3">
            {partTeam.pitch}
          </p>

          {/* Member & Slot Counts */}
          <div className="text-xs text-ink-muted font-medium pt-1">
            {partTeam.confirmedMembers} member(s) · {partTeam.openSlots} open slot(s)
          </div>

          {/* Confirmed Members List */}
          {partTeam.members.length > 0 && (
            <div className="pt-2 border-t border-cream-100">
              <span className="text-xs font-semibold text-ink">Members: </span>
              <span className="text-xs text-ink-muted">
                {partTeam.members.map((m, idx) => (
                  <span key={idx}>
                    {m.displayName} ({m.role}){idx < partTeam.members.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>

        {/* Vacancies List */}
        <div className="space-y-2 pt-3 border-t border-cream-100">
          <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
            Open Vacancies ({partTeam.vacancies.length})
          </h3>
          <div className="space-y-2">
            {partTeam.vacancies.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between p-2 rounded bg-cream-50/60 border border-cream-100 text-xs"
              >
                <div className="space-y-1 pr-2">
                  <div className="font-semibold text-forest-900">{v.role}</div>
                  {v.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {v.skills.map((skill, sIdx) => (
                        <span
                          key={sIdx}
                          className="px-1.5 py-0.5 bg-white text-ink-muted rounded border border-cream-200 text-[11px]"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {!partTeam.isViewerMember && (
                  <button
                    type="button"
                    onClick={() =>
                      onApply({
                        teamId: partTeam.id,
                        vacancyId: v.id,
                        role: v.role,
                        teamName: partTeam.name,
                      })
                    }
                    aria-label={`Apply for ${v.role} slot on ${partTeam.name}`}
                    className="shrink-0 px-3 py-1 font-semibold text-white bg-forest hover:bg-forest-800 rounded focus:outline-none focus:ring-2 focus:ring-forest"
                  >
                    Apply
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </article>
    );
  }

  // Visitor Preview
  const visitorTeam = team as OpenTeamVisitorPreview;
  return (
    <article
      aria-label="Recruiting team preview"
      className="bg-white p-5 rounded-xl border border-cream-200 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow"
    >
      <div className="space-y-2">
        {/* Anonymized Label */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-ink leading-tight">
              {visitorTeam.displayLabel}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="inline-block px-2 py-0.5 text-xs font-semibold bg-forest-50 text-forest-800 rounded border border-forest-200">
                {visitorTeam.goal}
              </span>
              <span className="text-xs text-ink-muted">
                ⏱ {visitorTeam.commitmentHours} hrs/wk
              </span>
            </div>
          </div>
        </div>

        {/* Member & Slot Counts */}
        <div className="text-xs text-ink-muted font-medium pt-1">
          {visitorTeam.confirmedMembers} member(s) · {visitorTeam.openSlots} open slot(s)
        </div>
      </div>

      {/* Vacancies List */}
      <div className="space-y-2 pt-3 border-t border-cream-100">
        <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
          Open Vacancies ({visitorTeam.vacancies.length})
        </h3>
        <div className="space-y-2">
          {visitorTeam.vacancies.map((v, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2 rounded bg-cream-50/60 border border-cream-100 text-xs"
            >
              <div className="space-y-1 pr-2">
                <div className="font-semibold text-forest-900">{v.role}</div>
                {v.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {v.skills.map((skill, sIdx) => (
                      <span
                        key={sIdx}
                        className="px-1.5 py-0.5 bg-white text-ink-muted rounded border border-cream-200 text-[11px]"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onSignIn}
                className="shrink-0 px-3 py-1 font-semibold text-forest border border-forest hover:bg-forest-50 rounded focus:outline-none focus:ring-2 focus:ring-forest"
              >
                Sign in to apply
              </button>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
