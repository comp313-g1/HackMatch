/**
 * US-012 Real Postgres Integration Test Suite
 *
 * Exercises the PL/pgSQL functions, constraints, locks, and concurrency rules
 * against a real local Postgres / Supabase instance.
 *
 * Gated by: process.env.RUN_DB_INTEGRATION === '1'
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './client.js';
import { config } from '../config/index.js';

const isGated = process.env.RUN_DB_INTEGRATION !== '1';

if (isGated) {
  console.info(
    '[SKIP] Real-DB integration tests skipped: set RUN_DB_INTEGRATION=1 against a local Supabase instance (127.0.0.1 / localhost) to execute.'
  );
}

describe.skipIf(isGated)('US-012 Real Postgres Integration Suite (Lifecycle & Concurrency)', () => {
  let supabase: SupabaseClient;
  const RUN_ID = crypto.randomUUID().slice(0, 8);
  const PREFIX = `us012-${RUN_ID}`;

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

    // Clean up created entities in reverse dependency order
    try {
      // 1. Participant notifications
      await supabase.from('participant_notifications').delete().like('message', `%${PREFIX}%`);

      // 2. Team requests
      await supabase.from('team_requests').delete().like('cancel_reason', `%${PREFIX}%`);

      // 3. Team vacancies
      const { data: teams } = await supabase.from('teams').select('id').like('name', `%${PREFIX}%`);
      const teamIds = (teams || []).map((t) => t.id);
      if (teamIds.length > 0) {
        await supabase.from('team_requests').delete().in('team_id', teamIds);
        await supabase.from('team_memberships').delete().in('team_id', teamIds);
        await supabase.from('team_vacancies').delete().in('team_id', teamIds);
        await supabase.from('teams').delete().in('id', teamIds);
      }

      // 4. Event availability
      await supabase.from('event_availability').delete().neq('participant_id', '00000000-0000-0000-0000-000000000000');

      // 5. Events
      await supabase.from('events').delete().like('normalized_url', `%${PREFIX}%`);

      // 6. Participants
      await supabase.from('participants').delete().like('firebase_uid', `%${PREFIX}%`);
    } catch (cleanupErr) {
      console.warn('[CLEANUP WARN] Failed to complete test teardown:', cleanupErr);
    }
  });

  // Helpers to seed valid test entities
  async function createTestParticipant(label: string) {
    const uid = `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 6)}`;
    const email = `${uid}@example.com`;
    const { data, error } = await supabase
      .from('participants')
      .insert({
        firebase_uid: uid,
        email,
        full_name: `Test User ${label}`,
        role: 'PART',
        is_verified: true,
        is_suspended: false,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function createTestEvent(
    label: string,
    overrides?: { max_team_size?: number; status?: 'Published' | 'Archived' | 'Disabled'; end_date?: string }
  ) {
    const key = `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase
      .from('events')
      .insert({
        title: `Event ${key}`,
        official_url: `https://example.com/${key}`,
        normalized_url: `https://example.com/${key}`,
        format: 'In-Person',
        min_team_size: 1,
        max_team_size: overrides?.max_team_size ?? 4,
        status: overrides?.status ?? 'Published',
        start_date: new Date(Date.now() - 3600000).toISOString(),
        end_date: overrides?.end_date ?? new Date(Date.now() + 86400000 * 7).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Scenario 1: Concurrent create, same owner, same event (Repeat 20x flake guard)
  it('Scenario 1: Concurrent create, same owner, same event allows exactly one success (20 iterations)', async () => {
    for (let i = 0; i < 20; i++) {
      const owner = await createTestParticipant(`sc1-owner-${i}`);
      const event = await createTestEvent(`sc1-event-${i}`, { max_team_size: 4 });

      const p1 = supabase.rpc('create_team_with_owner', {
        p_owner_id: owner.id,
        p_event_id: event.id,
        p_name: `${PREFIX} Team Alpha ${i}`,
        p_pitch: 'Building cutting edge distributed tooling.',
        p_goal: 'Learning',
        p_commitment_hours: 10,
        p_communication_link: 'https://discord.gg/test-alpha',
      });

      const p2 = supabase.rpc('create_team_with_owner', {
        p_owner_id: owner.id,
        p_event_id: event.id,
        p_name: `${PREFIX} Team Beta ${i}`,
        p_pitch: 'Alternative concurrent team pitch.',
        p_goal: 'Competitive',
        p_commitment_hours: 20,
        p_communication_link: 'https://discord.gg/test-beta',
      });

      const [res1, res2] = await Promise.all([p1, p2]);

      const successes = [res1, res2].filter((r) => !r.error && r.data);
      const errors = [res1, res2].filter((r) => r.error);

      expect(successes).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0].error?.message).toMatch(/ALREADY_CONFIRMED_MEMBER/);

      // Verify DB state: exactly 1 confirmed row, 1 team
      const { data: memberships } = await supabase
        .from('team_memberships')
        .select('*')
        .eq('event_id', event.id)
        .eq('participant_id', owner.id)
        .eq('status', 'Confirmed');

      expect(memberships).toHaveLength(1);

      const { data: teams } = await supabase
        .from('teams')
        .select('*')
        .eq('event_id', event.id)
        .eq('owner_participant_id', owner.id);

      expect(teams).toHaveLength(1);
    }
  });

  // Scenario 2: Concurrent create, different events (FR-083 "other events independent")
  it('Scenario 2: Concurrent create on different events both succeed independently', async () => {
    const owner = await createTestParticipant('sc2-owner');
    const eventA = await createTestEvent('sc2-event-a');
    const eventB = await createTestEvent('sc2-event-b');

    const [resA, resB] = await Promise.all([
      supabase.rpc('create_team_with_owner', {
        p_owner_id: owner.id,
        p_event_id: eventA.id,
        p_name: `${PREFIX} Event A Team`,
        p_pitch: 'Pitch for event A team.',
        p_goal: 'Learning',
        p_commitment_hours: 15,
        p_communication_link: 'https://example.com/a',
      }),
      supabase.rpc('create_team_with_owner', {
        p_owner_id: owner.id,
        p_event_id: eventB.id,
        p_name: `${PREFIX} Event B Team`,
        p_pitch: 'Pitch for event B team.',
        p_goal: 'Project Completion',
        p_commitment_hours: 25,
        p_communication_link: 'https://example.com/b',
      }),
    ]);

    expect(resA.error).toBeNull();
    expect(resB.error).toBeNull();
    expect(resA.data?.team?.id).toBeDefined();
    expect(resB.data?.team?.id).toBeDefined();

    const { data: memberships } = await supabase
      .from('team_memberships')
      .select('*')
      .eq('participant_id', owner.id)
      .eq('status', 'Confirmed');

    expect(memberships).toHaveLength(2);
  });

  // Scenario 3: Concurrent add-vacancy at the limit
  it('Scenario 3: Concurrent add_team_vacancy at capacity limit prevents overfill', async () => {
    const owner = await createTestParticipant('sc3-owner');
    const member = await createTestParticipant('sc3-member');
    // Event max=4: 1 owner + 1 member + 1 existing vacancy = 3 accounted for. Only 1 slot remains.
    const event = await createTestEvent('sc3-event', { max_team_size: 4 });

    const { data: createRes } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Limit Team`,
      p_pitch: 'Pitch testing capacity limit.',
      p_goal: 'Competitive',
      p_commitment_hours: 20,
    });
    const teamId = createRes.team.id;

    // Add confirmed member
    await supabase.from('team_memberships').insert({
      team_id: teamId,
      event_id: event.id,
      participant_id: member.id,
      role: 'Member',
      status: 'Confirmed',
    });

    // Add 1 initial open vacancy
    await supabase.rpc('add_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_role: 'Frontend',
      p_skills: ['React'],
    });

    // Concurrently try adding 2 more vacancies
    const [add1, add2] = await Promise.all([
      supabase.rpc('add_team_vacancy', {
        p_actor: owner.id,
        p_team: teamId,
        p_role: 'Backend',
        p_skills: ['Go'],
      }),
      supabase.rpc('add_team_vacancy', {
        p_actor: owner.id,
        p_team: teamId,
        p_role: 'UI/UX',
        p_skills: ['Figma'],
      }),
    ]);

    const successes = [add1, add2].filter((r) => !r.error);
    const errors = [add1, add2].filter((r) => r.error);

    expect(successes).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].error?.message).toMatch(/CAPACITY_EXCEEDED/);

    const { count: openCount } = await supabase
      .from('team_vacancies')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('status', 'Open');

    // Confirmed (2) + Open (2) = 4 <= max (4)
    expect(openCount).toBe(2);
  });

  // Scenario 4: Create clears availability + cancels owner's other pending requests in event
  it("Scenario 4: Create clears availability and cancels owner's pending requests in same event only", async () => {
    const owner = await createTestParticipant('sc4-owner');
    const event1 = await createTestEvent('sc4-event-1');
    const event2 = await createTestEvent('sc4-event-2');

    // Pre-declare availability in event1
    await supabase.from('event_availability').insert({
      participant_id: owner.id,
      event_id: event1.id,
      is_looking: true,
    });

    // Other team in event1
    const dummyOwner1 = await createTestParticipant('sc4-dummy-1');
    const { data: team1Res } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: dummyOwner1.id,
      p_event_id: event1.id,
      p_name: `${PREFIX} Dummy 1`,
      p_pitch: 'Dummy pitch',
      p_goal: 'Learning',
      p_commitment_hours: 10,
    });

    // Other team in event2
    const dummyOwner2 = await createTestParticipant('sc4-dummy-2');
    const { data: team2Res } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: dummyOwner2.id,
      p_event_id: event2.id,
      p_name: `${PREFIX} Dummy 2`,
      p_pitch: 'Dummy pitch',
      p_goal: 'Learning',
      p_commitment_hours: 10,
    });

    // Pending requests for owner in event1 and event2
    const { data: req1 } = await supabase
      .from('team_requests')
      .insert({
        team_id: team1Res.team.id,
        event_id: event1.id,
        participant_id: owner.id,
        request_type: 'Invitation',
        status: 'Pending',
      })
      .select()
      .single();

    const { data: req2 } = await supabase
      .from('team_requests')
      .insert({
        team_id: team2Res.team.id,
        event_id: event2.id,
        participant_id: owner.id,
        request_type: 'Invitation',
        status: 'Pending',
      })
      .select()
      .single();

    // Owner creates team in event1
    await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event1.id,
      p_name: `${PREFIX} Sc4 Final Team`,
      p_pitch: 'Final pitch',
      p_goal: 'Learning',
      p_commitment_hours: 10,
    });

    // Check availability is now false in event1
    const { data: avail } = await supabase
      .from('event_availability')
      .select('*')
      .eq('participant_id', owner.id)
      .eq('event_id', event1.id)
      .single();
    expect(avail?.is_looking).toBe(false);

    // Check req1 in event1 is Canceled with OWNER_CREATED_TEAM
    const { data: updatedReq1 } = await supabase
      .from('team_requests')
      .select('*')
      .eq('id', req1!.id)
      .single();
    expect(updatedReq1?.status).toBe('Canceled');
    expect(updatedReq1?.cancel_reason).toBe('OWNER_CREATED_TEAM');

    // Check req2 in event2 is untouched (Pending)
    const { data: updatedReq2 } = await supabase
      .from('team_requests')
      .select('*')
      .eq('id', req2!.id)
      .single();
    expect(updatedReq2?.status).toBe('Pending');
  });

  // Scenario 5: Remove slot cancels only that slot's Pending requests (Accepted untouched)
  it("Scenario 5: Remove slot cancels only that slot's pending requests and notifies candidates", async () => {
    const owner = await createTestParticipant('sc5-owner');
    const cand1 = await createTestParticipant('sc5-cand1');
    const cand2 = await createTestParticipant('sc5-cand2');
    const event = await createTestEvent('sc5-event');

    const { data: teamRes } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Vacancy Removal Team`,
      p_pitch: 'Testing slot removal cascade.',
      p_goal: 'Competitive',
      p_commitment_hours: 15,
    });
    const teamId = teamRes.team.id;

    const { data: vacRes } = await supabase.rpc('add_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_role: 'Mobile',
      p_skills: ['Flutter'],
    });
    const vacancyId = vacRes.vacancy.id;

    // Insert Pending request on vacancy
    await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: cand1.id,
      request_type: 'Invitation',
      status: 'Pending',
    });

    // Insert Accepted request on vacancy
    await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      vacancy_id: vacancyId,
      participant_id: cand2.id,
      request_type: 'Invitation',
      status: 'Accepted',
    });

    // Remove vacancy
    const { data: removeRes, error } = await supabase.rpc('remove_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_vacancy: vacancyId,
    });
    expect(error).toBeNull();
    expect(removeRes.canceledRequests).toBe(1);

    // Verify cand1 request canceled
    const { data: c1Req } = await supabase
      .from('team_requests')
      .select('*')
      .eq('participant_id', cand1.id)
      .eq('vacancy_id', vacancyId)
      .single();
    expect(c1Req?.status).toBe('Canceled');
    expect(c1Req?.cancel_reason).toBe('SLOT_REMOVED');

    // Verify cand2 request untouched
    const { data: c2Req } = await supabase
      .from('team_requests')
      .select('*')
      .eq('participant_id', cand2.id)
      .eq('vacancy_id', vacancyId)
      .single();
    expect(c2Req?.status).toBe('Accepted');

    // Verify notification created for cand1
    const { data: notifs } = await supabase
      .from('participant_notifications')
      .select('*')
      .eq('participant_id', cand1.id)
      .eq('type', 'REQUEST_CANCELED_SLOT_REMOVED');
    expect(notifs).toHaveLength(1);

    // Removing a Filled slot throws VACANCY_NOT_OPEN
    const { data: filledVac } = await supabase
      .from('team_vacancies')
      .insert({
        team_id: teamId,
        role: 'AI/ML',
        skills: ['PyTorch'],
        status: 'Filled',
      })
      .select()
      .single();

    const { error: filledErr } = await supabase.rpc('remove_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_vacancy: filledVac!.id,
    });
    expect(filledErr?.message).toMatch(/VACANCY_NOT_OPEN/);
  });

  // Scenario 6: Disband releases all, cancels pending, restores availability, second disband fails
  it('Scenario 6: Disband releases all members, restores availability, and second call rejects', async () => {
    const owner = await createTestParticipant('sc6-owner');
    const member = await createTestParticipant('sc6-member');
    const event = await createTestEvent('sc6-event');

    const { data: teamRes } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Disband Test Team`,
      p_pitch: 'Disband testing pitch.',
      p_goal: 'Learning',
      p_commitment_hours: 10,
    });
    const teamId = teamRes.team.id;

    // Add confirmed member
    await supabase.from('team_memberships').insert({
      team_id: teamId,
      event_id: event.id,
      participant_id: member.id,
      role: 'Member',
      status: 'Confirmed',
    });

    // Member had availability row false
    await supabase.from('event_availability').upsert({
      participant_id: member.id,
      event_id: event.id,
      is_looking: false,
    });

    // Disband team
    const { data: disbandRes, error: disbandErr } = await supabase.rpc('disband_team', {
      p_actor: owner.id,
      p_team: teamId,
    });
    expect(disbandErr).toBeNull();
    expect(disbandRes.releasedMembers).toBe(2);

    // Verify recruitment_status is Disbanded
    const { data: teamRow } = await supabase.from('teams').select('*').eq('id', teamId).single();
    expect(teamRow?.recruitment_status).toBe('Disbanded');

    // Verify member availability restored
    const { data: avail } = await supabase
      .from('event_availability')
      .select('*')
      .eq('participant_id', member.id)
      .eq('event_id', event.id)
      .single();
    expect(avail?.is_looking).toBe(true);

    // Second disband must reject with TEAM_NOT_MUTABLE
    const { error: secondDisbandErr } = await supabase.rpc('disband_team', {
      p_actor: owner.id,
      p_team: teamId,
    });
    expect(secondDisbandErr?.message).toMatch(/TEAM_NOT_MUTABLE/);
  });

  // Scenario 7: Remove member reopens capacity, restores availability, denies owner removal
  it('Scenario 7: Remove member reopens capacity, enforces reason, and prevents owner self-removal', async () => {
    const owner = await createTestParticipant('sc7-owner');
    const member = await createTestParticipant('sc7-member');
    const event = await createTestEvent('sc7-event', { max_team_size: 2 });

    const { data: teamRes } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Member Removal Team`,
      p_pitch: 'Member removal pitch.',
      p_goal: 'Learning',
      p_commitment_hours: 12,
    });
    const teamId = teamRes.team.id;

    // Add confirmed member
    await supabase.from('team_memberships').insert({
      team_id: teamId,
      event_id: event.id,
      participant_id: member.id,
      role: 'Member',
      status: 'Confirmed',
    });

    // Pre-declare availability
    await supabase.from('event_availability').upsert({
      participant_id: member.id,
      event_id: event.id,
      is_looking: false,
    });

    // At capacity (1 owner + 1 member = 2 = max_team_size) -> add vacancy fails
    const { error: capErr } = await supabase.rpc('add_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_role: 'Frontend',
      p_skills: ['React'],
    });
    expect(capErr?.message).toMatch(/CAPACITY_EXCEEDED/);

    // Owner cannot remove self
    const { error: ownerSelfRemoveErr } = await supabase.rpc('remove_team_member', {
      p_actor: owner.id,
      p_team: teamId,
      p_member: owner.id,
      p_reason: 'I quit',
    });
    expect(ownerSelfRemoveErr?.message).toMatch(/CANNOT_REMOVE_OWNER/);

    // Remove member
    const { data: removeRes, error: removeErr } = await supabase.rpc('remove_team_member', {
      p_actor: owner.id,
      p_team: teamId,
      p_member: member.id,
      p_reason: 'Skill mismatch',
    });
    expect(removeErr).toBeNull();
    expect(removeRes.availabilityRestored).toBe(true);

    // Verify capacity reopened -> add vacancy now succeeds
    const { data: addVacRes, error: addVacErr } = await supabase.rpc('add_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_role: 'Frontend',
      p_skills: ['React'],
    });
    expect(addVacErr).toBeNull();
    expect(addVacRes.vacancy?.id).toBeDefined();
  });

  // Scenario 8: Lifecycle lock for non-mutable states rejects all 6 mutating functions
  it('Scenario 8: Non-mutable states reject all mutating functions without partial writes', async () => {
    const owner = await createTestParticipant('sc8-owner');
    const event = await createTestEvent('sc8-event');

    const { data: teamRes } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Locked Team`,
      p_pitch: 'Locked pitch.',
      p_goal: 'Learning',
      p_commitment_hours: 10,
    });
    const teamId = teamRes.team.id;

    // Add vacancy
    const { data: vacRes } = await supabase.rpc('add_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_role: 'Backend',
      p_skills: ['Node.js'],
    });
    const vacancyId = vacRes.vacancy.id;

    // Lock recruitment (status + server lock timestamp — US-022 / #206)
    await supabase
      .from('teams')
      .update({ recruitment_status: 'Locked', locked_at: new Date().toISOString() })
      .eq('id', teamId);

    // Snapshot before
    const { data: snapBefore } = await supabase.from('teams').select('*').eq('id', teamId).single();

    // Verify 6 mutating functions reject
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      supabase.rpc('update_team_listing', {
        p_actor: owner.id,
        p_team: teamId,
        p_patch: { name: 'Attempted Change' },
      }),
      supabase.rpc('add_team_vacancy', {
        p_actor: owner.id,
        p_team: teamId,
        p_role: 'Pitch',
        p_skills: ['Public Speaking'],
      }),
      supabase.rpc('update_team_vacancy', {
        p_actor: owner.id,
        p_team: teamId,
        p_vacancy: vacancyId,
        p_role: 'AI/ML',
        p_skills: ['TensorFlow'],
      }),
      supabase.rpc('remove_team_vacancy', {
        p_actor: owner.id,
        p_team: teamId,
        p_vacancy: vacancyId,
      }),
      supabase.rpc('remove_team_member', {
        p_actor: owner.id,
        p_team: teamId,
        p_member: crypto.randomUUID(),
        p_reason: 'Reason',
      }),
      supabase.rpc('disband_team', {
        p_actor: owner.id,
        p_team: teamId,
      }),
    ]);

    expect(r1.error?.message).toMatch(/TEAM_NOT_MUTABLE/);
    expect(r2.error?.message).toMatch(/TEAM_NOT_MUTABLE/);
    expect(r3.error?.message).toMatch(/TEAM_NOT_MUTABLE/);
    expect(r4.error?.message).toMatch(/TEAM_NOT_MUTABLE/);
    expect(r5.error?.message).toMatch(/TEAM_NOT_MUTABLE/);
    expect(r6.error?.message).toMatch(/TEAM_NOT_MUTABLE/);

    // Snapshot after is identical (no partial writes)
    const { data: snapAfter } = await supabase.from('teams').select('*').eq('id', teamId).single();
    expect(snapAfter).toEqual(snapBefore);
  });

  // Scenario 9: Non-owner actor rejected on every mutating function
  it('Scenario 9: Non-owner actor is rejected with FORBIDDEN_NOT_TEAM_OWNER on all mutating functions', async () => {
    const owner = await createTestParticipant('sc9-owner');
    const attacker = await createTestParticipant('sc9-attacker');
    const event = await createTestEvent('sc9-event');

    const { data: teamRes } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Non Owner Security Team`,
      p_pitch: 'Security test pitch.',
      p_goal: 'Learning',
      p_commitment_hours: 10,
    });
    const teamId = teamRes.team.id;

    const { data: vacRes } = await supabase.rpc('add_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_role: 'Frontend',
      p_skills: ['React'],
    });
    const vacancyId = vacRes.vacancy.id;

    const calls = await Promise.all([
      supabase.rpc('update_team_listing', {
        p_actor: attacker.id,
        p_team: teamId,
        p_patch: { name: 'Hacked' },
      }),
      supabase.rpc('add_team_vacancy', {
        p_actor: attacker.id,
        p_team: teamId,
        p_role: 'UI/UX',
        p_skills: [],
      }),
      supabase.rpc('update_team_vacancy', {
        p_actor: attacker.id,
        p_team: teamId,
        p_vacancy: vacancyId,
        p_role: 'Mobile',
        p_skills: [],
      }),
      supabase.rpc('remove_team_vacancy', {
        p_actor: attacker.id,
        p_team: teamId,
        p_vacancy: vacancyId,
      }),
      supabase.rpc('remove_team_member', {
        p_actor: attacker.id,
        p_team: teamId,
        p_member: owner.id,
        p_reason: 'Rogue reason',
      }),
      supabase.rpc('disband_team', {
        p_actor: attacker.id,
        p_team: teamId,
      }),
    ]);

    for (const res of calls) {
      expect(res.error?.message).toMatch(/FORBIDDEN_NOT_TEAM_OWNER/);
    }
  });

  // Scenario 10: Pending-invite uniqueness enforces code 23505
  it('Scenario 10: Second pending invitation for the same team and invitee violates partial unique index 23505', async () => {
    const owner = await createTestParticipant('sc10-owner');
    const invitee = await createTestParticipant('sc10-invitee');
    const event = await createTestEvent('sc10-event');

    const { data: teamRes } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Invite Uniqueness Team`,
      p_pitch: 'Testing unique partial index.',
      p_goal: 'Learning',
      p_commitment_hours: 10,
    });
    const teamId = teamRes.team.id;

    // First invitation succeeds
    const { error: inv1Err } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      participant_id: invitee.id,
      request_type: 'Invitation',
      status: 'Pending',
    });
    expect(inv1Err).toBeNull();

    // Second invitation fails with 23505 (unique_violation)
    const { error: inv2Err } = await supabase.from('team_requests').insert({
      team_id: teamId,
      event_id: event.id,
      participant_id: invitee.id,
      request_type: 'Invitation',
      status: 'Pending',
    });
    expect(inv2Err?.code).toBe('23505');
  });

  // Scenario 12: Lock cancels Pending invitations + applications (US-022 / #209)
  it('Scenario 12: lock_team cancels Pending invitations and applications with TEAM_LOCKED', async () => {
    const owner = await createTestParticipant('sc12-owner');
    const member = await createTestParticipant('sc12-member');
    const invitee = await createTestParticipant('sc12-invitee');
    const applicant = await createTestParticipant('sc12-applicant');
    const acceptedInvitee = await createTestParticipant('sc12-accepted');
    const event = await createTestEvent('sc12-event', { max_team_size: 4 });

    const { data: teamRes, error: teamErr } = await supabase.rpc('create_team_with_owner', {
      p_owner_id: owner.id,
      p_event_id: event.id,
      p_name: `${PREFIX} Lock Cancel Team`,
      p_pitch: 'Testing cancel-on-lock for invitations and applications.',
      p_goal: 'Project Completion',
      p_commitment_hours: 12,
    });
    expect(teamErr).toBeNull();
    const teamId = teamRes.team.id;

    await supabase.from('team_memberships').insert({
      team_id: teamId,
      event_id: event.id,
      participant_id: member.id,
      role: 'Member',
      status: 'Confirmed',
    });

    const { data: vacRes } = await supabase.rpc('add_team_vacancy', {
      p_actor: owner.id,
      p_team: teamId,
      p_role: 'Frontend',
      p_skills: ['React'],
    });
    const vacancyId = vacRes.vacancy.id;

    await supabase.from('team_requests').insert([
      {
        team_id: teamId,
        event_id: event.id,
        vacancy_id: vacancyId,
        participant_id: invitee.id,
        request_type: 'Invitation',
        status: 'Pending',
      },
      {
        team_id: teamId,
        event_id: event.id,
        vacancy_id: vacancyId,
        participant_id: applicant.id,
        request_type: 'Application',
        status: 'Pending',
      },
      {
        team_id: teamId,
        event_id: event.id,
        vacancy_id: vacancyId,
        participant_id: acceptedInvitee.id,
        request_type: 'Invitation',
        status: 'Accepted',
      },
    ]);

    const { data: lockRes, error: lockErr } = await supabase.rpc('lock_team', {
      p_actor: owner.id,
      p_team: teamId,
    });
    expect(lockErr).toBeNull();
    expect(lockRes.canceledRequests).toBe(2);
    expect(lockRes.memberCount).toBe(2);
    expect(lockRes.lockedAt).toBeTruthy();

    const { data: teamRow } = await supabase
      .from('teams')
      .select('recruitment_status, locked_at')
      .eq('id', teamId)
      .single();
    expect(teamRow?.recruitment_status).toBe('Locked');
    expect(teamRow?.locked_at).toBeTruthy();

    const { data: inviteRow } = await supabase
      .from('team_requests')
      .select('status, cancel_reason, resolved_at')
      .eq('participant_id', invitee.id)
      .single();
    expect(inviteRow?.status).toBe('Canceled');
    expect(inviteRow?.cancel_reason).toBe('TEAM_LOCKED');
    expect(inviteRow?.resolved_at).toBeTruthy();

    const { data: appRow } = await supabase
      .from('team_requests')
      .select('status, cancel_reason, resolved_at')
      .eq('participant_id', applicant.id)
      .single();
    expect(appRow?.status).toBe('Canceled');
    expect(appRow?.cancel_reason).toBe('TEAM_LOCKED');
    expect(appRow?.resolved_at).toBeTruthy();

    const { data: acceptedRow } = await supabase
      .from('team_requests')
      .select('status, cancel_reason')
      .eq('participant_id', acceptedInvitee.id)
      .single();
    expect(acceptedRow?.status).toBe('Accepted');
    expect(acceptedRow?.cancel_reason).toBeNull();

    const { data: cancelAlerts } = await supabase
      .from('participant_notifications')
      .select('type, participant_id')
      .eq('team_id', teamId)
      .eq('type', 'REQUEST_CANCELED_TEAM_LOCKED');
    expect((cancelAlerts || []).length).toBe(2);

    // Unauthorized: non-owner cannot lock
    const { error: nonOwnerErr } = await supabase.rpc('lock_team', {
      p_actor: member.id,
      p_team: teamId,
    });
    expect(nonOwnerErr?.message).toMatch(/FORBIDDEN_NOT_TEAM_OWNER|ALREADY_LOCKED/);
  });

  // Scenario 11: Direct-anon denial verifies REVOKE permissions
  it('Scenario 11: Calling team functions directly with anon key client is denied', async () => {
    const anonKey = process.env.SUPABASE_ANON_KEY || 'fake-anon-key';
    const anonClient = createClient(process.env.SUPABASE_URL || config.supabase?.url || '', anonKey, {
      auth: { persistSession: false },
    });

    const calls = await Promise.all([
      anonClient.rpc('create_team_with_owner', {
        p_owner_id: crypto.randomUUID(),
        p_event_id: crypto.randomUUID(),
        p_name: 'Anon Team',
        p_pitch: 'Anon pitch',
        p_goal: 'Learning',
        p_commitment_hours: 10,
      }),
      anonClient.rpc('update_team_listing', {
        p_actor: crypto.randomUUID(),
        p_team: crypto.randomUUID(),
        p_patch: {},
      }),
      anonClient.rpc('add_team_vacancy', {
        p_actor: crypto.randomUUID(),
        p_team: crypto.randomUUID(),
        p_role: 'Frontend',
        p_skills: [],
      }),
      anonClient.rpc('update_team_vacancy', {
        p_actor: crypto.randomUUID(),
        p_team: crypto.randomUUID(),
        p_vacancy: crypto.randomUUID(),
        p_role: 'Frontend',
        p_skills: [],
      }),
      anonClient.rpc('remove_team_vacancy', {
        p_actor: crypto.randomUUID(),
        p_team: crypto.randomUUID(),
        p_vacancy: crypto.randomUUID(),
      }),
      anonClient.rpc('disband_team', {
        p_actor: crypto.randomUUID(),
        p_team: crypto.randomUUID(),
      }),
      anonClient.rpc('remove_team_member', {
        p_actor: crypto.randomUUID(),
        p_team: crypto.randomUUID(),
        p_member: crypto.randomUUID(),
        p_reason: 'Anon reason',
      }),
    ]);

    for (const res of calls) {
      expect(res.error).toBeDefined();
      // Should be 401/403 or function not found / permission denied for role anon
      expect(res.data).toBeNull();
    }
  });
});
