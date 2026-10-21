import { getSupabaseClient } from './client.js';
import type { Participant, CreateParticipantDTO, UpdateParticipantDTO } from './types.js';

export interface IParticipantRepository {
  findById(id: string): Promise<Participant | null>;
  findByFirebaseUid(firebaseUid: string): Promise<Participant | null>;
  findByEmail(email: string): Promise<Participant | null>;
  createParticipant(data: CreateParticipantDTO): Promise<Participant>;
  updateParticipant(id: string, data: UpdateParticipantDTO): Promise<Participant>;
  updateVerificationStatus(id: string, isVerified: boolean): Promise<Participant>;
  provisionAdminParticipant(data: { firebase_uid: string; email: string; full_name: string }): Promise<Participant>;
}


export const participantsRepository: IParticipantRepository = {
  async findById(id: string): Promise<Participant | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participants')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as Participant | null;
  },

  async findByFirebaseUid(firebaseUid: string): Promise<Participant | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participants')
      .select('*')
      .eq('firebase_uid', firebaseUid)
      .maybeSingle();

    if (error) throw error;
    return data as Participant | null;
  },

  async findByEmail(email: string): Promise<Participant | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('participants')
      .select('*')
      .ilike('email', email)
      .maybeSingle();

    if (error) throw error;
    return data as Participant | null;
  },

  async createParticipant(data: CreateParticipantDTO): Promise<Participant> {
    if (data.role && String(data.role).trim().toUpperCase() !== 'PART') {
      throw new Error('UnauthorizedRoleError: Public participant creation cannot specify role ADMIN. Use operator provisioning.');
    }
    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('participants')
      .insert(data)
      .select('*')
      .single();

    if (error) throw error;
    return record as Participant;
  },

  async updateParticipant(id: string, data: UpdateParticipantDTO): Promise<Participant> {
    // US-027 / #254 — public updates must never self-promote or change roles.
    if (data.role !== undefined) {
      throw new Error(
        'UnauthorizedRoleError: Role changes are not allowed through account updates. Use operator provisioning for ADMIN.'
      );
    }
    const client = getSupabaseClient();
    const { data: record, error } = await client
      .from('participants')
      .update(data)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return record as Participant;
  },

  async updateVerificationStatus(id: string, isVerified: boolean): Promise<Participant> {
    return this.updateParticipant(id, { is_verified: isVerified });
  },

  async provisionAdminParticipant(data: {
    firebase_uid: string;
    email: string;
    full_name: string;
  }): Promise<Participant> {
    const client = getSupabaseClient();
    if (typeof (client as unknown as { rpc?: unknown }).rpc === 'function') {
      const { data: record, error } = await client.rpc('provision_admin_participant', {
        p_firebase_uid: data.firebase_uid,
        p_email: data.email,
        p_full_name: data.full_name,
      }).single();

      if (!error && record) {
        return record as Participant;
      }
      if (error && (error as { code?: string }).code !== 'PGRST202' && !(error as { message?: string }).message?.includes('function')) {
        throw error;
      }
    }

    const { data: record, error } = await client
      .from('participants')
      .upsert(
        {
          firebase_uid: data.firebase_uid,
          email: data.email,
          full_name: data.full_name,
          role: 'ADMIN',
          is_verified: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'firebase_uid' }
      )
      .select('*')
      .single();

    if (error) throw error;
    return record as Participant;
  },
};

export const findById = participantsRepository.findById.bind(participantsRepository);
export const findByFirebaseUid = participantsRepository.findByFirebaseUid.bind(participantsRepository);
export const findByEmail = participantsRepository.findByEmail.bind(participantsRepository);
export const createParticipant = participantsRepository.createParticipant.bind(participantsRepository);
export const updateParticipant = participantsRepository.updateParticipant.bind(participantsRepository);
export const updateVerificationStatus = participantsRepository.updateVerificationStatus.bind(participantsRepository);
export const provisionAdminParticipant = participantsRepository.provisionAdminParticipant.bind(participantsRepository);

