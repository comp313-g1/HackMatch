import { getSupabaseClient } from '../db/client.js';

export const MEMBERSHIP_PSEUDONYM_PREFIX = 'Former Member';

export interface MembershipPseudonymizationResult {
  /** Locked-team membership rows whose identifying snapshot fields were replaced. */
  lockedMembershipsPseudonymized: number;
  /** Unlocked / historical membership rows also cleared of identifying snapshots. */
  unlockedMembershipsPseudonymized: number;
  /** Membership row ids that remain (never deleted). */
  membershipIdsPreserved: string[];
  /** Locked team ids whose roster row count/role/status were left intact. */
  lockedTeamIdsPreserved: string[];
  membershipsDeleted: false;
}

/**
 * Stable non-identifying roster label for a deleted participant (US-027 / #253).
 */
export function buildMembershipPseudonym(participantId: string): string {
  const trimmed = participantId.trim();
  if (!trimmed) {
    throw new Error('participantId is required to build a membership pseudonym.');
  }
  const shortId = trimmed.replace(/-/g, '').slice(0, 8);
  return `${MEMBERSHIP_PSEUDONYM_PREFIX} ${shortId}`;
}

/**
 * Replace historical membership identifying snapshot fields with a pseudonym.
 * Preserves locked roster integrity: never deletes membership rows and never
 * mutates team_id, participant_id, role, status, joined_at, or ended_at.
 */
export async function pseudonymizeHistoricalMemberships(
  participantId: string
): Promise<MembershipPseudonymizationResult> {
  const id = participantId?.trim();
  if (!id) {
    throw new Error('participantId is required for membership pseudonymization.');
  }

  const client = getSupabaseClient();
  const now = new Date().toISOString();
  const pseudonym = buildMembershipPseudonym(id);

  const { data: memberships, error: listErr } = await client
    .from('team_memberships')
    .select(
      `
      id,
      team_id,
      role,
      status,
      joined_at,
      ended_at,
      teams!inner (
        id,
        locked_at
      )
    `
    )
    .eq('participant_id', id);

  if (listErr) throw listErr;

  const rows = (memberships || []) as Array<{
    id: string;
    team_id: string;
    role: string;
    status: string;
    joined_at: string;
    ended_at: string | null;
    teams:
      | { id: string; locked_at: string | null }
      | Array<{ id: string; locked_at: string | null }>;
  }>;

  if (rows.length === 0) {
    return {
      lockedMembershipsPseudonymized: 0,
      unlockedMembershipsPseudonymized: 0,
      membershipIdsPreserved: [],
      lockedTeamIdsPreserved: [],
      membershipsDeleted: false,
    };
  }

  let lockedMembershipsPseudonymized = 0;
  let unlockedMembershipsPseudonymized = 0;
  const membershipIdsPreserved: string[] = [];
  const lockedTeamIdsPreserved: string[] = [];

  for (const row of rows) {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    const isLocked = Boolean(team?.locked_at);

    const { data: updated, error: updateErr } = await client
      .from('team_memberships')
      .update({
        identity_display_name: pseudonym,
        identity_handle: null,
        identity_email: null,
        identity_pseudonymized_at: now,
        updated_at: now,
      })
      .eq('id', row.id)
      .eq('participant_id', id)
      // Structural guard — refuse to touch a row that somehow changed team binding.
      .eq('team_id', row.team_id)
      .select('id, team_id, role, status, joined_at, ended_at')
      .single();

    if (updateErr) throw updateErr;
    if (!updated) {
      throw new Error(`Failed to pseudonymize membership ${row.id}.`);
    }

    // Roster integrity: structural fields must match the pre-update snapshot.
    if (
      updated.team_id !== row.team_id ||
      updated.role !== row.role ||
      updated.status !== row.status ||
      updated.joined_at !== row.joined_at ||
      (updated.ended_at ?? null) !== (row.ended_at ?? null)
    ) {
      throw new Error(
        `Locked roster integrity check failed for membership ${row.id}: structural fields changed.`
      );
    }

    membershipIdsPreserved.push(updated.id as string);
    if (isLocked) {
      lockedMembershipsPseudonymized += 1;
      if (team?.id && !lockedTeamIdsPreserved.includes(team.id)) {
        lockedTeamIdsPreserved.push(team.id);
      }
    } else {
      unlockedMembershipsPseudonymized += 1;
    }
  }

  return {
    lockedMembershipsPseudonymized,
    unlockedMembershipsPseudonymized,
    membershipIdsPreserved,
    lockedTeamIdsPreserved,
    membershipsDeleted: false,
  };
}

/**
 * Prefer pseudonymized snapshot labels over live participant identity for roster cards.
 */
export function resolveMembershipDisplayName(input: {
  identityPseudonymizedAt?: string | null;
  identityDisplayName?: string | null;
  handle?: string | null;
  fullName?: string | null;
}): { displayName: string; handle: string | null; isPseudonymized: boolean } {
  if (input.identityPseudonymizedAt && input.identityDisplayName?.trim()) {
    return {
      displayName: input.identityDisplayName.trim(),
      handle: null,
      isPseudonymized: true,
    };
  }
  const handle = input.handle?.trim() || null;
  if (handle) {
    return { displayName: handle, handle, isPseudonymized: false };
  }
  const fullName = input.fullName?.trim();
  return {
    displayName: fullName && fullName.length > 0 ? fullName : 'Participant',
    handle: null,
    isPseudonymized: false,
  };
}
