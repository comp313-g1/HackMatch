/**
 * US-017 / US-019 Real Postgres invitation model and acceptance integration tests.
 *
 * Covers Pending/status/expiry constraints, quota indexes, and expiry helpers.
 * Gated by: process.env.RUN_DB_INTEGRATION === '1' against local Supabase only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './client.js';
import { config } from '../config/index.js';
import { INVITATION_TTL_HOURS } from './invitationModel.js';

const isGated = process.env.RUN_DB_INTEGRATION !== '1';

if (isGated) {
  console.info(
    '[SKIP] Invitation model DB integration tests skipped: set RUN_DB_INTEGRATION=1 against local Supabase to execute.'
  );
}

describe.skipIf(isGated)('US-017 Invitation Model Postgres Suite (#161)', () => {
  let supabase: SupabaseClient;
  const RUN_ID = crypto.randomUUID().slice(0, 8);
  const PREFIX = `us017-m-${RUN_ID}`;

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
      console.warn('[CLEANUP WARN] invitation model teardown failed:', cleanupErr);
    }
  });

  async function createParticipant(label: string) {
    const uid = `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase
      .from('participants')
      .insert({
        firebase_uid: uid,
        email: `${uid}@example.com`,
        full_name: `Invite Model ${label}`,
        role: 'PART',
        is_verified: true,
        is_suspended: false,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function createEvent(label: string, maxTeamSize: number = 4) {
    const key = `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase
      .from('events')
      .insert({
        title: `Event ${key}`,
        official_url: `https://example.com/${key}`,
        normalized_url: `https://example.com/${key}`,
        format: 'Online',
        min_team_size: 1,
        max_team_size: maxTeamSize,
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

  it('rejects Pending Invitation without expires_at (preserves no partial row)', async () => {
    const owner = await createParticipant('exp-owner');
    const invitee = await createParticipant('exp-invitee');
    const event = await createEvent('exp-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Exp Team');

    const { error } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: invitee.id,
      request_type: 'Invitation',
      status: 'Pending',
      expires_at: null,
    });

    expect(error).toBeTruthy();
    const { data: rows } = await supabase
      .from('team_requests')
      .select('id')
      .eq('team_id', teamId)
      .eq('participant_id', invitee.id);
    expect(rows ?? []).toHaveLength(0);
  });

  it('rejects Pending Invitation without vacancy_id', async () => {
    const owner = await createParticipant('slot-owner');
    const invitee = await createParticipant('slot-invitee');
    const event = await createEvent('slot-event');
    const { teamId } = await createTeamWithVacancy(owner.id, event.id, 'Slot Team');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3600 * 1000).toISOString();

    const { error } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: null,
      participant_id: invitee.id,
      request_type: 'Invitation',
      status: 'Pending',
      expires_at: expiresAt,
    });

    expect(error).toBeTruthy();
  });

  it('enforces one Pending invitation per invitee/team and per vacancy slot', async () => {
    const owner = await createParticipant('quota-owner');
    const inviteeA = await createParticipant('quota-a');
    const inviteeB = await createParticipant('quota-b');
    const event = await createEvent('quota-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Quota Team');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3600 * 1000).toISOString();

    const { error: firstErr } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: inviteeA.id,
      request_type: 'Invitation',
      status: 'Pending',
      expires_at: expiresAt,
    });
    expect(firstErr).toBeNull();

    const { error: dupInviteeErr } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: inviteeA.id,
      request_type: 'Invitation',
      status: 'Pending',
      expires_at: expiresAt,
    });
    expect(dupInviteeErr?.code).toBe('23505');

    const { error: dupSlotErr } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: inviteeB.id,
      request_type: 'Invitation',
      status: 'Pending',
      expires_at: expiresAt,
    });
    expect(dupSlotErr?.code).toBe('23505');
  });

  it('marks due Pending invitations Expired and reports invalid for acceptance (FR-051)', async () => {
    const owner = await createParticipant('ttl-owner');
    const invitee = await createParticipant('ttl-invitee');
    const event = await createEvent('ttl-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'TTL Team');

    const pastExpiry = new Date(Date.now() - 60_000).toISOString();
    const { data: inserted, error: insertErr } = await supabase
      .from('team_requests')
      .insert({
        team_id: teamId,
        event_id: event.id,
        vacancy_id: vacancyId,
        participant_id: invitee.id,
        request_type: 'Invitation',
        status: 'Pending',
        expires_at: pastExpiry,
      })
      .select()
      .single();
    expect(insertErr).toBeNull();
    expect(inserted).toBeTruthy();

    const { data: validBefore, error: validBeforeErr } = await supabase.rpc(
      'team_invitation_is_currently_valid',
      { p_invitation: inserted!.id }
    );
    expect(validBeforeErr).toBeNull();
    expect(validBefore).toBe(false);

    const { data: markResult, error: markErr } = await supabase.rpc(
      'mark_team_invitation_expired_if_due',
      { p_invitation: inserted!.id }
    );
    expect(markErr).toBeNull();
    expect(markResult).toMatchObject({ changed: true });
    expect(markResult.invitation.status).toBe('Expired');
    expect(markResult.invitation.resolved_at).toBeTruthy();

    const { data: batch } = await supabase.rpc('expire_due_team_invitations', { p_limit: 10 });
    expect(batch).toMatchObject({ expiredCount: expect.any(Number) });
  });

  it('issue_team_invitation creates Pending row with ~48h expires_at', async () => {
    const owner = await createParticipant('issue-owner');
    const invitee = await createParticipant('issue-invitee');
    const event = await createEvent('issue-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Issue Team');

    // Looking-for-Team on platform pool
    const platformEventId = '00000000-0000-4000-8000-000000000001';
    await supabase.from('event_availability').upsert({
      participant_id: invitee.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });

    const before = Date.now();
    const { data, error } = await supabase.rpc('issue_team_invitation', {
      p_actor: owner.id,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_invitee: invitee.id,
    });
    expect(error).toBeNull();
    expect(data.invitation.status).toBe('Pending');
    expect(data.invitation.request_type).toBe('Invitation');
    expect(data.invitation.vacancy_id).toBe(vacancyId);
    expect(data.invitation.expires_at).toBeTruthy();

    const expiresMs = Date.parse(data.expiresAt || data.invitation.expires_at);
    const expectedMin = before + (INVITATION_TTL_HOURS * 3600 * 1000) - 5000;
    const expectedMax = before + (INVITATION_TTL_HOURS * 3600 * 1000) + 60_000;
    expect(expiresMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresMs).toBeLessThanOrEqual(expectedMax);

    const { data: isValid } = await supabase.rpc('team_invitation_is_currently_valid', {
      p_invitation: data.invitation.id,
    });
    expect(isValid).toBe(true);
  });

  it('declines only the addressed invitation, preserves roster state, and alerts the owner once (#182)', async () => {
    const owner = await createParticipant('decline-owner');
    const otherOwner = await createParticipant('decline-other-owner');
    const invitee = await createParticipant('decline-invitee');
    const event = await createEvent('decline-event');
    const first = await createTeamWithVacancy(owner.id, event.id, 'Decline Team');
    const second = await createTeamWithVacancy(otherOwner.id, event.id, 'Other Offer Team');
    const platformEventId = '00000000-0000-4000-8000-000000000001';

    await supabase.from('event_availability').upsert({
      participant_id: invitee.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });

    const { data: firstIssued, error: firstIssueErr } = await supabase.rpc(
      'issue_team_invitation',
      {
        p_actor: owner.id,
        p_team: first.teamId,
        p_vacancy: first.vacancyId,
        p_invitee: invitee.id,
      }
    );
    const { data: secondIssued, error: secondIssueErr } = await supabase.rpc(
      'issue_team_invitation',
      {
        p_actor: otherOwner.id,
        p_team: second.teamId,
        p_vacancy: second.vacancyId,
        p_invitee: invitee.id,
      }
    );
    expect(firstIssueErr).toBeNull();
    expect(secondIssueErr).toBeNull();

    const { error: forbiddenErr } = await supabase.rpc('decline_team_invitation', {
      p_actor: owner.id,
      p_invitation: firstIssued.invitation.id,
    });
    expect(forbiddenErr?.message).toContain('FORBIDDEN_NOT_INVITEE');

    const { data: declined, error: declineErr } = await supabase.rpc(
      'decline_team_invitation',
      {
        p_actor: invitee.id,
        p_invitation: firstIssued.invitation.id,
      }
    );
    expect(declineErr).toBeNull();
    expect(declined).toMatchObject({
      invitation: { id: firstIssued.invitation.id, status: 'Declined' },
      changed: true,
      idempotent: false,
      effects: {
        invitationChanged: true,
        ownerAlertCreated: true,
        inviteeAlertCreated: true,
        availabilityChanged: false,
        membershipChanged: false,
        vacancyChanged: false,
      },
    });
    expect(declined.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          audience: 'owner',
          type: 'team_invitation_declined',
          notificationId: expect.any(String),
        }),
      ])
    );

    const [
      { data: firstInvitation },
      { data: secondInvitation },
      { data: firstVacancy },
      { data: memberships },
      { data: availability },
      { data: ownerAlertsBeforeRepeat },
    ] = await Promise.all([
      supabase.from('team_requests').select('status').eq('id', firstIssued.invitation.id).single(),
      supabase.from('team_requests').select('status').eq('id', secondIssued.invitation.id).single(),
      supabase.from('team_vacancies').select('status').eq('id', first.vacancyId).single(),
      supabase
        .from('team_memberships')
        .select('id')
        .eq('event_id', event.id)
        .eq('participant_id', invitee.id)
        .eq('status', 'Confirmed'),
      supabase
        .from('event_availability')
        .select('is_looking')
        .eq('event_id', platformEventId)
        .eq('participant_id', invitee.id)
        .single(),
      supabase
        .from('participant_notifications')
        .select('id')
        .eq('participant_id', owner.id)
        .eq('team_id', first.teamId)
        .eq('type', 'team_invitation_declined'),
    ]);

    expect(firstInvitation?.status).toBe('Declined');
    expect(secondInvitation?.status).toBe('Pending');
    expect(firstVacancy?.status).toBe('Open');
    expect(memberships ?? []).toHaveLength(0);
    expect(availability?.is_looking).toBe(true);
    expect(ownerAlertsBeforeRepeat ?? []).toHaveLength(1);

    const { data: repeated, error: repeatErr } = await supabase.rpc(
      'decline_team_invitation',
      {
        p_actor: invitee.id,
        p_invitation: firstIssued.invitation.id,
      }
    );
    expect(repeatErr).toBeNull();
    expect(repeated).toMatchObject({ changed: false, idempotent: true });

    const { data: ownerAlertsAfterRepeat } = await supabase
      .from('participant_notifications')
      .select('id')
      .eq('participant_id', owner.id)
      .eq('team_id', first.teamId)
      .eq('type', 'team_invitation_declined');
    expect(ownerAlertsAfterRepeat ?? []).toHaveLength(1);
  });

  it('accept_team_invitation atomically confirms membership, fills the slot, and clears availability (#180)', async () => {
    const owner = await createParticipant('accept-owner');
    const invitee = await createParticipant('accept-invitee');
    const event = await createEvent('accept-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(
      owner.id,
      event.id,
      'Accept Team'
    );
    const platformEventId = '00000000-0000-4000-8000-000000000001';
    await supabase.from('event_availability').upsert({
      participant_id: invitee.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });

    const { data: issued, error: issueErr } = await supabase.rpc('issue_team_invitation', {
      p_actor: owner.id,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_invitee: invitee.id,
    });
    expect(issueErr).toBeNull();

    const { data: accepted, error: acceptErr } = await supabase.rpc(
      'accept_team_invitation',
      {
        p_actor: invitee.id,
        p_invitation: issued.invitation.id,
      }
    );

    expect(acceptErr).toBeNull();
    expect(accepted).toMatchObject({
      accepted: true,
      invitation: { status: 'Accepted' },
      membership: {
        team_id: teamId,
        event_id: event.id,
        participant_id: invitee.id,
        role: 'Member',
        status: 'Confirmed',
      },
      vacancy: { id: vacancyId, status: 'Filled' },
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
    });

    const [{ data: membership }, { data: vacancy }, { data: invitation }, { data: availability }] =
      await Promise.all([
        supabase
          .from('team_memberships')
          .select('status, role')
          .eq('team_id', teamId)
          .eq('participant_id', invitee.id)
          .single(),
        supabase.from('team_vacancies').select('status').eq('id', vacancyId).single(),
        supabase
          .from('team_requests')
          .select('status')
          .eq('id', issued.invitation.id)
          .single(),
        supabase
          .from('event_availability')
          .select('is_looking')
          .eq('participant_id', invitee.id)
          .eq('event_id', platformEventId)
          .single(),
      ]);

    expect(membership).toEqual({ status: 'Confirmed', role: 'Member' });
    expect(vacancy?.status).toBe('Filled');
    expect(invitation?.status).toBe('Accepted');
    expect(availability?.is_looking).toBe(false);
  });

  it('rejects acceptance at capacity without partial membership, slot, or invitation writes (#180)', async () => {
    const owner = await createParticipant('full-owner');
    const invitee = await createParticipant('full-invitee');
    const filler = await createParticipant('full-filler');
    const event = await createEvent('full-event', 2);
    const { teamId, vacancyId } = await createTeamWithVacancy(
      owner.id,
      event.id,
      'Full Team'
    );
    const platformEventId = '00000000-0000-4000-8000-000000000001';
    await supabase.from('event_availability').upsert({
      participant_id: invitee.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });

    const { data: issued, error: issueErr } = await supabase.rpc('issue_team_invitation', {
      p_actor: owner.id,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_invitee: invitee.id,
    });
    expect(issueErr).toBeNull();

    const { error: fillerErr } = await supabase.from('team_memberships').insert({
      team_id: teamId,
      event_id: event.id,
      participant_id: filler.id,
      role: 'Member',
      status: 'Confirmed',
    });
    expect(fillerErr).toBeNull();

    const { error: acceptErr } = await supabase.rpc('accept_team_invitation', {
      p_actor: invitee.id,
      p_invitation: issued.invitation.id,
    });
    expect(acceptErr?.message).toContain('CAPACITY_EXCEEDED');

    const [{ data: memberships }, { data: vacancy }, { data: invitation }, { data: availability }] =
      await Promise.all([
        supabase
          .from('team_memberships')
          .select('id')
          .eq('team_id', teamId)
          .eq('participant_id', invitee.id)
          .eq('status', 'Confirmed'),
        supabase.from('team_vacancies').select('status').eq('id', vacancyId).single(),
        supabase
          .from('team_requests')
          .select('status')
          .eq('id', issued.invitation.id)
          .single(),
        supabase
          .from('event_availability')
          .select('is_looking')
          .eq('participant_id', invitee.id)
          .eq('event_id', platformEventId)
          .single(),
      ]);

    expect(memberships ?? []).toHaveLength(0);
    expect(vacancy?.status).toBe('Open');
    expect(invitation?.status).toBe('Pending');
    expect(availability?.is_looking).toBe(true);
  });

  it('US-019-T3: rejects acceptance on a locked team without partial writes (#186)', async () => {
    const owner = await createParticipant('lock-owner');
    const invitee = await createParticipant('lock-invitee');
    const event = await createEvent('lock-event');
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Locked Team');
    const platformEventId = '00000000-0000-4000-8000-000000000001';

    await supabase.from('event_availability').upsert({
      participant_id: invitee.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });

    const { data: issued, error: issueErr } = await supabase.rpc('issue_team_invitation', {
      p_actor: owner.id,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_invitee: invitee.id,
    });
    expect(issueErr).toBeNull();

    const { error: lockErr } = await supabase
      .from('teams')
      .update({ recruitment_status: 'Locked' })
      .eq('id', teamId);
    expect(lockErr).toBeNull();

    const { error: acceptErr } = await supabase.rpc('accept_team_invitation', {
      p_actor: invitee.id,
      p_invitation: issued.invitation.id,
    });
    expect(acceptErr?.message).toMatch(/TEAM_NOT_MUTABLE/);

    const [{ data: memberships }, { data: vacancy }, { data: invitation }, { data: availability }] =
      await Promise.all([
        supabase
          .from('team_memberships')
          .select('id')
          .eq('team_id', teamId)
          .eq('participant_id', invitee.id)
          .eq('status', 'Confirmed'),
        supabase.from('team_vacancies').select('status').eq('id', vacancyId).single(),
        supabase.from('team_requests').select('status').eq('id', issued.invitation.id).single(),
        supabase
          .from('event_availability')
          .select('is_looking')
          .eq('participant_id', invitee.id)
          .eq('event_id', platformEventId)
          .single(),
      ]);

    expect(memberships ?? []).toHaveLength(0);
    expect(vacancy?.status).toBe('Open');
    expect(invitation?.status).toBe('Pending');
    expect(availability?.is_looking).toBe(true);
  });

  it('US-019-T4: concurrent accepts for the same PART yield one membership and one conflict (#186)', async () => {
    const ownerA = await createParticipant('race-owner-a');
    const ownerB = await createParticipant('race-owner-b');
    const invitee = await createParticipant('race-invitee');
    const event = await createEvent('race-event');
    const teamA = await createTeamWithVacancy(ownerA.id, event.id, 'Race Team A');
    const teamB = await createTeamWithVacancy(ownerB.id, event.id, 'Race Team B');
    const platformEventId = '00000000-0000-4000-8000-000000000001';

    await supabase.from('event_availability').upsert({
      participant_id: invitee.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });

    const { data: issuedA, error: issueAErr } = await supabase.rpc('issue_team_invitation', {
      p_actor: ownerA.id,
      p_team: teamA.teamId,
      p_vacancy: teamA.vacancyId,
      p_invitee: invitee.id,
    });
    const { data: issuedB, error: issueBErr } = await supabase.rpc('issue_team_invitation', {
      p_actor: ownerB.id,
      p_team: teamB.teamId,
      p_vacancy: teamB.vacancyId,
      p_invitee: invitee.id,
    });
    expect(issueAErr).toBeNull();
    expect(issueBErr).toBeNull();

    const [resA, resB] = await Promise.all([
      supabase.rpc('accept_team_invitation', {
        p_actor: invitee.id,
        p_invitation: issuedA.invitation.id,
      }),
      supabase.rpc('accept_team_invitation', {
        p_actor: invitee.id,
        p_invitation: issuedB.invitation.id,
      }),
    ]);

    const successes = [resA, resB].filter((r) => r.error == null);
    const failures = [resA, resB].filter((r) => r.error != null);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error?.message).toMatch(/INVITEE_ALREADY_CONFIRMED/);

    const { data: memberships } = await supabase
      .from('team_memberships')
      .select('team_id')
      .eq('event_id', event.id)
      .eq('participant_id', invitee.id)
      .eq('status', 'Confirmed');
    expect(memberships ?? []).toHaveLength(1);

    const { data: availability } = await supabase
      .from('event_availability')
      .select('is_looking')
      .eq('participant_id', invitee.id)
      .eq('event_id', platformEventId)
      .single();
    expect(availability?.is_looking).toBe(false);
  });

  it('US-019 accept cascade cancels competing invitations and withdraws applications (#181/#186)', async () => {
    const ownerA = await createParticipant('casc-owner-a');
    const ownerB = await createParticipant('casc-owner-b');
    const invitee = await createParticipant('casc-invitee');
    const event = await createEvent('casc-event');
    const teamA = await createTeamWithVacancy(ownerA.id, event.id, 'Cascade Win');
    const teamB = await createTeamWithVacancy(ownerB.id, event.id, 'Cascade Lose');
    const platformEventId = '00000000-0000-4000-8000-000000000001';

    await supabase.from('event_availability').upsert({
      participant_id: invitee.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });

    const { data: winInvite, error: winIssueErr } = await supabase.rpc('issue_team_invitation', {
      p_actor: ownerA.id,
      p_team: teamA.teamId,
      p_vacancy: teamA.vacancyId,
      p_invitee: invitee.id,
    });
    const { data: loseInvite, error: loseIssueErr } = await supabase.rpc('issue_team_invitation', {
      p_actor: ownerB.id,
      p_team: teamB.teamId,
      p_vacancy: teamB.vacancyId,
      p_invitee: invitee.id,
    });
    expect(winIssueErr).toBeNull();
    expect(loseIssueErr).toBeNull();

    const { data: application, error: appErr } = await supabase
      .from('team_requests')
      .insert({
        team_id: teamB.teamId,
        event_id: event.id,
        vacancy_id: teamB.vacancyId,
        participant_id: invitee.id,
        request_type: 'Application',
        status: 'Pending',
        message: `${PREFIX} competing app`,
      })
      .select()
      .single();
    expect(appErr).toBeNull();

    const { data: accepted, error: acceptErr } = await supabase.rpc('accept_team_invitation', {
      p_actor: invitee.id,
      p_invitation: winInvite.invitation.id,
    });
    expect(acceptErr).toBeNull();
    expect(accepted.cascade.eventInvitationsCanceled).toBeGreaterThanOrEqual(1);
    expect(accepted.cascade.eventApplicationsWithdrawn).toBeGreaterThanOrEqual(1);

    const [{ data: loseRow }, { data: appRow }] = await Promise.all([
      supabase.from('team_requests').select('status, cancel_reason').eq('id', loseInvite.invitation.id).single(),
      supabase.from('team_requests').select('status, cancel_reason').eq('id', application!.id).single(),
    ]);
    expect(loseRow?.status).toBe('Canceled');
    expect(loseRow?.cancel_reason).toBe('EVENT_MEMBERSHIP_CONFIRMED');
    expect(appRow?.status).toBe('Withdrawn');
    expect(appRow?.cancel_reason).toBe('EVENT_MEMBERSHIP_CONFIRMED');
  });

  it('US-019-T5/T6: leave_team restores availability, alerts owner, and blocks owner leave (#183/#186)', async () => {
    const owner = await createParticipant('leave-owner');
    const member = await createParticipant('leave-member');
    const event = await createEvent('leave-event', 2);
    const { teamId, vacancyId } = await createTeamWithVacancy(owner.id, event.id, 'Leave Team');
    const platformEventId = '00000000-0000-4000-8000-000000000001';

    await supabase.from('event_availability').upsert({
      participant_id: member.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });

    const { data: issued, error: issueErr } = await supabase.rpc('issue_team_invitation', {
      p_actor: owner.id,
      p_team: teamId,
      p_vacancy: vacancyId,
      p_invitee: member.id,
    });
    expect(issueErr).toBeNull();

    const { error: acceptErr } = await supabase.rpc('accept_team_invitation', {
      p_actor: member.id,
      p_invitation: issued.invitation.id,
    });
    expect(acceptErr).toBeNull();

    const { error: ownerLeaveErr } = await supabase.rpc('leave_team', {
      p_actor: owner.id,
      p_team: teamId,
    });
    expect(ownerLeaveErr?.message).toMatch(/CANNOT_LEAVE_AS_OWNER/);

    // At capacity (max 2) — add vacancy must fail before leave
    const { error: fullErr } = await supabase.rpc('add_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_role: 'Backend',
      p_skills: ['Node.js'],
    });
    expect(fullErr?.message).toMatch(/CAPACITY_EXCEEDED/);

    const { data: left, error: leaveErr } = await supabase.rpc('leave_team', {
      p_actor: member.id,
      p_team: teamId,
    });
    expect(leaveErr).toBeNull();
    expect(left.availabilityRestored).toBe(true);

    const [
      { data: membership },
      { data: availability },
      { data: ownerAlerts },
      { data: reopenVac },
    ] = await Promise.all([
      supabase
        .from('team_memberships')
        .select('status, removal_reason')
        .eq('team_id', teamId)
        .eq('participant_id', member.id)
        .single(),
      supabase
        .from('event_availability')
        .select('is_looking')
        .eq('participant_id', member.id)
        .eq('event_id', platformEventId)
        .single(),
      supabase
        .from('participant_notifications')
        .select('type')
        .eq('participant_id', owner.id)
        .eq('team_id', teamId)
        .eq('type', 'MEMBER_LEFT'),
      supabase.rpc('add_team_vacancy', {
        p_actor: owner.id,
        p_team: teamId,
        p_role: 'Backend',
        p_skills: ['Node.js'],
      }),
    ]);

    expect(membership?.status).toBe('Removed');
    expect(membership?.removal_reason).toBe('MEMBER_LEFT');
    expect(availability?.is_looking).toBe(true);
    expect(ownerAlerts ?? []).toHaveLength(1);
    expect(reopenVac.error).toBeNull();
    expect(reopenVac.data?.vacancy?.id).toBeDefined();
  });

  it('US-019-T5: locked team rejects leave for a still-confirmed member (#186)', async () => {
    const owner = await createParticipant('llock-owner');
    const member = await createParticipant('llock-member');
    const event = await createEvent('llock-event');
    const { data: created } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Leave Lock Team`,
      p_pitch: `Pitch for ${PREFIX} leave lock`,
      p_goal: 'Learning',
      p_commitment_hours: 10,
      p_communication_link: null,
    });
    const teamId = (created as { team: { id: string } }).team.id;

    await supabase.from('team_memberships').insert({
      team_id: teamId,
      event_id: event.id,
      participant_id: member.id,
      role: 'Member',
      status: 'Confirmed',
    });

    await supabase.from('teams').update({ recruitment_status: 'Locked' }).eq('id', teamId);

    const { error: leaveErr } = await supabase.rpc('leave_team', {
      p_actor: member.id,
      p_team: teamId,
    });
    expect(leaveErr?.message).toMatch(/TEAM_NOT_MUTABLE/);

    const { data: stillConfirmed } = await supabase
      .from('team_memberships')
      .select('status')
      .eq('team_id', teamId)
      .eq('participant_id', member.id)
      .single();
    expect(stillConfirmed?.status).toBe('Confirmed');
  });

  it('serializes competing acceptances so exactly one placement wins with a clear conflict (#184)', async () => {
    const firstOwner = await createParticipant('race-owner-a');
    const secondOwner = await createParticipant('race-owner-b');
    const invitee = await createParticipant('race-invitee');
    const event = await createEvent('race-event');
    const first = await createTeamWithVacancy(firstOwner.id, event.id, 'Race Team A');
    const second = await createTeamWithVacancy(secondOwner.id, event.id, 'Race Team B');
    const platformEventId = '00000000-0000-4000-8000-000000000001';

    const { error: availabilityError } = await supabase.from('event_availability').upsert({
      participant_id: invitee.id,
      event_id: platformEventId,
      is_looking: true,
      desired_role: 'Frontend',
      commitment_hours: 10,
      goal: 'Learning',
    });
    expect(availabilityError).toBeNull();

    const [firstIssue, secondIssue] = await Promise.all([
      supabase.rpc('issue_team_invitation', {
        p_actor: firstOwner.id,
        p_team: first.teamId,
        p_vacancy: first.vacancyId,
        p_invitee: invitee.id,
      }),
      supabase.rpc('issue_team_invitation', {
        p_actor: secondOwner.id,
        p_team: second.teamId,
        p_vacancy: second.vacancyId,
        p_invitee: invitee.id,
      }),
    ]);
    expect(firstIssue.error).toBeNull();
    expect(secondIssue.error).toBeNull();

    const invitationIds = [
      firstIssue.data.invitation.id,
      secondIssue.data.invitation.id,
    ];
    const attempts = await Promise.all(
      invitationIds.map((invitationId) =>
        supabase.rpc('accept_team_invitation', {
          p_actor: invitee.id,
          p_invitation: invitationId,
        })
      )
    );

    const winners = attempts.filter((attempt) => !attempt.error);
    const losers = attempts.filter((attempt) => attempt.error);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].error?.message).toContain('INVITATION_ACCEPTANCE_CONFLICT');
    expect(losers[0].error?.details).toContain('EVENT_MEMBERSHIP_CONFIRMED');

    const [{ data: memberships }, { data: invitations }, { data: availability }] =
      await Promise.all([
        supabase
          .from('team_memberships')
          .select('id, team_id')
          .eq('event_id', event.id)
          .eq('participant_id', invitee.id)
          .eq('status', 'Confirmed'),
        supabase
          .from('team_requests')
          .select('id, status, cancel_reason')
          .in('id', invitationIds),
        supabase
          .from('event_availability')
          .select('is_looking')
          .eq('participant_id', invitee.id)
          .eq('event_id', platformEventId)
          .single(),
      ]);

    expect(memberships ?? []).toHaveLength(1);
    expect(invitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'Accepted', cancel_reason: null }),
        expect.objectContaining({
          status: 'Canceled',
          cancel_reason: 'EVENT_MEMBERSHIP_CONFIRMED',
        }),
      ])
    );
    expect(availability?.is_looking).toBe(false);
  });
});
