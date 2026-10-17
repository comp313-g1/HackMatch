import React from 'react';
import { isValidHttpsPortfolioUrl } from './profileValidation';

export type ProfileViewerCategory = 'VISITOR' | 'PART' | 'CONFIRMED_TEAMMATE' | 'OWNER';

export interface CandidatePortfolioLink {
  url: string;
  label?: string | null;
  isSelfDeclared?: boolean;
}

export interface CandidateProfileData {
  displayName?: string;
  handle?: string | null;
  primaryRole?: string | null;
  institution?: string | null;
  skills?: string[];
  portfolioLinks?: CandidatePortfolioLink[];
  sharedContactHandle?: string | null;
  sharedContactAudienceNotice?: string;
  selfDeclaredNotice?: string;
}

export interface CandidateProfileCardProps {
  viewerCategory: ProfileViewerCategory;
  profile: CandidateProfileData;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRequestSignIn?: () => void;
}

export function CandidateProfileCard({
  viewerCategory,
  profile,
  loading = false,
  error = null,
  onRetry,
  onRequestSignIn,
}: CandidateProfileCardProps): React.JSX.Element {
  if (loading) {
    return (
      <article
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Loading candidate profile"
        className="max-w-md w-full p-5 bg-white rounded-xl border border-cream-200 shadow-sm"
      >
        <p className="text-sm font-medium text-ink-muted">Loading candidate profile...</p>
      </article>
    );
  }

  if (error) {
    return (
      <article
        role="alert"
        aria-label="Candidate profile error"
        className="max-w-md w-full p-5 bg-white rounded-xl border border-red-200 shadow-sm space-y-3"
      >
        <p className="text-sm text-red-700">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="py-1.5 px-3 border border-cream-200 rounded-md shadow-sm text-xs font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest"
          >
            Retry loading profile
          </button>
        )}
      </article>
    );
  }

  // 1. Visitor boundary (US-006 AC 3 / FR-014 / US-006-T3):
  // Visitors see anonymized previews only — never member handles, participant cards, portfolio links, or contacts.
  if (viewerCategory === 'VISITOR') {
    const skillCount = Array.isArray(profile.skills) ? profile.skills.length : 0;
    return (
      <article
        aria-label="Anonymized participant preview"
        className="max-w-md w-full p-5 bg-white rounded-xl border border-cream-200 shadow-sm"
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <h4 className="font-display text-base font-semibold text-forest-900">
            Anonymous Participant
          </h4>
          {profile.primaryRole && (
            <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-forest-50 text-forest-800 border border-forest-100">
              {profile.primaryRole}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-muted mb-3">
          {skillCount > 0
            ? `${skillCount} declared skill ${skillCount === 1 ? 'tag' : 'tags'}`
            : 'Declared skills hidden in visitor preview'}
        </p>
        <div
          role="note"
          className="p-3 bg-cream-50 border border-cream-200 rounded-md text-xs text-ink-muted"
        >
          Sign in with a verified Participant account to inspect candidate handles, declared skills,
          and portfolio links.
        </div>
        {onRequestSignIn && (
          <button
            type="button"
            onClick={onRequestSignIn}
            className="mt-3 w-full py-2 px-4 rounded-md text-xs font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest"
          >
            Sign in to view candidate card
          </button>
        )}
      </article>
    );
  }

  // 2. Authenticated PART, CONFIRMED_TEAMMATE, or OWNER view (US-006 AC 3, AC 4 / FR-014 / US-006-T4):
  const canViewSharedContact =
    viewerCategory === 'CONFIRMED_TEAMMATE' || viewerCategory === 'OWNER';
  const safePortfolioLinks = (profile.portfolioLinks ?? []).filter((link) =>
    isValidHttpsPortfolioUrl(link.url)
  );
  const skills = profile.skills ?? [];

  return (
    <article
      aria-label={`Candidate profile for ${profile.displayName || profile.handle || 'Participant'}`}
      className="max-w-md w-full p-5 bg-white rounded-xl border border-cream-200 shadow-sm space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-lg font-semibold text-forest-900">
            {profile.displayName || 'Participant'}
          </h4>
          {profile.handle && (
            <p className="text-xs font-medium text-ink-muted">@{profile.handle}</p>
          )}
          {profile.institution && (
            <p className="text-xs text-ink-muted mt-0.5">{profile.institution}</p>
          )}
        </div>
        {profile.primaryRole ? (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-forest-50 text-forest-800 border border-forest-100">
            {profile.primaryRole}
          </span>
        ) : (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-cream-50 text-ink-muted border border-cream-200">
            Role not specified
          </span>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Skills
          </span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-cream-100 text-ink-muted">
            Self-declared
          </span>
        </div>
        {skills.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Declared skills">
            {skills.map((skill) => (
              <li
                key={skill}
                className="text-xs px-2.5 py-0.5 rounded-md bg-cream-50 border border-cream-200 text-ink"
              >
                {skill}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-muted">No skills listed yet.</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Portfolio Links
          </span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-cream-100 text-ink-muted">
            Self-declared
          </span>
        </div>
        {safePortfolioLinks.length > 0 ? (
          <ul className="space-y-1.5" aria-label="Self-declared portfolio links">
            {safePortfolioLinks.map((link) => (
              <li key={link.url} className="text-xs flex items-center justify-between gap-2">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-forest-700 underline hover:text-forest-900 break-all"
                >
                  {link.label ? `${link.label} (${link.url})` : link.url}
                </a>
                <span className="shrink-0 text-[10px] text-ink-muted">Self-declared</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-muted">No portfolio links listed.</p>
        )}
      </div>

      <div
        role="note"
        aria-label="Self-declared disclaimer"
        className="p-3 bg-cream-50 border border-cream-200 rounded-md text-xs text-ink-muted"
      >
        {profile.selfDeclaredNotice ||
          'Self-declared — HackMatch validates URL format only and does not certify skills, identity, or achievements.'}
      </div>

      {canViewSharedContact && profile.sharedContactHandle && (
        <div className="pt-3 border-t border-cream-200">
          <p className="text-xs font-semibold text-forest-900">
            Shared Teammate Contact:{' '}
            <span className="font-normal text-ink">{profile.sharedContactHandle}</span>
          </p>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {profile.sharedContactAudienceNotice ||
              'Visible only to confirmed teammates. Leaving or removal from a team revokes access.'}
          </p>
        </div>
      )}
    </article>
  );
}

export default CandidateProfileCard;
