/**
 * US-032 / #385 — direct-message relations and inbox indexes verified against
 * the real 0053 + 0055 SQL in an in-process PostgreSQL-compatible database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { canonicalParticipantPair } from './directMessage.repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const FILES = [
  '0001_create_participants_table.sql',
  '0053_create_direct_message_threads.sql',
  '0055_create_direct_messages.sql',
];
const sqlOf = (file: string): string => fs.readFileSync(path.join(DIR, file), 'utf8');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> => (await db.query(sql, params)).rows as T[];

const fails = async (sql: string, params?: unknown[]): Promise<string | null> => {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};

const ids = {
  avery: '10000000-0000-4000-8000-000000000001',
  blake: '20000000-0000-4000-8000-000000000002',
  casey: '30000000-0000-4000-8000-000000000003',
  missing: '40000000-0000-4000-8000-000000000004',
};

async function createThread(first = ids.avery, second = ids.blake): Promise<string> {
  const pair = canonicalParticipantPair(first, second);
  if (!pair) throw new Error('Test requires two distinct participants.');
  return (
    await rows<{ id: string }>(
      `INSERT INTO direct_message_threads (participant_low_id, participant_high_id)
       VALUES ($1, $2) RETURNING id`,
      [pair.low, pair.high]
    )
  )[0].id;
}

describe('direct-message persistence on real SQL (US-032 / #385)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    for (const file of FILES) await db.exec(sqlOf(file));

    for (const [id, key] of [
      [ids.avery, 'avery'],
      [ids.blake, 'blake'],
      [ids.casey, 'casey'],
    ] as const) {
      await db.query(
        `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
         VALUES ($1, $2, $3, $4, 'PART', TRUE)`,
        [id, `fb-${key}`, `${key}@example.test`, key]
      );
    }
  }, 60_000);

  afterEach(async () => {
    await db.query('DELETE FROM direct_messages');
    await db.query('DELETE FROM direct_message_threads');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('applies and reapplies 0055 idempotently after the applied 0053 model', async () => {
    await expect(db.exec(sqlOf(FILES[2]))).resolves.not.toThrow();
  });

  it('stores messages from either participant in their thread', async () => {
    const threadId = await createThread();
    await db.query(
      `INSERT INTO direct_messages (thread_id, author_id, body, created_at)
       VALUES ($1, $2, 'hello', '2026-11-09T12:00:00Z'),
              ($1, $3, 'hi', '2026-11-09T12:01:00Z')`,
      [threadId, ids.avery, ids.blake]
    );
    const messages = await rows<{ author_id: string; body: string }>(
      `SELECT author_id, body FROM direct_messages
       WHERE thread_id = $1 ORDER BY created_at ASC, id ASC`,
      [threadId]
    );
    expect(messages).toEqual([
      { author_id: ids.avery, body: 'hello' },
      { author_id: ids.blake, body: 'hi' },
    ]);
  });

  it('rejects an author who is not one of the two thread participants', async () => {
    const threadId = await createThread();
    expect(
      await fails(
        `INSERT INTO direct_messages (thread_id, author_id, body)
         VALUES ($1, $2, 'not allowed')`,
        [threadId, ids.casey]
      )
    ).toMatch(/DIRECT_MESSAGE_AUTHOR_NOT_PARTICIPANT/);
  });

  it('rejects missing thread and participant references', async () => {
    const threadId = await createThread();
    expect(
      await fails(
        `INSERT INTO direct_messages (thread_id, author_id, body)
         VALUES ($1, $2, 'missing author')`,
        [threadId, ids.missing]
      )
    ).toMatch(/DIRECT_MESSAGE_AUTHOR_NOT_PARTICIPANT|foreign key|violates/i);
    expect(
      await fails(
        `INSERT INTO direct_messages (thread_id, author_id, body)
         VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', $1, 'missing thread')`,
        [ids.avery]
      )
    ).toMatch(/foreign key|violates/i);
  });

  it('reuses chat body rules for nonblank text up to 4,000 characters', async () => {
    const threadId = await createThread();
    expect(
      await fails(
        `INSERT INTO direct_messages (thread_id, author_id, body)
         VALUES ($1, $2, '   ')`,
        [threadId, ids.avery]
      )
    ).toMatch(/chk_direct_messages_body_nonempty/);
    expect(
      await fails(
        `INSERT INTO direct_messages (thread_id, author_id, body)
         VALUES ($1, $2, $3)`,
        [threadId, ids.avery, 'x'.repeat(4001)]
      )
    ).toMatch(/chk_direct_messages_body_length/);
  });

  it('updates last_message_at without allowing an older insert to move it backward', async () => {
    const threadId = await createThread();
    const initialActivity = (
      await rows<{ last_message_at: Date }>(
        'SELECT last_message_at FROM direct_message_threads WHERE id = $1',
        [threadId]
      )
    )[0].last_message_at;
    const newer = new Date(initialActivity.getTime() + 60_000);
    const older = new Date(initialActivity.getTime() + 30_000);
    await db.query(
      `INSERT INTO direct_messages (thread_id, author_id, body, created_at)
       VALUES ($1, $2, 'newer', $3)`,
      [threadId, ids.avery, newer]
    );
    await db.query(
      `INSERT INTO direct_messages (thread_id, author_id, body, created_at)
       VALUES ($1, $2, 'older', $3)`,
      [threadId, ids.blake, older]
    );
    const activity = (
      await rows<{ last_message_at: Date }>(
        'SELECT last_message_at FROM direct_message_threads WHERE id = $1',
        [threadId]
      )
    )[0].last_message_at;
    expect(activity.toISOString()).toBe(newer.toISOString());
  });

  it('adds participant activity and deterministic thread-message indexes', async () => {
    const indexes = await rows<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename IN ('direct_message_threads', 'direct_messages')`
    );
    const byName = Object.fromEntries(
      indexes.map((index) => [index.indexname, index.indexdef])
    );
    expect(byName.idx_direct_message_threads_low_activity).toMatch(
      /\(participant_low_id, last_message_at DESC, id\)/i
    );
    expect(byName.idx_direct_message_threads_high_activity).toMatch(
      /\(participant_high_id, last_message_at DESC, id\)/i
    );
    expect(byName.idx_direct_messages_thread_created_id).toMatch(
      /\(thread_id, created_at, id\)/i
    );
  });

  it('enables RLS with no public direct-message policies', async () => {
    const rls = (
      await rows<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE relname = 'direct_messages'"
      )
    )[0].relrowsecurity;
    const policies = await rows(
      "SELECT 1 FROM pg_policies WHERE tablename = 'direct_messages'"
    );
    expect(rls).toBe(true);
    expect(policies).toHaveLength(0);
  });
});

