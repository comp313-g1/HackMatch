import React from 'react';
import { CandidateProfileCard } from '../profile/CandidateProfileCard';
import type { OwnerApplicationReviewItem } from './applicationsApi';

export interface ApplicationReviewCardProps {
  application: OwnerApplicationReviewItem;
  approving?: boolean;
  disabled?: boolean;
  onApprove?: (applicationId: string) => void;
}

/**
 * US-020 / #189 / FR-060 — permitted applicant profile and application note.
 * A prospective owner has ordinary authenticated-PART visibility; shared contact
 * handles remain hidden until the applicant becomes a confirmed teammate.
 */
export function ApplicationReviewCard({
  application,
  approving = false,
  disabled = false,
  onApprove,
}: ApplicationReviewCardProps): React.JSX.Element {
  return (
    <li
      className="rounded-lg border border-cream-200 bg-cream-50/40 p-3 space-y-3"
      data-testid={`application-review-${application.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-900">
            {application.vacancyRole || 'Unspecified vacancy'}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{application.statusLabel}</p>
        </div>
        <time className="text-xs text-ink-muted" dateTime={application.createdAt}>
          Submitted {new Date(application.createdAt).toLocaleString()}
        </time>
      </div>

      <CandidateProfileCard
        viewerCategory="PART"
        profile={{
          displayName: application.applicantDisplayName,
          handle: application.applicantHandle,
          primaryRole: application.primaryRole,
          institution: application.institution,
          skills: application.skills,
          portfolioLinks: application.portfolios.map((portfolio) => ({
            ...portfolio,
            isSelfDeclared: true,
          })),
          selfDeclaredNotice:
            'Self-declared applicant profile — HackMatch validates portfolio URL format only and does not certify skills, identity, or achievements.',
        }}
      />

      <section
        aria-label={`Application note from ${application.applicantDisplayName}`}
        className="rounded-md border border-cream-200 bg-white p-3"
      >
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Application Note
        </h4>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">
          {application.message || 'No application note provided.'}
        </p>
      </section>

      {onApprove ? (
        <div className="flex justify-end border-t border-cream-200 pt-3">
          <button
            type="button"
            onClick={() => onApprove(application.id)}
            disabled={disabled || approving}
            className="rounded-md bg-forest px-4 py-2 text-xs font-semibold text-white hover:bg-forest-800 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={`approve-application-${application.id}`}
          >
            {approving ? 'Approving…' : 'Approve Application'}
          </button>
        </div>
      ) : null}
    </li>
  );
}

