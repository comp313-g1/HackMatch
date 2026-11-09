/**
 * US-028 / #258 Real Postgres audit-record query + append-only integration tests.
 *
 * Gated by: process.env.RUN_DB_INTEGRATION === '1' against local Supabase only.
 *
 * Audit rows are append-only by design (they cannot be deleted, and participants
 * that authored them cannot be deleted either), so this suite does not clean up:
 * every run uses its own freshly provisioned admin and filters on that actor, which
 * keeps runs independent. The same scenarios were also executed against a real
 * Postgres engine with all migrations applied while authoring this task.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './client.js';
import { config } from '../config/index.js';
import { auditRecordsRepository } from './auditRecords.repository.js';

const isGated = process.env.RUN_DB_INTEGRATION !== '1';

if (isGated) {
  console.info(
    '[SKIP] Audit record DB integration tests skipped: set RUN_DB_INTEGRATION=1 against local Supabase to execute.'
  );
}

describe.skipIf(isGated)('US-028 audit-record query + append-only (#258)', () => {
  let supabase: SupabaseClient;
  const RUN = crypto.randomUUID().slice(0, 8);
  const TARGET = crypto.randomUUID();
  let admin: string;
  let otherAdmin: string;
  let part: string;
  let suspendedAdmin: string;

  async function provisionAdmin(label: string): Promise<string> {
    const uid = `us028-${RUN}-${label}`;
    const { data, error } = await supabase.rpc('provision_admin_participant', {
      p_firebase_uid: uid,
      p_email: `${uid}@example.com`,
      p_full_name: `Audit ${label}`,
    });
    if (error) throw error;
    return (data as Array<{ id: string }>)[0].id;
  }

  async function record(actor: string, actionType: string, createdAt: string, targetType = 'team') {
    const { error } = await supabase.from('event_action_records').insert({
      actor_id: actor,
      target_type: targetType,
      target_id: TARGET,
      action_type: actionType,
      reason: `reason ${RUN}`,
      outcome: 'Applied',
      safe_state_summary: { run: RUN },
      created_at: createdAt,
    });
    if (error) throw error;
  }

  beforeAll(async () => {
    const rawUrl = process.env.SUPABASE_URL || config.supabase?.url || '';
    if (!rawUrl) throw new Error('Missing SUPABASE_URL for real DB integration test.');
    const host = new URL(rawUrl).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`Refusing to execute real DB integration tests on non-local host: ${host}`);
    }
    supabase = getSupabaseClient();

    admin = await provisionAdmin('admin');
    otherAdmin = await provisionAdmin('other');
    suspendedAdmin = await provisionAdmin('suspended');
    await supabase
      .from('participants')
      .update({ is_suspended: true, suspended_at: new Date().toISOString(), suspension_reason: 'test' })
      .eq('id', suspendedAdmin);
    const { data: p, error } = await supabase
      .from('participants')
      .insert({
        firebase_uid: `us028-${RUN}-part`,
        email: `us028-${RUN}-part@example.com`,
        full_name: 'Audit Part',
        role: 'PART',
        is_verified: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    part = p.id as string;

    // 6 records for `admin` (3 moderation, 2 account, 1 event) + 1 for `otherAdmin`,
    // including two with an identical timestamp to exercise the id tie-break.
    await record(admin, 'moderation_dismiss', '2026-11-01T10:00:00.000000Z');
    await record(admin, 'moderation_warn', '2026-11-01T11:00:00.000000Z');
    await record(admin, 'moderation_hide', '2026-11-01T12:00:00.000000Z');
    await record(admin, 'account_suspend', '2026-11-02T09:00:00.000000Z', 'participant');
    await record(admin, 'account_delete', '2026-11-02T09:00:00.000000Z', 'participant');
    await record(admin, 'event_approve', '2026-11-03T08:00:00.000000Z', 'event');
    await record(otherAdmin, 'moderation_warn', '2026-11-01T13:00:00.000000Z');
  });

  const query = (params: Partial<Parameters<typeof auditRecordsRepository.query>[1]> = {}, as = admin) =>
    auditRecordsRepository.query(as, { actorId: admin, limit: 25, ...params });

  it('returns the actor\'s event, moderation and account records newest-first with all AC 2 fields', async () => {
    const r = await query();
    expect(r.records).toHaveLength(6);
    expect(r.hasMore).toBe(false);
    expect(r.nextCursor).toBeNull();
    expect(new Set(r.records.map((x) => x.category))).toEqual(new Set(['event', 'moderation', 'account']));
    const times = r.records.map((x) => x.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(r.records[0]).toMatchObject({
      actorId: admin,
      actionType: 'event_approve',
      category: 'event',
      targetType: 'event',
      targetId: TARGET,
      outcome: 'Applied',
      createdAt: '2026-11-03T08:00:00.000000Z',
    });
    expect(r.records[0].id).toBeTruthy();
    expect(r.records[0].safeStateSummary).toEqual({ run: RUN });
  });

  it('filters by action type, category, actor and inclusive date range', async () => {
    expect((await query({ actionType: 'moderation_warn' })).records).toHaveLength(1);
    expect((await query({ category: 'account' })).records).toHaveLength(2);
    expect((await query({ actorId: otherAdmin })).records).toHaveLength(1);
    const day = await query({ from: '2026-11-02T00:00:00Z', to: '2026-11-02T23:59:59.999999Z' });
    expect(day.records.map((x) => x.actionType).sort()).toEqual(['account_delete', 'account_suspend']);
    const exact = await query({ from: '2026-11-02T09:00:00.000000Z', to: '2026-11-02T09:00:00.000000Z' });
    expect(exact.records).toHaveLength(2);
  });

  it('returns an empty page for no matches', async () => {
    const r = await query({ actionType: 'no_such_action' });
    expect(r).toEqual({ records: [], hasMore: false, nextCursor: null });
  });

  it('pages through identical timestamps without gaps or duplicates', async () => {
    const seen: string[] = [];
    let cursor: { createdAt: string; id: string } | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await query({ limit: 2, cursor });
      seen.push(...page.records.map((x) => x.id));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it('rejects invalid input with VALIDATION_ERROR and changes nothing', async () => {
    for (const bad of [{ limit: 0 }, { limit: 101 }, { from: '2026-11-03T00:00:00Z', to: '2026-11-01T00:00:00Z' }]) {
      await expect(query(bad)).rejects.toMatchObject({ message: expect.stringContaining('VALIDATION_ERROR') });
    }
    expect((await query()).records).toHaveLength(6);
  });

  it('denies non-admin, suspended and unknown callers inside the database', async () => {
    for (const caller of [part, suspendedAdmin, crypto.randomUUID()]) {
      await expect(query({}, caller)).rejects.toMatchObject({
        message: expect.stringContaining('FORBIDDEN_NOT_ADMIN'),
      });
    }
  });

  it('is append-only: UPDATE and DELETE are refused for the application role', async () => {
    const { data } = await supabase.from('event_action_records').select('id').eq('actor_id', admin).limit(1);
    const id = data![0].id as string;

    const upd = await supabase.from('event_action_records').update({ reason: 'tampered' }).eq('id', id);
    expect(upd.error?.message).toMatch(/permission denied|append-only/i);
    const del = await supabase.from('event_action_records').delete().eq('id', id);
    expect(del.error?.message).toMatch(/permission denied|append-only/i);

    const { data: after } = await supabase.from('event_action_records').select('reason').eq('id', id).single();
    expect(after?.reason).toBe(`reason ${RUN}`);
  });

  it('still accepts new records, which then appear in the query', async () => {
    await record(admin, 'moderation_redact', '2026-11-04T08:00:00.000000Z');
    const r = await query({ actionType: 'moderation_redact' });
    expect(r.records).toHaveLength(1);
  });

  it('refuses to record an action for a non-admin actor', async () => {
    await expect(record(part, 'moderation_warn', '2026-11-04T09:00:00.000000Z')).rejects.toMatchObject({
      message: expect.stringMatching(/ADMIN/),
    });
  });
});
