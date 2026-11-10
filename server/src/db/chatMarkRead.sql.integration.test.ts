/**
 * US-034 / #401 — atomic monotonic channel/DM mark-read and derived unread
 * message/mention counts verified against the real 0058–0061 SQL.
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
  '0004_create_profile_tables.sql',
  '0041_create_chat_channel_message_models.sql',
  '0051_add_team_channel_linkage_to_chat_channels.sql',
  '0053_create_direct_message_threads.sql',
  '0054_create_participant_blocks.sql',
  '0055_create_direct_messages.sql',
  '0058_create_chat_read_cursors.sql',
  '0059_create_chat_unread_count_query.sql',
  '0060_create_chat_message_mentions.sql',
  '0061_create_atomic_chat_mark_read.sql',
] as const;
const sqlOf = (file: (typeof FILES)[number]): string =>
  fs.readFileSync(path.join(DIR, file), 'utf8');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> => (await db.query(sql, params)).rows as T[];
const failure = async (sql: string, params?: unknown[]): Promise<string> => {
  try {
    await db.query(sql, params);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

const ids = {
  reader: '10000000-0000-4000-8000-000000000001',
  peer: '20000000-0000-4000-8000-000000000002',
  outsider: '30000000-0000-4000-8000-000000000003',
  publicChannel: '40000000-0000-4000-8000-000000000004',
  allowedTeam: '50000000-0000-4000-8000-000000000005',
  deniedTeam: '50000000-0000-4000-8000-000000000006',
  allowedTeamChannel: '60000000-0000-4000-8000-000000000006',
  deniedTeamChannel: '60000000-0000-4000-8000-000000000007',
  dm: '70000000-0000-4000-8000-000000000007',
  unrelatedDm: '70000000-0000-4000-8000-000000000008',
  c1: '80000000-0000-4000-8000-000000000001',
  c2: '80000000-0000-4000-8000-000000000002',
  c3: '80000000-0000-4000-8000-000000000003',
  team1: '81000000-0000-4000-8000-000000000001',
  team2: '81000000-0000-4000-8000-000000000002',
  deniedTeamMessage: '81000000-0000-4000-8000-000000000003',
  d1: '90000000-0000-4000-8000-000000000001',
  d2: '90000000-0000-4000-8000-000000000002',
  d3: '90000000-0000-4000-8000-000000000003',
  unrelatedDmMessage: '91000000-0000-4000-8000-000000000001',
} as const;

interface MarkRow {
  conversation_type: 'channel' | 'direct_message';
  conversation_id: string;
  last_read_message_id: string;
  last_read_message_created_at: Date;
  advanced: boolean;
  unread_count: number | bigint;
  unread_mention_count: number | bigint;
}

const mark = async (
  type: 'channel' | 'direct_message',
  conversationId: string,
  messageId: string,
  participantId = ids.reader
): Promise<MarkRow> => (
  await rows<MarkRow>(
    'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
    [participantId, type, conversationId, messageId]
  )
)[0];

describe('atomic chat mark-read on real SQL (US-034 / #401)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    for (let index = 0; index <= 4; index += 1) await db.exec(sqlOf(FILES[index]));
    await db.exec(
      `CREATE TABLE teams (
         id UUID PRIMARY KEY,
         recruitment_status VARCHAR(20) NOT NULL DEFAULT 'Open'
       );
       CREATE TABLE team_memberships (
         team_id UUID NOT NULL REFERENCES teams(id),
         participant_id UUID NOT NULL REFERENCES participants(id),
         status VARCHAR(20) NOT NULL,
         PRIMARY KEY (team_id, participant_id)
       );`
    );
    for (let index = 5; index <= 10; index += 1) await db.exec(sqlOf(FILES[index]));
    await db.exec(
      "ALTER TABLE participant_profiles ADD COLUMN moderation_status VARCHAR(30) NOT NULL DEFAULT 'None'"
    );

    for (const [id, key] of [
      [ids.reader, 'reader'],
      [ids.peer, 'peer'],
      [ids.outsider, 'outsider'],
    ] as const) {
      await db.query(
        `INSERT INTO participants
           (id, firebase_uid, email, full_name, role, is_verified)
         VALUES ($1, $2, $3, $4, 'PART', TRUE)`,
        [id, `fb-${key}`, `${key}@example.test`, key]
      );
    }
    await db.query(
      `INSERT INTO participant_profiles
         (participant_id, handle, moderation_status)
       VALUES ($1, 'reader_1', 'None'),
              ($2, 'peer_1', 'None'),
              ($3, 'outsider_1', 'None')`,
      [ids.reader, ids.peer, ids.outsider]
    );

    await db.query('INSERT INTO teams (id) VALUES ($1), ($2)', [
      ids.allowedTeam,
      ids.deniedTeam,
    ]);
    await db.query(
      `INSERT INTO team_memberships (team_id, participant_id, status)
       VALUES
         ($1, $3, 'Confirmed'),
         ($1, $4, 'Confirmed'),
         ($2, $3, 'Removed'),
         ($2, $4, 'Confirmed')`,
      [ids.allowedTeam, ids.deniedTeam, ids.reader, ids.peer]
    );
    await db.query(
      `INSERT INTO chat_channels
         (id, title, description, created_by, channel_type, team_id)
       VALUES
         ($1, 'Public', 'Public forum', $4, 'public', NULL),
         ($2, 'Allowed team', 'Private', $4, 'team', $5),
         ($3, 'Denied team', 'Private', $4, 'team', $6)`,
      [
        ids.publicChannel,
        ids.allowedTeamChannel,
        ids.deniedTeamChannel,
        ids.peer,
        ids.allowedTeam,
        ids.deniedTeam,
      ]
    );
    await db.query(
      `INSERT INTO direct_message_threads
         (id, participant_low_id, participant_high_id)
       VALUES ($1, $3, $4), ($2, $4, $5)`,
      [ids.dm, ids.unrelatedDm, ids.reader, ids.peer, ids.outsider]
    );

    await db.exec(sqlOf(FILES[11]));
    await db.query(
      `INSERT INTO chat_messages (id, channel_id, author_id, body, created_at)
       VALUES
         ($1, $7, $8, '@reader_1 first', '2026-11-10T12:00:00Z'),
         ($2, $7, $8, 'second', '2026-11-10T12:00:00Z'),
         ($3, $7, $8, '@reader_1 third', '2026-11-10T12:00:00Z'),
         ($4, $9, $8, '@reader_1 team first', '2026-11-10T12:01:00Z'),
         ($5, $9, $8, '@reader_1 team second', '2026-11-10T12:02:00Z'),
         ($6, $10, $8, '@reader_1 denied team', '2026-11-10T12:03:00Z')`,
      [
        ids.c1,
        ids.c2,
        ids.c3,
        ids.team1,
        ids.team2,
        ids.deniedTeamMessage,
        ids.publicChannel,
        ids.peer,
        ids.allowedTeamChannel,
        ids.deniedTeamChannel,
      ]
    );
    await db.query(
      `INSERT INTO direct_messages (id, thread_id, author_id, body, created_at)
       VALUES
         ($1, $5, $6, '@reader_1 dm first', '2026-11-10T13:00:00Z'),
         ($2, $5, $6, 'dm second', '2026-11-10T13:00:00Z'),
         ($3, $5, $6, '@reader_1 dm third', '2026-11-10T13:00:00Z'),
         ($4, $7, $6, '@outsider_1 unrelated', '2026-11-10T13:01:00Z')`,
      [
        ids.d1,
        ids.d2,
        ids.d3,
        ids.unrelatedDmMessage,
        ids.dm,
        ids.peer,
        ids.unrelatedDm,
      ]
    );
    await db.exec(sqlOf(FILES[12]));
  }, 60_000);

  afterEach(async () => {
    await db.query('DELETE FROM chat_channel_read_cursors');
    await db.query('DELETE FROM direct_message_read_cursors');
    await db.query(
      `UPDATE team_memberships
       SET status = CASE WHEN team_id = $1 THEN 'Confirmed' ELSE 'Removed' END
       WHERE participant_id = $2`,
      [ids.allowedTeam, ids.reader]
    );
    await db.query(
      `UPDATE participants
       SET is_suspended = FALSE,
           suspended_at = NULL,
           suspension_reason = NULL
       WHERE id = $1`,
      [ids.reader]
    );
  });

  afterAll(async () => db?.close());

  it('creates a channel cursor and returns counts only after the requested deterministic position', async () => {
    const result = await mark('channel', ids.publicChannel, ids.c1);
    expect(result).toMatchObject({
      conversation_type: 'channel',
      conversation_id: ids.publicChannel,
      last_read_message_id: ids.c1,
      advanced: true,
      unread_count: 2,
      unread_mention_count: 1,
    });
  });

  it('is idempotent and never moves a channel cursor backward', async () => {
    expect((await mark('channel', ids.publicChannel, ids.c3)).advanced).toBe(true);
    const repeated = await mark('channel', ids.publicChannel, ids.c3);
    expect(repeated.advanced).toBe(false);
    expect(repeated.last_read_message_id).toBe(ids.c3);

    const older = await mark('channel', ids.publicChannel, ids.c1);
    expect(older.advanced).toBe(false);
    expect(older.last_read_message_id).toBe(ids.c3);
    expect(Number(older.unread_count)).toBe(0);
    expect(Number(older.unread_mention_count)).toBe(0);
  });

  it('keeps messages and mentions after the cursor unread and clears them at the latest message', async () => {
    const middle = await mark('channel', ids.publicChannel, ids.c2);
    expect(Number(middle.unread_count)).toBe(1);
    expect(Number(middle.unread_mention_count)).toBe(1);

    const latest = await mark('channel', ids.publicChannel, ids.c3);
    expect(Number(latest.unread_count)).toBe(0);
    expect(Number(latest.unread_mention_count)).toBe(0);
  });

  it('applies the same monotonic behavior and mention clearing to a DM thread', async () => {
    const first = await mark('direct_message', ids.dm, ids.d1);
    expect(first).toMatchObject({
      advanced: true,
      unread_count: 2,
      unread_mention_count: 1,
    });
    const latest = await mark('direct_message', ids.dm, ids.d3);
    expect(Number(latest.unread_count)).toBe(0);
    expect(Number(latest.unread_mention_count)).toBe(0);
    expect((await mark('direct_message', ids.dm, ids.d1)).last_read_message_id).toBe(ids.d3);
  });

  it('rejects wrong-conversation and missing positions without changing a cursor', async () => {
    expect(await failure(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [ids.reader, 'channel', ids.publicChannel, ids.d1]
    )).toMatch(/CHAT_MARK_READ_POSITION_NOT_FOUND/);
    expect(await failure(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [ids.reader, 'channel', ids.publicChannel, 'ffffffff-ffff-4fff-8fff-ffffffffffff']
    )).toMatch(/CHAT_MARK_READ_POSITION_NOT_FOUND/);
    expect(await rows('SELECT * FROM chat_channel_read_cursors')).toEqual([]);
  });

  it('denies inaccessible team channels and unrelated DMs before creating cursor state', async () => {
    expect(await failure(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [ids.reader, 'channel', ids.deniedTeamChannel, ids.deniedTeamMessage]
    )).toMatch(/CHAT_MARK_READ_TEAM_ACCESS_DENIED/);
    expect(await failure(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [ids.reader, 'direct_message', ids.unrelatedDm, ids.unrelatedDmMessage]
    )).toMatch(/CHAT_MARK_READ_DM_ACCESS_DENIED/);
    expect(await rows('SELECT * FROM chat_channel_read_cursors')).toEqual([]);
    expect(await rows('SELECT * FROM direct_message_read_cursors')).toEqual([]);
  });

  it('cannot update a private-team cursor after Confirmed access is lost', async () => {
    await mark('channel', ids.allowedTeamChannel, ids.team1);
    await db.query(
      "UPDATE team_memberships SET status = 'Removed' WHERE team_id = $1 AND participant_id = $2",
      [ids.allowedTeam, ids.reader]
    );
    expect(await failure(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [ids.reader, 'channel', ids.allowedTeamChannel, ids.team2]
    )).toMatch(/CHAT_MARK_READ_TEAM_ACCESS_DENIED/);
    const cursor = await rows<{ last_read_message_id: string }>(
      'SELECT last_read_message_id FROM chat_channel_read_cursors WHERE participant_id = $1 AND channel_id = $2',
      [ids.reader, ids.allowedTeamChannel]
    );
    expect(cursor[0].last_read_message_id).toBe(ids.team1);
  });

  it('cannot finish behind when concurrent newer and older updates race', async () => {
    await Promise.all([
      mark('channel', ids.publicChannel, ids.c3),
      mark('channel', ids.publicChannel, ids.c1),
    ]);
    const cursor = await rows<{ last_read_message_id: string }>(
      'SELECT last_read_message_id FROM chat_channel_read_cursors WHERE participant_id = $1 AND channel_id = $2',
      [ids.reader, ids.publicChannel]
    );
    expect(cursor[0].last_read_message_id).toBe(ids.c3);
  });

  it('returns refresh-safe activity counts and no rows for an ineligible participant', async () => {
    const counts = await rows<{
      conversation_type: string;
      conversation_id: string;
      unread_count: number | bigint;
      unread_mention_count: number | bigint;
    }>('SELECT * FROM get_participant_chat_activity_counts($1)', [ids.reader]);
    const publicCount = counts.find((row) => row.conversation_id === ids.publicChannel);
    expect(Number(publicCount?.unread_count)).toBe(3);
    expect(Number(publicCount?.unread_mention_count)).toBe(2);

    await db.query(
      `UPDATE participants
       SET is_suspended = TRUE,
           suspended_at = NOW(),
           suspension_reason = 'mark-read test'
       WHERE id = $1`,
      [ids.reader]
    );
    expect(await rows('SELECT * FROM get_participant_chat_activity_counts($1)', [ids.reader])).toEqual([]);
    expect(await failure(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [ids.reader, 'channel', ids.publicChannel, ids.c1]
    )).toMatch(/CHAT_MARK_READ_NOT_ELIGIBLE/);
  });

  it('returns only safe cursor/count fields and keeps both RPCs service-role-only', async () => {
    const result = await mark('channel', ids.publicChannel, ids.c1);
    expect(Object.keys(result).sort()).toEqual([
      'advanced',
      'conversation_id',
      'conversation_type',
      'last_read_message_created_at',
      'last_read_message_id',
      'unread_count',
      'unread_mention_count',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/body|email|password|otp|token|firebase/i);

    const grants = await rows<{ routine_name: string; grantee: string }>(
      `SELECT routine_name, grantee
       FROM information_schema.routine_privileges
       WHERE routine_name IN (
         'get_participant_chat_activity_counts',
         'mark_chat_conversation_read'
       )`
    );
    for (const routine of [
      'get_participant_chat_activity_counts',
      'mark_chat_conversation_read',
    ]) {
      const grantees = grants
        .filter((row) => row.routine_name === routine)
        .map((row) => row.grantee);
      expect(grantees).toContain('service_role');
      expect(grantees).not.toContain('PUBLIC');
      expect(grantees).not.toContain('anon');
      expect(grantees).not.toContain('authenticated');
    }
  });

  it('is additive/idempotent and uses the unique next migration number', async () => {
    await expect(db.exec(sqlOf(FILES[12]))).resolves.not.toThrow();
    const migrationFiles = fs.readdirSync(DIR);
    expect(migrationFiles.filter((file) => file.startsWith('0061_'))).toEqual([
      '0061_create_atomic_chat_mark_read.sql',
    ]);
    expect(migrationFiles).toContain('0060_create_chat_message_mentions.sql');
  });
});
