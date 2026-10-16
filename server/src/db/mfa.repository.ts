import { getSupabaseClient } from './client.js';
import { participantsRepository } from './participants.repository.js';
import type {
  MfaChallenge,
  CreateMfaChallengeDTO,
  MfaAttempt,
  CreateMfaAttemptDTO,
} from './types.js';

export interface IMfaRepository {
  createChallenge(data: CreateMfaChallengeDTO): Promise<MfaChallenge>;
  getChallengeById(challengeId: string): Promise<MfaChallenge | null>;
  getLatestActiveChallenge(participantId: string): Promise<MfaChallenge | null>;
  invalidatePendingChallenges(participantId: string): Promise<number>;
  markChallengeConsumed(challengeId: string): Promise<MfaChallenge>;
  /**
   * Atomically consume a challenge only when the OTP hash matches and the row is
   * still unused, not invalidated, and not expired (US-004 AC 2 / FR-010).
   * Returns null when the compare-and-set update matched zero rows.
   */
  tryConsumeChallenge(
    challengeId: string,
    otpHash: string,
    now?: Date
  ): Promise<MfaChallenge | null>;
  createAttempt(data: CreateMfaAttemptDTO): Promise<MfaAttempt>;
  getRecentAttempts(participantId: string, limit?: number): Promise<MfaAttempt[]>;
  countRecentChallenges(participantId: string, since: Date | string): Promise<number>;
}

export const mfaRepository: IMfaRepository = {
  async createChallenge(data: CreateMfaChallengeDTO): Promise<MfaChallenge> {
    if (!data.participant_id || typeof data.participant_id !== 'string' || data.participant_id.trim() === '') {
      throw new Error('participant_id is required');
    }
    if (!data.otp_hash || typeof data.otp_hash !== 'string' || data.otp_hash.trim() === '') {
      throw new Error('otp_hash is required');
    }
    if (!data.expires_at || typeof data.expires_at !== 'string' || isNaN(Date.parse(data.expires_at))) {
      throw new Error('expires_at must be a valid ISO date string');
    }

    const participant = await participantsRepository.findById(data.participant_id);
    if (!participant) {
      throw new Error(`Participant with ID '${data.participant_id}' not found`);
    }

    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('mfa_challenges')
      .insert({
        participant_id: data.participant_id,
        otp_hash: data.otp_hash,
        expires_at: data.expires_at,
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as MfaChallenge;
  },

  async getChallengeById(challengeId: string): Promise<MfaChallenge | null> {
    if (!challengeId || typeof challengeId !== 'string' || challengeId.trim() === '') {
      throw new Error('challengeId is required');
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('mfa_challenges')
      .select('*')
      .eq('id', challengeId.trim())
      .maybeSingle();

    if (error) throw error;
    return data as MfaChallenge | null;
  },

  async getLatestActiveChallenge(participantId: string): Promise<MfaChallenge | null> {
    if (!participantId || typeof participantId !== 'string' || participantId.trim() === '') {
      throw new Error('participant_id is required');
    }

    const client = getSupabaseClient();
    const nowIso = new Date().toISOString();

    const { data, error } = await client
      .from('mfa_challenges')
      .select('*')
      .eq('participant_id', participantId)
      .is('consumed_at', null)
      .is('invalidated_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data as MfaChallenge | null;
  },

  async invalidatePendingChallenges(participantId: string): Promise<number> {
    if (!participantId || typeof participantId !== 'string' || participantId.trim() === '') {
      throw new Error('participant_id is required');
    }

    const client = getSupabaseClient();
    const nowIso = new Date().toISOString();

    const { data, error } = await client
      .from('mfa_challenges')
      .update({ invalidated_at: nowIso })
      .eq('participant_id', participantId)
      .is('consumed_at', null)
      .is('invalidated_at', null)
      .select('id');

    if (error) throw error;
    return (data || []).length;
  },

  async markChallengeConsumed(challengeId: string): Promise<MfaChallenge> {
    if (!challengeId || typeof challengeId !== 'string' || challengeId.trim() === '') {
      throw new Error('challengeId is required');
    }

    const client = getSupabaseClient();
    const nowIso = new Date().toISOString();

    const { data, error } = await client
      .from('mfa_challenges')
      .update({ consumed_at: nowIso })
      .eq('id', challengeId)
      .is('consumed_at', null)
      .is('invalidated_at', null)
      .select('*')
      .single();

    if (error) throw error;
    return data as MfaChallenge;
  },

  async tryConsumeChallenge(
    challengeId: string,
    otpHash: string,
    now: Date = new Date()
  ): Promise<MfaChallenge | null> {
    if (!challengeId || typeof challengeId !== 'string' || challengeId.trim() === '') {
      throw new Error('challengeId is required');
    }
    if (!otpHash || typeof otpHash !== 'string' || otpHash.trim() === '') {
      throw new Error('otpHash is required');
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error('now must be a valid Date');
    }

    const client = getSupabaseClient();
    const nowIso = now.toISOString();

    const { data, error } = await client
      .from('mfa_challenges')
      .update({ consumed_at: nowIso })
      .eq('id', challengeId.trim())
      .eq('otp_hash', otpHash.trim())
      .is('consumed_at', null)
      .is('invalidated_at', null)
      .gt('expires_at', nowIso)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    return (data as MfaChallenge | null) ?? null;
  },

  async createAttempt(data: CreateMfaAttemptDTO): Promise<MfaAttempt> {
    if (!data.participant_id || typeof data.participant_id !== 'string' || data.participant_id.trim() === '') {
      throw new Error('participant_id is required');
    }
    if (typeof data.success !== 'boolean') {
      throw new Error('success must be a boolean');
    }

    const participant = await participantsRepository.findById(data.participant_id);
    if (!participant) {
      throw new Error(`Participant with ID '${data.participant_id}' not found`);
    }

    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('mfa_attempts')
      .insert({
        participant_id: data.participant_id,
        challenge_id: data.challenge_id ?? null,
        success: data.success,
        ip_address: data.ip_address ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as MfaAttempt;
  },

  async getRecentAttempts(participantId: string, limit: number = 10): Promise<MfaAttempt[]> {
    if (!participantId || typeof participantId !== 'string' || participantId.trim() === '') {
      throw new Error('participant_id is required');
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('mfa_attempts')
      .select('*')
      .eq('participant_id', participantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []) as MfaAttempt[];
  },

  async countRecentChallenges(participantId: string, since: Date | string): Promise<number> {
    if (!participantId || typeof participantId !== 'string' || participantId.trim() === '') {
      throw new Error('participant_id is required');
    }
    const sinceDate = since instanceof Date ? since : new Date(since);
    if (isNaN(sinceDate.getTime())) {
      throw new Error('since must be a valid date or ISO string');
    }
    const sinceIso = sinceDate.toISOString();

    const client = getSupabaseClient();
    const { count, error } = await client
      .from('mfa_challenges')
      .select('*', { count: 'exact', head: true })
      .eq('participant_id', participantId)
      .gte('created_at', sinceIso);

    if (error) throw error;
    return count ?? 0;
  },
};

export const createChallenge = mfaRepository.createChallenge.bind(mfaRepository);
export const getChallengeById = mfaRepository.getChallengeById.bind(mfaRepository);
export const getLatestActiveChallenge = mfaRepository.getLatestActiveChallenge.bind(mfaRepository);
export const invalidatePendingChallenges = mfaRepository.invalidatePendingChallenges.bind(mfaRepository);
export const markChallengeConsumed = mfaRepository.markChallengeConsumed.bind(mfaRepository);
export const tryConsumeChallenge = mfaRepository.tryConsumeChallenge.bind(mfaRepository);
export const createAttempt = mfaRepository.createAttempt.bind(mfaRepository);
export const getRecentAttempts = mfaRepository.getRecentAttempts.bind(mfaRepository);
export const countRecentChallenges = mfaRepository.countRecentChallenges.bind(mfaRepository);
