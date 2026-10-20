/**
 * US-018 / #170 Real Postgres application model integration tests.
 *
 * Covers message length, Pending+slot CHECK, duplicate pending-per-team unique,
 * 3 pending-per-event quota via submit_team_application, and owner alerts.
 * Gated by: process.env.RUN_DB_INTEGRATION === '1' against local Supabase only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './client.js';
import { config } from '../config/index.js';
import {
  APPLICATION_MESSAGE_MAX_LENGTH,
  MAX_PENDING_APPLICATIONS_PER_EVENT,
} from './applicationModel.js';

const isGated = process.env.RUN_DB_INTEGRATION !== '1';

if (isGated) {
  console.info(
    '[SKIP] Application model DB integration tests skipped: set RUN_DB_INTEGRATION=1 against local Supabase to execute.'
  );
}

describe.skipIf(isGated)('US-018 Application Model Postgres Suite (#170)', () => {
  let supabase: SupabaseClient;
  const RUN_ID = crypto.randomUUID().slice(0, 8);
  const PREFIX = `us018-m-${RUN_ID}`;

  beforeAll(async () => {
    const rawUrl = process.env.SUPABASE_URL || config.supabase?.url || '';
    if (!rawUrl) {
      throw new Error('Missing SUPABASE_URL for real DB integration test.');
    }
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error(
        `Refusing to execute real DB integration tests on non-local host: ${parsed.hostname}`
      );
    }
    supabase = getSupabaseClient();
  });

  afterAll(async () => {
    if (!supabase) return;
    try {
      await supabase.from('participant_notifications').delete().like('message', `%${PREFIX}%`);
      const { data: teams } = await supabase.from('teams').select('id').like('name', `%${PREFIX}%`);
      const teamIds = (teams || []).map((t) => t.id);
      if (teamIds.length > 0) {
        await supabase.from('team_requests').delete().in('team_id', teamIds);
        await supabase.from('team_memberships').delete().in('team_id', teamIds);
        await supabase.from('team_vacancies').delete().in('team_id', teamIds);
        await supabase.from('teams').delete().in('id', teamIds);
      }
      await supabase.from('events').delete().like('normalized_url', `%${PREFIX}%`);
      await supabase.from('participants').delete().like('firebase_uid', `%${PREFIX}%`);
    } catch (cleanupErr) {
      console.warn('[CLEANUP WARN] application model teardown failed:', cleanupErr);
    }
  });

  async function createParticipant(label: string) {
    const uid = `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase
      .from('participants')
      .insert({
        firebase_uid: uid,
        email: `${uid}@example.com`,
        full_name: `App Model ${label}`,
        role: 'PART',
        is_verified: true,
        is_suspended: false,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function createEvent(label: string) {
    const key = `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase
      .from('events')
      .insert({
        title: `Event ${key}`,
        official_url: `https://example.com/${key}`,
        normalized_url: `https://example.com/${key}`,
        format: 'Online',
        min_team_size: 1,
        max_team_size: 4,
        status: 'Published',
        start_date: new Date(Date.now() - 3600000).toISOString(),
        end_date: new Date(Date.now() + 86400000 * 14).toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function createTeamWithVacancy(ownerId: string, eventId: string, label: string) {
    const { data: created, error: createErr } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: ownerId,
      p_event_id: eventId,
      p_name: `${PREFIX} ${label}`,
      p_pitch: `Pitch for ${PREFIX} ${label}`,
      p_goal: 'Learning',
      p_commitment_hours: 10,
      p_communication_link: null,
    });
    if (createErr) throw createErr;
    const teamId = (created as { team: { id: string } }).team.id;

    const { data: vacancy, error: vacErr } = await supabase.rpc('add_team_vacancy', {
      p_actor: ownerId,
      p_team: teamId,
      p_role: 'Frontend',
      p_skills: ['React'],
    });
    if (vacErr) throw vacErr;
    const vacancyId = (vacancy as { vacancy: { id: string } }).vacancy.id;
    return { teamId, vacancyId };
  }

  it('rejects Pending Application without vacancy_id (preserves no partial row)', async () => {
    const owner = await createParticipant('slot-owner');
    const applicant = await createParticipant('slot-app');
    const event = await createEvent('slot-event');
    const { teamId } = await createTeamWithVacancy(owner.id, event.id, 'Slot Team');

    const { error } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: null,
      participant_id: applicant.id,
      request_type: 'Application',
      status: 'Pending',
      expires_at: null,
      message: `${PREFIX} no vacancy`,
    });

    expect(error).toBeTruthy();
    const { data: rows } = await supabase
      .from('team_requests')
      .select('id')
      .eq('team_id', teamId)
      .eq('participant_id', applicant.id)
      .eq('request_type', 'Application');
    expect(rows ?? []).toHaveLength(0);
  });

  it('rejects Application message longer than 250 characters', async () => {
    const owner = await createParticipant('msg-owner');
    const applicant = await createParticipant('msg-app');
    const event = await createEvent('msg-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Msg Team');

    const { error } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: applicant.id,
      request_type: 'Application',
      status: 'Pending',
      expires_at: null,
      message: 'x'.repeat(APPLICATION_MESSAGE_MAX_LENGTH + 1),
    });

    expect(error).toBeTruthy();
  });

  it('enforces one Pending Application per applicant/team (FR-053)', async () => {
    const owner = await createParticipant('dup-owner');
    const applicant = await createParticipant('dup-app');
    const event = await createEvent('dup-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Dup Team');

    const { error: firstErr } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: applicant.id,
      request_type: 'Application',
      status: 'Pending',
      expires_at: null,
      message: `${PREFIX} first`,
    });
    expect(firstErr).toBeNull();

    const { error: dupErr } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: applicant.id,
      request_type: 'Application',
      status: 'Pending',
      expires_at: null,
      message: `${PREFIX} second`,
    });
    expect(dupErr?.code).toBe('23505');
  });

  it('allows multiple Pending Applications to the same open slot from different applicants', async () => {
    const owner = await createParticipant('multi-owner');
    const applicantA = await createParticipant('multi-a');
    const applicantB = await createParticipant('multi-b');
    const event = await createEvent('multi-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Multi Team');

    const { error: aErr } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: applicantA.id,
      request_type: 'Application',
      status: 'Pending',
      expires_at: null,
    });
    const { error: bErr } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: applicantB.id,
      request_type: 'Application',
      status: 'Pending',
      expires_at: null,
    });

    expect(aErr).toBeNull();
    expect(bErr).toBeNull();
  });

  it('submit_team_application creates Pending Review row, stores message, alerts owner', async () => {
    const owner = await createParticipant('sub-owner');
    const applicant = await createParticipant('sub-app');
    const event = await createEvent('sub-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Submit Team');
    const pitch = `${PREFIX} interested in Frontend`;

    const { data, error } = await supabase.rpc('submit_team_application', {
      p_actor: applicant.id,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_message: pitch,
    });

    expect(error).toBeNull();
    expect(data.application.status).toBe('Pending');
    expect(data.application.request_type).toBe('Application');
    expect(data.application.vacancy_id).toBe(vacancyId);
    expect(data.application.expires_at).toBeNull();
    expect(data.application.message).toBe(pitch);
    expect(data.pendingCountForEvent).toBe(1);
    expect(data.notice).toMatch(/Pending Review/i);

    const { data: alerts } = await supabase
      .from('participant_notifications')
      .select('*')
      .eq('participant_id', owner.id)
      .eq('type', 'team_application_submitted')
      .like('message', `%${PREFIX}%`);
    expect((alerts ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('blocks a 4th Pending Application in the same event while other events remain separate (FR-054)', async () => {
    const applicant = await createParticipant('lim-app');
    const eventA = await createEvent('lim-a');
    const eventB = await createEvent('lim-b');

    // Distinct owners — one confirmed team ownership per participant per event
    const teamsA = [];
    for (let i = 0; i < MAX_PENDING_APPLICATIONS_PER_EVENT; i++) {
      const owner = await createParticipant(`lim-a-owner-${i}`);
      teamsA.push(await createTeamWithVacancy(owner.id, eventA.id, `Lim A${i}`));
    }
    const ownerB = await createParticipant('lim-b-owner');
    const teamB = await createTeamWithVacancy(ownerB.id, eventB.id, 'Lim B');

    for (const t of teamsA) {
      const { error } = await supabase.rpc('submit_team_application', {
        p_actor: applicant.id,
        p_team: t.teamId,
        p_vacancy: t.vacancyId,
        p_message: null,
      });
      expect(error).toBeNull();
    }

    // When both rules apply, the same-team conflict is the actionable cause.
    const { error: duplicateAtLimitErr } = await supabase.rpc('submit_team_application', {
      p_actor: applicant.id,
      p_team: teamsA[0].teamId,
      p_vacancy: teamsA[0].vacancyId,
      p_message: null,
    });
    expect(duplicateAtLimitErr).toBeTruthy();
    expect(String(duplicateAtLimitErr?.message || '')).toMatch(
      /DUPLICATE_PENDING_APPLICATION/i
    );
    expect(String(duplicateAtLimitErr?.details || '')).toContain(teamsA[0].teamId);

    const ownerFourth = await createParticipant('lim-a-owner-4');
    const fourth = await createTeamWithVacancy(ownerFourth.id, eventA.id, 'Lim A4');
    const { error: fourthErr } = await supabase.rpc('submit_team_application', {
      p_actor: applicant.id,
      p_team: fourth.teamId,
      p_vacancy: fourth.vacancyId,
      p_message: null,
    });
    expect(fourthErr).toBeTruthy();
    expect(String(fourthErr?.message || '')).toMatch(/APPLICATION_PENDING_LIMIT/i);

    const { data: otherEvent, error: otherErr } = await supabase.rpc('submit_team_application', {
      p_actor: applicant.id,
      p_team: teamB.teamId,
      p_vacancy: teamB.vacancyId,
      p_message: `${PREFIX} other event ok`,
    });
    expect(otherErr).toBeNull();
    expect(otherEvent.application.status).toBe('Pending');
    expect(otherEvent.application.event_id).toBe(eventB.id);
  });

  it('rejects duplicate pending application via submit RPC (FR-053)', async () => {
    const owner = await createParticipant('rpc-dup-owner');
    const applicant = await createParticipant('rpc-dup-app');
    const event = await createEvent('rpc-dup-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Rpc Dup');

    const { error: firstErr } = await supabase.rpc('submit_team_application', {
      p_actor: applicant.id,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_message: 'first',
    });
    expect(firstErr).toBeNull();

    const { error: dupErr } = await supabase.rpc('submit_team_application', {
      p_actor: applicant.id,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_message: 'again',
    });
    expect(dupErr).toBeTruthy();
    expect(String(dupErr?.message || '')).toMatch(/DUPLICATE_PENDING_APPLICATION/i);
  });
});
