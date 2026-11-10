/**
 * US-034 / #399 — set-based unread counts verified against the real 0058/0059
 * SQL in an in-process PostgreSQL-compatible database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const FILES = [
  '0001_create_participants_table.sql',
  '0010_add_participant_suspension.sql',
  '0039_account_enforcement_models.sql',
  '0041_create_chat_channel_message_models.sql',
  '0051_add_team_channel_linkage_to_chat_channels.sql',
  '0053_create_direct_message_threads.sql',
  '0055_create_direct_messages.sql',
  '0058_create_chat_read_cursors.sql',
  '0059_create_chat_unread_count_query.sql',
] as const;
const sqlOf = (file: (typeof FILES)[number]): string =>
  fs.readFileSync(path.join(DIR, file), 'utf8');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> => (await db.query(sql, params)).rows as T[];

const ids = {
  reader: '10000000-0000-4000-8000-000000000001',
  peer: '20000000-0000-4000-8000-000000000002',
  outsider: '30000000-0000-4000-8000-000000000003',
  publicCursor: '40000000-0000-4000-8000-000000000001',
  publicNoCursor: '40000000-0000-4000-8000-000000000002',
  publicZero: '40000000-0000-4000-8000-000000000003',
  teamAllowed: '50000000-0000-4000-8000-000000000001',
  teamDenied: '50000000-0000-4000-8000-000000000002',
  teamChannelAllowed: '51000000-0000-4000-8000-000000000001',
  teamChannelDenied: '51000000-0000-4000-8000-000000000002',
  dmAllowed: '60000000-0000-4000-8000-000000000001',
  dmUnrelated: '60000000-0000-4000-8000-000000000002',
  c1: '70000000-0000-4000-8000-000000000001',
  c2: '70000000-0000-4000-8000-000000000002',
  c3: '70000000-0000-4000-8000-000000000003',
  c4: '70000000-0000-4000-8000-000000000004',
  c5: '70000000-0000-4000-8000-000000000005',
  c6: '70000000-0000-4000-8000-000000000006',
  d1: '80000000-0000-4000-8000-000000000001',
  d2: '80000000-0000-4000-8000-000000000002',
  d3: '80000000-0000-4000-8000-000000000003',
  d4: '80000000-0000-4000-8000-000000000004',
} as const;

interface CountRow {
  conversation_type: 'channel' | 'direct_message';
  conversation_id: string;
  unread_count: bigint;
}

async function countsFor(participantId: string = ids.reader): Promise<CountRow[]> {
  return rows<CountRow>(
    'SELECT * FROM get_participant_chat_unread_counts($1)',
    [participantId]
  );
}

function countMap(counts: CountRow[]): Map<string, number> {
  return new Map(
    counts.map((row) => [
      `${row.conversation_type}:${row.conversation_id}`,
      Number(row.unread_count),
    ])
  );
}

describe('chat unread counts on real SQL (US-034 / #399)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    await db.exec(sqlOf(FILES[0]));
    await db.exec(sqlOf(FILES[1]));
    await db.exec(sqlOf(FILES[2]));

    for (const [id, key] of [
      [ids.reader, 'reader'],
      [ids.peer, 'peer'],
      [ids.outsider, 'outsider'],
    ] as const) {
      await db.query(
        `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
         VALUES ($1, $2, $3, $4, 'PART', TRUE)`,
        [id, `fb-${key}`, `${key}@example.test`, key]
      );
    }

    await db.exec(sqlOf(FILES[3]));
    await db.exec(
      `CREATE TABLE teams (
         id UUID PRIMARY KEY,
         recruitment_status VARCHAR(20) NOT NULL DEFAULT 'Open'
       );
       CREATE TABLE team_memberships (
         team_id UUID NOT NULL REFERENCES teams(id),
         participant_id UUID NOT NULL REFERENCES participants(id),
         status VARCHAR(20) NOT NULL
       );`
    );
    await db.exec(sqlOf(FILES[4]));
    await db.exec(sqlOf(FILES[5]));
    await db.exec(sqlOf(FILES[6]));
    await db.exec(sqlOf(FILES[7]));

    await db.query(
      'INSERT INTO teams (id) VALUES ($1), ($2)',
      [ids.teamAllowed, ids.teamDenied]
    );
    await db.query(
      `INSERT INTO team_memberships (team_id, participant_id, status)
       VALUES ($1, $3, 'Confirmed'), ($2, $3, 'Removed')`,
      [ids.teamAllowed, ids.teamDenied, ids.reader]
    );
    await db.query(
      `INSERT INTO chat_channels
         (id, title, description, created_by, channel_type, team_id)
       VALUES
         ($1, 'Cursor forum', 'Public', $6, 'public', NULL),
         ($2, 'No cursor forum', 'Public', $6, 'public', NULL),
         ($3, 'Zero forum', 'Public', $6, 'public', NULL),
         ($4, 'Allowed team', 'Private', $6, 'team', $7),
         ($5, 'Denied team', 'Private', $6, 'team', $8)`,
      [
        ids.publicCursor,
        ids.publicNoCursor,
        ids.publicZero,
        ids.teamChannelAllowed,
        ids.teamChannelDenied,
        ids.reader,
        ids.teamAllowed,
        ids.teamDenied,
      ]
    );
    await db.query(
      `INSERT INTO chat_messages (id, channel_id, author_id, body, created_at)
       VALUES
         ($1, $7, $8, 'cursor message', '2026-11-10T12:00:00Z'),
         ($2, $7, $9, 'own same-time message', '2026-11-10T12:00:00Z'),
         ($3, $7, $8, 'peer same-time message', '2026-11-10T12:00:00Z'),
         ($4, $10, $8, 'no cursor peer', '2026-11-10T12:01:00Z'),
         ($5, $10, $9, 'no cursor own', '2026-11-10T12:02:00Z'),
         ($6, $11, $8, 'allowed team peer', '2026-11-10T12:03:00Z'),
         ('7fffffff-0000-4000-8000-000000000007', $12, $8, 'denied team peer', '2026-11-10T12:04:00Z')`,
      [
        ids.c1,
        ids.c2,
        ids.c3,
        ids.c4,
        ids.c5,
        ids.c6,
        ids.publicCursor,
        ids.peer,
        ids.reader,
        ids.publicNoCursor,
        ids.teamChannelAllowed,
        ids.teamChannelDenied,
      ]
    );
    await db.query(
      `INSERT INTO direct_message_threads
         (id, participant_low_id, participant_high_id)
       VALUES ($1, $3, $4), ($2, $4, $5)`,
      [ids.dmAllowed, ids.dmUnrelated, ids.reader, ids.peer, ids.outsider]
    );
    await db.query(
      `INSERT INTO direct_messages (id, thread_id, author_id, body, created_at)
       VALUES
         ($1, $5, $6, 'dm cursor', '2026-11-10T13:00:00Z'),
         ($2, $5, $7, 'dm own same-time', '2026-11-10T13:00:00Z'),
         ($3, $5, $6, 'dm peer same-time', '2026-11-10T13:00:00Z'),
         ($4, $8, $6, 'unrelated dm', '2026-11-10T13:01:00Z')`,
      [
        ids.d1,
        ids.d2,
        ids.d3,
        ids.d4,
        ids.dmAllowed,
        ids.peer,
        ids.reader,
        ids.dmUnrelated,
      ]
    );
    await db.exec(sqlOf(FILES[8]));
  }, 60_000);

  afterEach(async () => {
    await db.query('DELETE FROM chat_channel_read_cursors');
    await db.query('DELETE FROM direct_message_read_cursors');
    await db.query(
      `UPDATE team_memberships
       SET status = CASE WHEN team_id = $1 THEN 'Confirmed' ELSE 'Removed' END
       WHERE participant_id = $2`,
      [ids.teamAllowed, ids.reader]
    );
    await db.query(
      `UPDATE participants
       SET is_suspended = FALSE,
           suspended_at = NULL,
           suspension_reason = NULL,
           is_deactivated = FALSE,
           deactivated_at = NULL,
           deactivation_reason = NULL
       WHERE id = $1`,
      [ids.reader]
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it('counts only messages strictly after deterministic channel and DM cursors', async () => {
    await db.query(
      `INSERT INTO chat_channel_read_cursors
         (participant_id, channel_id, last_read_message_id, last_read_message_created_at)
       VALUES ($1, $2, $3, NOW())`,
      [ids.reader, ids.publicCursor, ids.c1]
    );
    await db.query(
      `INSERT INTO direct_message_read_cursors
         (participant_id, thread_id, last_read_message_id, last_read_message_created_at)
       VALUES ($1, $2, $3, NOW())`,
      [ids.reader, ids.dmAllowed, ids.d1]
    );

    const result = countMap(await countsFor());
    expect(result.get(`channel:${ids.publicCursor}`)).toBe(1);
    expect(result.get(`direct_message:${ids.dmAllowed}`)).toBe(1);
  });

  it('treats peer messages as unread without a cursor and excludes own messages', async () => {
    const result = countMap(await countsFor());
    expect(result.get(`channel:${ids.publicNoCursor}`)).toBe(1);
    expect(result.get(`channel:${ids.publicZero}`)).toBe(0);
    expect(result.get(`channel:${ids.publicCursor}`)).toBe(2);
    expect(result.get(`direct_message:${ids.dmAllowed}`)).toBe(2);
  });

  it('returns explicit zero counts when channel and DM cursors are at the latest message', async () => {
    await db.query(
      `INSERT INTO chat_channel_read_cursors
         (participant_id, channel_id, last_read_message_id, last_read_message_created_at)
       VALUES ($1, $2, $3, NOW())`,
      [ids.reader, ids.publicCursor, ids.c3]
    );
    await db.query(
      `INSERT INTO direct_message_read_cursors
         (participant_id, thread_id, last_read_message_id, last_read_message_created_at)
       VALUES ($1, $2, $3, NOW())`,
      [ids.reader, ids.dmAllowed, ids.d3]
    );

    const result = countMap(await countsFor());
    expect(result.get(`channel:${ids.publicCursor}`)).toBe(0);
    expect(result.get(`direct_message:${ids.dmAllowed}`)).toBe(0);
  });

  it('returns team counts only while Confirmed membership currently authorizes access', async () => {
    let result = countMap(await countsFor());
    expect(result.get(`channel:${ids.teamChannelAllowed}`)).toBe(1);
    expect(result.has(`channel:${ids.teamChannelDenied}`)).toBe(false);

    await db.query(
      "UPDATE team_memberships SET status = 'Removed' WHERE team_id = $1 AND participant_id = $2",
      [ids.teamAllowed, ids.reader]
    );
    result = countMap(await countsFor());
    expect(result.has(`channel:${ids.teamChannelAllowed}`)).toBe(false);
  });

  it('never returns an unrelated direct-message thread', async () => {
    const result = countMap(await countsFor());
    expect(result.get(`direct_message:${ids.dmAllowed}`)).toBe(2);
    expect(result.has(`direct_message:${ids.dmUnrelated}`)).toBe(false);
  });

  it('returns no conversations for an unavailable or ineligible participant', async () => {
    expect(await countsFor('ffffffff-ffff-4fff-8fff-ffffffffffff')).toEqual([]);

    await db.query(
      `UPDATE participants
       SET is_suspended = TRUE,
           suspended_at = NOW(),
           suspension_reason = 'test suspension'
       WHERE id = $1`,
      [ids.reader]
    );
    expect(await countsFor()).toEqual([]);
  });

  it('omits a deleted public channel and lets its cursor cascade safely', async () => {
    const channelId = '90000000-0000-4000-8000-000000000001';
    const messageId = '91000000-0000-4000-8000-000000000001';
    await db.query(
      `INSERT INTO chat_channels (id, title, description, created_by)
       VALUES ($1, 'Temporary', 'Temporary public channel', $2)`,
      [channelId, ids.reader]
    );
    await db.query(
      `INSERT INTO chat_messages (id, channel_id, author_id, body)
       VALUES ($1, $2, $3, 'temporary message')`,
      [messageId, channelId, ids.peer]
    );
    await db.query(
      `INSERT INTO chat_channel_read_cursors
         (participant_id, channel_id, last_read_message_id, last_read_message_created_at)
       VALUES ($1, $2, $3, NOW())`,
      [ids.reader, channelId, messageId]
    );
    await db.query('DELETE FROM chat_channels WHERE id = $1', [channelId]);

    const result = countMap(await countsFor());
    expect(result.has(`channel:${channelId}`)).toBe(false);
    expect(
      await rows('SELECT * FROM chat_channel_read_cursors WHERE channel_id = $1', [channelId])
    ).toEqual([]);
  });

  it('returns a count-only projection and exposes no chat or account content', async () => {
    const result = await countsFor();
    expect(Object.keys(result[0]).sort()).toEqual([
      'conversation_id',
      'conversation_type',
      'unread_count',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/body|email|password|otp|token|firebase|cursor message/i);
  });

  it('is service-role-only and uses the #398 deterministic tuple/indexes', async () => {
    const grants = await rows<{ grantee: string }>(
      `SELECT grantee FROM information_schema.routine_privileges
       WHERE routine_name = 'get_participant_chat_unread_counts'
       ORDER BY grantee`
    );
    const grantees = grants.map((row) => row.grantee);
    expect(grantees).toContain('service_role');
    expect(grantees).not.toContain('PUBLIC');
    expect(grantees).not.toContain('anon');
    expect(grantees).not.toContain('authenticated');

    const sql = sqlOf(FILES[8]);
    expect(sql).toMatch(/\(m\.created_at,\s*m\.id\)\s*>/i);
    expect(sql).not.toMatch(/CREATE\s+INDEX|ALTER\s+TABLE|CREATE\s+TABLE/i);
    const indexes = await rows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN (
         'idx_chat_messages_channel_created_id',
         'idx_direct_messages_thread_created_id'
       ) ORDER BY indexname`
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      'idx_chat_messages_channel_created_id',
      'idx_direct_messages_thread_created_id',
    ]);
  });

  it('uses the unique next migration number after the committed #398 migration', () => {
    const migrationFiles = fs.readdirSync(DIR);
    expect(migrationFiles.filter((file) => file.startsWith('0059_'))).toEqual([
      '0059_create_chat_unread_count_query.sql',
    ]);
    expect(migrationFiles).toContain('0058_create_chat_read_cursors.sql');
  });
});
