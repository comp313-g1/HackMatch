import type { Team } from '../db/types.js';

export type TeamLifecycleReason = 'Locked' | 'Disbanded' | 'EventNotRecruiting';

export interface TeamLifecycle {
  mutable: boolean;
  reason: TeamLifecycleReason | null;
}

/**
 * Derives team mutability and lifecycle state according to domain precedence (US-012 / Task 7 / #124).
 *
 * Precedence: Disbanded > Locked > EventNotRecruiting.
 * Mirrors SQL lock_team_for_owner_mutation checks.
 *
 * @param team Team object or pick containing recruitment_status.
 * @param event Event metadata containing publication status and end_date.
 * @param now Injectable reference date (defaults to new Date()).
 */
export function deriveTeamLifecycle(
  team: Pick<Team, 'recruitment_status'>,
  event: { status: 'Published' | 'Archived' | 'Disabled'; end_date: string },
  now: Date = new Date()
): TeamLifecycle {
  if (team.recruitment_status === 'Disbanded') {
    return { mutable: false, reason: 'Disbanded' };
  }

  if (team.recruitment_status === 'Locked') {
    return { mutable: false, reason: 'Locked' };
  }

  const isPublished = event.status === 'Published';
  const eventEndTime = new Date(event.end_date).getTime();
  const isStillRecruiting = isPublished && eventEndTime >= now.getTime();

  if (!isStillRecruiting) {
    return { mutable: false, reason: 'EventNotRecruiting' };
  }

  return { mutable: true, reason: null };
}
