import { getSupabaseClient } from '../db/client.js';
import type {
  AvailabilityRole,
  AvailabilityGoal,
} from '../validators/availability.validator.js';
import { PLATFORM_AVAILABILITY_EVENT_ID } from '../validators/availability.validator.js';

export interface PlatformAvailabilityRow {
  participant_id: string;
  event_id: string;
  is_looking: boolean;
  desired_role: AvailabilityRole | null;
  commitment_hours: number | string | null;
  goal: AvailabilityGoal | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformAvailabilityRecord {
  participantId: string;
  isLooking: boolean;
  desiredRole: AvailabilityRole | null;
  commitmentHours: number | null;
  goal: AvailabilityGoal | null;
  updatedAt: string | null;
}

export interface UpsertPlatformAvailabilityValues {
  isLooking: boolean;
  desiredRole: AvailabilityRole | null;
  commitmentHours: number | null;
  goal: AvailabilityGoal | null;
}

export interface IAvailabilityRepository {
  findByParticipantId(participantId: string): Promise<PlatformAvailabilityRecord | null>;
  upsertByParticipantId(
    participantId: string,
    values: UpsertPlatformAvailabilityValues
  ): Promise<PlatformAvailabilityRecord>;
  findAllActiveLooking(): Promise<PlatformAvailabilityRecord[]>;
  clearLookingForTeamStatus(participantId: string): Promise<boolean>;
}

function toRecord(row: {
  participant_id: string;
  is_looking: boolean;
  desired_role?: string | null;
  commitment_hours?: number | string | null;
  goal?: string | null;
  updated_at?: string | null;
}): PlatformAvailabilityRecord {
  return {
    participantId: row.participant_id,
    isLooking: Boolean(row.is_looking),
    desiredRole: (row.desired_role as AvailabilityRole) ?? null,
    commitmentHours:
      row.commitment_hours !== null && row.commitment_hours !== undefined
        ? Number(row.commitment_hours)
        : null,
    goal: (row.goal as AvailabilityGoal) ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export const availabilityRepository: IAvailabilityRepository = {
  async findByParticipantId(participantId: string): Promise<PlatformAvailabilityRecord | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('event_availability')
      .select('*')
      .eq('participant_id', participantId)
      .eq('event_id', PLATFORM_AVAILABILITY_EVENT_ID)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return toRecord(data);
  },

  async upsertByParticipantId(
    participantId: string,
    values: UpsertPlatformAvailabilityValues
  ): Promise<PlatformAvailabilityRecord> {
    const client = getSupabaseClient();
    const now = new Date().toISOString();

    const { data, error } = await client
      .from('event_availability')
      .upsert(
        {
          participant_id: participantId,
          event_id: PLATFORM_AVAILABILITY_EVENT_ID,
          is_looking: values.isLooking,
          desired_role: values.desiredRole,
          commitment_hours: values.commitmentHours,
          goal: values.goal,
          updated_at: now,
        },
        { onConflict: 'participant_id,event_id' }
      )
      .select('*')
      .single();

    if (error) throw error;
    return toRecord(data);
  },

  async findAllActiveLooking(): Promise<PlatformAvailabilityRecord[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('event_availability')
      .select('*')
      .eq('event_id', PLATFORM_AVAILABILITY_EVENT_ID)
      .eq('is_looking', true)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    if (!data) return [];

    return data.map(toRecord);
  },

  async clearLookingForTeamStatus(participantId: string): Promise<boolean> {
    const client = getSupabaseClient();
    const now = new Date().toISOString();

    const { data, error } = await client
      .from('event_availability')
      .update({
        is_looking: false,
        updated_at: now,
      })
      .eq('participant_id', participantId)
      .eq('is_looking', true)
      .select('participant_id');

    if (error) throw error;
    return Boolean(data && data.length > 0);
  },
};
