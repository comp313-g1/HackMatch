import { getSupabaseClient } from './client.js';
import { participantsRepository } from './participants.repository.js';
import type { ProviderIdentity, CreateProviderIdentityDTO, OAuthProvider } from './types.js';

const ALLOWED_PROVIDERS: readonly OAuthProvider[] = ['google', 'github', 'google.com', 'github.com'];

export interface IProviderIdentitiesRepository {
  findByProviderUid(provider: OAuthProvider, providerUid: string): Promise<ProviderIdentity | null>;
  findByParticipantId(participantId: string): Promise<ProviderIdentity[]>;
  createProviderIdentity(data: CreateProviderIdentityDTO): Promise<ProviderIdentity>;
  deleteProviderIdentity(participantId: string, provider: OAuthProvider): Promise<boolean>;
}

export const providerIdentitiesRepository: IProviderIdentitiesRepository = {
  async findByProviderUid(provider: OAuthProvider, providerUid: string): Promise<ProviderIdentity | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('provider_identities')
      .select('*')
      .eq('provider', provider)
      .eq('provider_uid', providerUid)
      .maybeSingle();

    if (error) throw error;
    return data as ProviderIdentity | null;
  },

  async findByParticipantId(participantId: string): Promise<ProviderIdentity[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('provider_identities')
      .select('*')
      .eq('participant_id', participantId);

    if (error) throw error;
    return (data || []) as ProviderIdentity[];
  },

  async createProviderIdentity(data: CreateProviderIdentityDTO): Promise<ProviderIdentity> {
    if (!data.participant_id || typeof data.participant_id !== 'string') {
      throw new Error('participant_id is required');
    }
    if (!data.provider || !ALLOWED_PROVIDERS.includes(data.provider)) {
      throw new Error(`Invalid provider '${data.provider}'. Must be one of: ${ALLOWED_PROVIDERS.join(', ')}`);
    }
    if (!data.provider_uid || typeof data.provider_uid !== 'string' || data.provider_uid.trim() === '') {
      throw new Error('provider_uid is required');
    }
    if (!data.email || typeof data.email !== 'string' || data.email.trim() === '') {
      throw new Error('email is required');
    }

    // US-002 AC4 & FR-003: Public OAuth cannot link to an ADMIN account
    const participant = await participantsRepository.findById(data.participant_id);
    if (!participant) {
      throw new Error(`Participant with ID '${data.participant_id}' not found`);
    }
    if (participant.role === 'ADMIN') {
      throw new Error('Public OAuth cannot link to an ADMIN account');
    }

    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('provider_identities')
      .insert({
        participant_id: data.participant_id,
        provider: data.provider,
        provider_uid: data.provider_uid,
        email: data.email,
        provider_handle: data.provider_handle ?? null,
        avatar_url: data.avatar_url ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;
    return record as ProviderIdentity;
  },

  async deleteProviderIdentity(participantId: string, provider: OAuthProvider): Promise<boolean> {
    const client = getSupabaseClient();
    const { error } = await client
      .from('provider_identities')
      .delete()
      .eq('participant_id', participantId)
      .eq('provider', provider);

    if (error) throw error;
    return true;
  },
};

export const findByProviderUid = providerIdentitiesRepository.findByProviderUid.bind(providerIdentitiesRepository);
export const findByParticipantId = providerIdentitiesRepository.findByParticipantId.bind(providerIdentitiesRepository);
export const createProviderIdentity = providerIdentitiesRepository.createProviderIdentity.bind(providerIdentitiesRepository);
export const deleteProviderIdentity = providerIdentitiesRepository.deleteProviderIdentity.bind(providerIdentitiesRepository);
