import { getSupabaseClient } from './client.js';

/** US-032 / #388: which blocks exist between two participants, from the first one's point of view. */
export interface BlockState {
  /** `a` has blocked `b`. */
  blockedByMe: boolean;
  /** `b` has blocked `a`. */
  blockedByThem: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IParticipantBlockRepository {
  findBlockState(a: string, b: string): Promise<BlockState>;
}

export const participantBlockRepository: IParticipantBlockRepository = {
  async findBlockState(a, b) {
    // The ids go into a PostgREST filter string, so refuse anything that is not a plain uuid.
    if (!UUID_PATTERN.test(a) || !UUID_PATTERN.test(b)) {
      throw new Error('findBlockState requires two valid participant ids.');
    }
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participant_blocks')
      .select('blocker_id, blocked_id')
      .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`);

    if (error) throw error;
    const rows = (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>;
    return {
      blockedByMe: rows.some((r) => r.blocker_id === a && r.blocked_id === b),
      blockedByThem: rows.some((r) => r.blocker_id === b && r.blocked_id === a),
    };
  },
};
