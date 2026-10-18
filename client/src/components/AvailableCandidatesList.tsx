import React from 'react';
import type { AvailableCandidateCard } from '../services/availabilityApi';

export interface AvailableCandidatesListProps {
  candidates: AvailableCandidateCard[];
  currentParticipantId?: string | null;
  isLoading?: boolean;
}

export function AvailableCandidatesList({
  candidates,
  currentParticipantId,
  isLoading = false,
}: AvailableCandidatesListProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-white rounded-xl border border-cream-200 shadow-sm p-8 text-center"
      >
        <div
          className="mx-auto mb-3 h-8 w-8 rounded-full border-4 border-forest-100 border-t-forest animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-ink-muted">Loading available candidates...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-cream-200 shadow-sm p-6 sm:p-8">
      <div className="border-b border-cream-200 pb-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-xl font-bold text-forest-900">
            Available Candidates Pool
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Participants actively looking to join hackathon teams.
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-forest-50 text-forest-800 border border-forest-100 self-start sm:self-auto">
          {candidates.length} {candidates.length === 1 ? 'Candidate' : 'Candidates'}
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="py-12 text-center text-ink-muted">
          <svg
            className="mx-auto h-12 w-12 text-ink-muted/40 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <p className="text-base font-medium text-charcoal-700">
            No participants currently have Looking for Team enabled.
          </p>
          <p className="text-sm text-ink-muted mt-1">
            Enable the toggle above to be the first available candidate discovered by Team Leads!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {candidates.map((candidate) => {
            const isMe =
              Boolean(currentParticipantId) &&
              candidate.participantId === currentParticipantId;

            return (
              <article
                key={candidate.participantId}
                aria-label={`Availability card for ${candidate.displayName}`}
                className="rounded-lg border border-cream-200 bg-cream-50/50 p-5 hover:border-forest-200 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <h4 className="text-base font-bold text-forest-900 inline-flex items-center gap-2">
                      <span>{candidate.displayName}</span>
                      {isMe && (
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                          You
                        </span>
                      )}
                    </h4>
                    {candidate.handle && (
                      <p className="text-xs text-ink-muted font-mono">@{candidate.handle}</p>
                    )}
                  </div>
                  {candidate.desiredRole && (
                    <span className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold bg-forest text-white">
                      {candidate.desiredRole}
                    </span>
                  )}
                </div>

                {candidate.institution && (
                  <p className="text-xs text-ink-muted mb-3">{candidate.institution}</p>
                )}

                <div className="flex flex-wrap gap-2 mb-3">
                  {candidate.commitmentHours != null && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-cream-100 text-charcoal-800 border border-cream-200">
                      ⏱ {candidate.commitmentHours} hrs/wk
                    </span>
                  )}
                  {candidate.goal && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-forest-50 text-forest-800 border border-forest-100">
                      🎯 {candidate.goal}
                    </span>
                  )}
                  {candidate.primaryRole && candidate.primaryRole !== candidate.desiredRole && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-cream-100 text-charcoal-700 border border-cream-200">
                      Primary: {candidate.primaryRole}
                    </span>
                  )}
                </div>

                {candidate.skills && candidate.skills.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-charcoal-700 mb-1">Skills:</p>
                    <div className="flex flex-wrap gap-1">
                      {candidate.skills.map((skill) => (
                        <span
                          key={skill}
                          className="px-2 py-0.5 text-xs bg-white text-forest-900 border border-cream-200 rounded"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {candidate.portfolioLinks && candidate.portfolioLinks.length > 0 && (
                  <div className="pt-2 border-t border-cream-200">
                    <p className="text-xs font-semibold text-charcoal-700 mb-1">Portfolios:</p>
                    <div className="flex flex-wrap gap-2">
                      {candidate.portfolioLinks.map((link, idx) => (
                        <a
                          key={`${link.url}-${idx}`}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-forest hover:underline hover:text-forest-800 inline-flex items-center gap-0.5"
                        >
                          {link.label || 'Portfolio'}
                          <span aria-hidden="true">↗</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
