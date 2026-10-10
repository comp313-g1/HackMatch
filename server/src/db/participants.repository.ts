import { getSupabaseClient } from './client.js';
import type { Participant, CreateParticipantDTO, UpdateParticipantDTO } from './types.js';

export interface IParticipantRepository {
  findById(id: string): Promise<Participant | null>;
  findByFirebaseUid(firebaseUid: string): Promise<Participant | null>;
  findByEmail(email: string): Promise<Participant | null>;
  createParticipant(data: CreateParticipantDTO): Promise<Participant>;
  updateParticipant(id: string, data: UpdateParticipantDTO): Promise<Participant>;
  updateVerificationStatus(id: string, isVerified: boolean): Promise<Participant>;
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
};

export const findById = participantsRepository.findById.bind(participantsRepository);
export const findByFirebaseUid = participantsRepository.findByFirebaseUid.bind(participantsRepository);
export const findByEmail = participantsRepository.findByEmail.bind(participantsRepository);
export const createParticipant = participantsRepository.createParticipant.bind(participantsRepository);
export const updateParticipant = participantsRepository.updateParticipant.bind(participantsRepository);
export const updateVerificationStatus = participantsRepository.updateVerificationStatus.bind(participantsRepository);

