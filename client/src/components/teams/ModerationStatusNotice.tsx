import React from 'react';
import type { TeamModerationStatus } from './teamTypes';

export interface ModerationStatusNoticeProps {
  moderationStatus?: TeamModerationStatus | null;
  moderationHiddenAt?: string | null;
  linkRemovalNotice?: string | null;
}

/**
 * Owner/member-visible moderation status (US-026 / #244 / AC 5).
 * Hidden listings stay off discovery boards; historical memberships remain intact.
 */
export function ModerationStatusNotice({
  moderationStatus,
  moderationHiddenAt,
  linkRemovalNotice,
}: ModerationStatusNoticeProps): React.JSX.Element | null {
  const status = moderationStatus ?? 'None';
  if (status === 'None' && !linkRemovalNotice) {
    return null;
  }

  if (status === 'Hidden') {
    const when = moderationHiddenAt
      ? ` Hidden at ${new Date(moderationHiddenAt).toLocaleString()}.`
      : '';
    return (
      <div
        role="status"
        className="p-3 text-sm text-amber-950 bg-amber-50 border border-amber-200 rounded-md space-y-1"
        data-testid="moderation-status-hidden"
      >
        <p className="font-semibold">Listing hidden by moderation</p>
        <p className="text-xs">
          This team is excluded from ordinary discovery boards.{when} Confirmed memberships are
          preserved.
        </p>
        {linkRemovalNotice ? (
          <p className="text-xs" data-testid="moderation-link-removal-on-team">
            {linkRemovalNotice}
          </p>
        ) : null}
      </div>
    );
  }

  if (status === 'Warned') {
    return (
      <div
        role="status"
        className="p-3 text-sm text-amber-950 bg-amber-50 border border-amber-200 rounded-md"
        data-testid="moderation-status-warned"
      >
        <p className="font-semibold">Moderation warning</p>
        <p className="text-xs">
          Platform administrators recorded a warning on this listing. Review your content and
          communication links.
        </p>
        {linkRemovalNotice ? (
          <p className="text-xs mt-1" data-testid="moderation-link-removal-on-team">
            {linkRemovalNotice}
          </p>
        ) : null}
      </div>
    );
  }

  if (linkRemovalNotice) {
    return (
      <div
        role="status"
        className="p-3 text-sm text-amber-950 bg-amber-50 border border-amber-200 rounded-md"
        data-testid="moderation-link-removal-on-team"
      >
        {linkRemovalNotice}
      </div>
    );
  }

  return null;
}
