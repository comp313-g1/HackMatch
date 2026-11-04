/**
 * US-021 / #204 Real Postgres notification CREATION and READING through the
 * genuine lifecycle functions (no hand-inserted rows):
 *   invite -> invitee alert, apply -> owner alert, approve -> applicant alert,
 *   lock -> alert for every confirmed member, then read via the repository.
 *
 * Gated by: process.env.RUN_DB_INTEGRATION === '1' against local Supabase only.
 * The same scenario was also executed against a real Postgres engine (all
 * migrations applied) while authoring this task.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './client.js';
import { config } from '../config/index.js';
import { notificationsRepository } from './notifications.repository.js';

const isGated = process.env.RUN_DB_INTEGRATION !== '1';

if (isGated) {
  console.info(
    '[SKIP] Notification lifecycle DB integration tests skipped: set RUN_DB_INTEGRATION=1 against local Supabase to execute.'
  );
}

const PLATFORM_POOL_EVENT_ID = '00000000-0000-4000-8000-000000000001';

describe.skipIf(isGated)('US-021 Notification creation + reading via lifecycle functions (#204)', () => {
  let supabase: SupabaseClient;
  const RUN_ID = crypto.randomUUID().slice(0, 8);
  const PREFIX = `us021-l-${RUN_ID}`;

  beforeAll(() => {
    const rawUrl = process.env.SUPABASE_URL || config.supabase?.url || '';
    if (!rawUrl) throw new Error('Missing SUPABASE_URL for real DB integration test.');
    const host = new URL(rawUrl).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`Refusing to execute real DB integration tests on non-local host: ${host}`);
    }
    supabase = getSupabaseClient();
  });

  afterAll(async () => {
    if (!supabase) return;
    try {
      await supabase.from('participant_notifications').delete().like('message', `%${PREFIX}%`);
      const { data: teams } = await supabase.from('teams').select('id').like('name', `%${PREFIX}%`);
      const teamIds = (teams ?? []).map((t) => t.id as string);
      if (teamIds.length > 0) {
        await supabase.from('team_requests').delete().in('team_id', teamIds);
        await supabase.from('team_memberships').delete().in('team_id', teamIds);
        await supabase.from('team_vacancies').delete().in('team_id', teamIds);
        await supabase.from('teams').delete().in('id', teamIds);
      }
      await supabase.from('events').delete().like('normalized_url', `%${PREFIX}%`);
      await supabase.from('participants').delete().like('firebase_uid', `%${PREFIX}%`);
    } catch (cleanupErr) {
      console.warn('[CLEANUP WARN] notification lifecycle teardown failed:', cleanupErr);
    }
  });

  async function participant(label: string): Promise<string> {
    const uid = `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase
      .from('participants')
      .insert({
        firebase_uid: uid,
        email: `${uid}@example.com`,
        full_name: `Lifecycle ${label}`,
        role: 'PART',
        is_verified: true,
        is_suspended: false,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function lookingForTeam(participantId: string) {
    const { error } = await supabase.from('event_availability').upsert({
      participant_id: participantId,
      event_id: PLATFORM_POOL_EVENT_ID,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });
    if (error) throw error;
  }

  async function scenario() {
    const owner = await participant('owner');
    const invitee = await participant('invitee');
    const applicant = await participant('applicant');
    const bystander = await participant('bystander');

    const key = `${PREFIX}-${crypto.randomUUID().slice(0, 6)}`;
    const { data: event, error: eventErr } = await supabase
      .from('events')
      .insert({
        title: `Event ${key}`,
        official_url: `https://example.com/${key}`,
        normalized_url: `https://example.com/${key}`,
        format: 'Online',
        min_team_size: 1,
        max_team_size: 4,
        status: 'Published',
        start_date: new Date(Date.now() - 3_600_000).toISOString(),
        end_date: new Date(Date.now() + 86_400_000 * 14).toISOString(),
      })
      .select('id')
      .single();
    if (eventErr) throw eventErr;

    const { data: created, error: createErr } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner,
      p_event_id: event.id,
      p_name: `${PREFIX} Team`,
      p_pitch: `Pitch ${PREFIX}`,
      p_goal: 'Learning',
      p_commitment_hours: 10,
      p_communication_link: null,
    });
    if (createErr) throw createErr;
    const teamId = (created as { team: { id: string } }).team.id;

    const vacancy = async () => {
      const { data, error } = await supabase.rpc('add_team_vacancy', {
        p_actor: owner,
        p_team: teamId,
        p_role: 'Frontend',
        p_skills: ['React'],
      });
      if (error) throw error;
      return (data as { vacancy: { id: string } }).vacancy.id;
    };

    return { owner, invitee, applicant, bystander, eventId: event.id as string, teamId, vacancy };
  }

  it('invitation creates an invitation-category alert for the invitee only', async () => {
    const s = await scenario();
    await lookingForTeam(s.invitee);
    const { error } = await supabase.rpc('issue_team_invitation', {
      p_actor: s.owner,
      p_team: s.teamId,
      p_vacancy: await s.vacancy(),
      p_invitee: s.invitee,
    });
    expect(error).toBeNull();

    const inbox = await notificationsRepository.listForParticipant(s.invitee, { limit: 10 });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      type: 'team_invitation',
      category: 'invitation',
      team_id: s.teamId,
      event_id: s.eventId,
      read_at: null,
    });
    expect(await notificationsRepository.listForParticipant(s.owner, { limit: 10 })).toHaveLength(0);
    expect(await notificationsRepository.listForParticipant(s.bystander, { limit: 10 })).toHaveLength(0);
    expect(await notificationsRepository.countUnread(s.invitee)).toBe(1);
  });

  it('application -> owner alert; approval -> applicant decision alert; lock -> roster alerts', async () => {
    const s = await scenario();
    await lookingForTeam(s.applicant);

    const { error: applyErr } = await supabase.rpc('submit_team_application', {
      p_actor: s.applicant,
      p_team: s.teamId,
      p_vacancy: await s.vacancy(),
      p_message: `pick me ${PREFIX}`,
    });
    expect(applyErr).toBeNull();

    const ownerInbox = await notificationsRepository.listForParticipant(s.owner, { limit: 10 });
    expect(ownerInbox.map((n) => [n.type, n.category])).toContainEqual([
      'team_application_submitted',
      'application',
    ]);

    const { data: request } = await supabase
      .from('team_requests')
      .select('id')
      .eq('participant_id', s.applicant)
      .eq('request_type', 'Application')
      .single();
    const { error: approveErr } = await supabase.rpc('approve_team_application', {
      p_actor: s.owner,
      p_application: request!.id,
    });
    expect(approveErr).toBeNull();

    const applicantInbox = await notificationsRepository.listForParticipant(s.applicant, { limit: 10 });
    expect(applicantInbox.map((n) => [n.type, n.category])).toContainEqual([
      'team_application_approved',
      'decision',
    ]);

    const { error: lockErr } = await supabase.rpc('lock_team', { p_actor: s.owner, p_team: s.teamId });
    expect(lockErr).toBeNull();
    for (const member of [s.owner, s.applicant]) {
      const inbox = await notificationsRepository.listForParticipant(member, { limit: 20 });
      expect(inbox.map((n) => [n.type, n.category])).toContainEqual(['TEAM_ROSTER_LOCKED', 'roster']);
    }
    expect(await notificationsRepository.listForParticipant(s.bystander, { limit: 10 })).toHaveLength(0);
  });

  it('reading lifecycle alerts: mark one, isolation, mark all, repeat', async () => {
    const s = await scenario();
    await lookingForTeam(s.invitee);
    await supabase.rpc('issue_team_invitation', {
      p_actor: s.owner,
      p_team: s.teamId,
      p_vacancy: await s.vacancy(),
      p_invitee: s.invitee,
    });
    const [alert] = await notificationsRepository.listForParticipant(s.invitee, { limit: 10 });

    // Another participant cannot read or mark it, and it stays unread.
    await expect(notificationsRepository.markRead(s.bystander, alert.id)).rejects.toMatchObject({
      message: expect.stringContaining('NOTIFICATION_NOT_FOUND'),
    });
    expect(await notificationsRepository.countUnread(s.invitee)).toBe(1);

    const first = await notificationsRepository.markRead(s.invitee, alert.id);
    expect(first).toMatchObject({ alreadyRead: false, unreadCount: 0 });
    const again = await notificationsRepository.markRead(s.invitee, alert.id);
    expect(again.alreadyRead).toBe(true);
    expect(again.notification.read_at).toBe(first.notification.read_at);

    expect(await notificationsRepository.markAllRead(s.invitee)).toEqual({ markedCount: 0, unreadCount: 0 });
    const unreadOnly = await notificationsRepository.listForParticipant(s.invitee, {
      limit: 10,
      unreadOnly: true,
    });
    expect(unreadOnly).toHaveLength(0);
  });
});
