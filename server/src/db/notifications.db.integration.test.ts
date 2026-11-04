/**
 * US-021 / #197 Real Postgres notification model integration tests.
 *
 * Covers derived categories, read-state constraint, owner-scoped mark-read /
 * mark-all-read, idempotency, and cross-user isolation.
 * Gated by: process.env.RUN_DB_INTEGRATION === '1' against local Supabase only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './client.js';
import { config } from '../config/index.js';
import { notificationsRepository } from './notifications.repository.js';

const isGated = process.env.RUN_DB_INTEGRATION !== '1';

if (isGated) {
  console.info(
    '[SKIP] Notification model DB integration tests skipped: set RUN_DB_INTEGRATION=1 against local Supabase to execute.'
  );
}

describe.skipIf(isGated)('US-021 Notification Model Postgres Suite (#197)', () => {
  let supabase: SupabaseClient;
  const RUN_ID = crypto.randomUUID().slice(0, 8);
  const PREFIX = `us021-m-${RUN_ID}`;

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
      await supabase.from('participants').delete().like('firebase_uid', `%${PREFIX}%`);
    } catch (cleanupErr) {
      console.warn('[CLEANUP WARN] notification model teardown failed:', cleanupErr);
    }
  });

  async function createParticipant(label: string): Promise<string> {
    const uid = `${PREFIX}-${label}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase
      .from('participants')
      .insert({
        firebase_uid: uid,
        email: `${uid}@example.com`,
        full_name: `Notification Model ${label}`,
        role: 'PART',
        is_verified: true,
        is_suspended: false,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function notify(participantId: string, type: string) {
    const { data, error } = await supabase
      .from('participant_notifications')
      .insert({ participant_id: participantId, type, message: `${PREFIX} ${type}` })
      .select()
      .single();
    if (error) throw error;
    return data as { id: string; category: string; read_at: string | null };
  }

  it('derives category from type for producers that never set it', async () => {
    const pid = await createParticipant('cat');
    const rows = await Promise.all([
      notify(pid, 'team_invitation'),
      notify(pid, 'team_application_submitted'),
      notify(pid, 'team_application_declined'),
      notify(pid, 'TEAM_ROSTER_LOCKED'),
      notify(pid, 'event_verification_approved'),
      notify(pid, 'moderation_warning'),
    ]);
    expect(rows.map((r) => r.category)).toEqual([
      'invitation',
      'application',
      'decision',
      'roster',
      'event_verification',
      'general',
    ]);
  });

  it('rejects read_at earlier than created_at and preserves the row', async () => {
    const pid = await createParticipant('chk');
    const row = await notify(pid, 'team_invitation');

    const { error } = await supabase
      .from('participant_notifications')
      .update({ read_at: '2000-01-01T00:00:00Z' })
      .eq('id', row.id);
    expect(error?.message).toMatch(/chk_participant_notifications_read_after_created/);

    const { data } = await supabase
      .from('participant_notifications')
      .select('read_at')
      .eq('id', row.id)
      .single();
    expect(data?.read_at).toBeNull();
  });

  it('marks one notification read idempotently with an accurate unread count', async () => {
    const pid = await createParticipant('one');
    const first = await notify(pid, 'team_invitation');
    await notify(pid, 'team_application_approved');

    const { data: r1, error: e1 } = await supabase.rpc('mark_participant_notification_read', {
      p_participant: pid,
      p_notification: first.id,
    });
    expect(e1).toBeNull();
    expect(r1).toMatchObject({ alreadyRead: false, unreadCount: 1 });

    const { data: r2 } = await supabase.rpc('mark_participant_notification_read', {
      p_participant: pid,
      p_notification: first.id,
    });
    expect(r2).toMatchObject({ alreadyRead: true, unreadCount: 1 });
    expect((r2 as { notification: { read_at: string } }).notification.read_at).toBe(
      (r1 as { notification: { read_at: string } }).notification.read_at
    );
  });

  it("hides another participant's notification and leaves it unread", async () => {
    const owner = await createParticipant('owner');
    const intruder = await createParticipant('intruder');
    const row = await notify(owner, 'team_invitation');

    const { error } = await supabase.rpc('mark_participant_notification_read', {
      p_participant: intruder,
      p_notification: row.id,
    });
    expect(error?.message).toMatch(/NOTIFICATION_NOT_FOUND/);

    const { data } = await supabase
      .from('participant_notifications')
      .select('read_at')
      .eq('id', row.id)
      .single();
    expect(data?.read_at).toBeNull();
  });

  it('marks all of one participant read without touching other accounts', async () => {
    const a = await createParticipant('all-a');
    const b = await createParticipant('all-b');
    await notify(a, 'team_invitation');
    await notify(a, 'TEAM_ROSTER_LOCKED');
    await notify(b, 'team_invitation');

    const { data, error } = await supabase.rpc('mark_all_participant_notifications_read', {
      p_participant: a,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ markedCount: 2, unreadCount: 0 });

    const { count } = await supabase
      .from('participant_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', b)
      .is('read_at', null);
    expect(count).toBe(1);
  });

  it('pages newest-first with a keyset cursor, without gaps or duplicates', async () => {
    const pid = await createParticipant('page');
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      created.push((await notify(pid, 'team_invitation')).id);
    }

    const seen: string[] = [];
    let cursor: { createdAt: string; id: string } | null = null;
    for (let guard = 0; guard < 5; guard++) {
      const page = await notificationsRepository.listForParticipant(pid, {
        limit: 2,
        cursor,
      });
      if (page.length === 0) break;
      seen.push(...page.map((r) => r.id));
      const last = page[page.length - 1];
      cursor = { createdAt: last.created_at, id: last.id };
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(created));
  });

  it('filters unread-only and by category and counts unread accurately', async () => {
    const pid = await createParticipant('filter');
    const inv = await notify(pid, 'team_invitation');
    await notify(pid, 'TEAM_ROSTER_LOCKED');
    await supabase.rpc('mark_participant_notification_read', {
      p_participant: pid,
      p_notification: inv.id,
    });

    const unread = await notificationsRepository.listForParticipant(pid, {
      limit: 10,
      unreadOnly: true,
    });
    expect(unread.map((r) => r.category)).toEqual(['roster']);

    const invitations = await notificationsRepository.listForParticipant(pid, {
      limit: 10,
      category: 'invitation',
    });
    expect(invitations.map((r) => r.id)).toEqual([inv.id]);
    expect(await notificationsRepository.countUnread(pid)).toBe(1);
  });
  it('rejects null arguments with VALIDATION_ERROR', async () => {
    const { error } = await supabase.rpc('mark_all_participant_notifications_read', {
      p_participant: null,
    });
    expect(error?.message).toMatch(/VALIDATION_ERROR/);
  });
});
