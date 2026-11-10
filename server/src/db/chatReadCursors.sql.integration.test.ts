/**
 * US-034 / #398 — durable per-participant channel and DM read cursors verified
 * against the real 0058 SQL in an in-process PostgreSQL-compatible database.
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
  '0041_create_chat_channel_message_models.sql',
  '0051_add_team_channel_linkage_to_chat_channels.sql',
  '0053_create_direct_message_threads.sql',
  '0055_create_direct_messages.sql',
  '0058_create_chat_read_cursors.sql',
] as const;
const sqlOf = (file: (typeof FILES)[number]): string =>
  fs.readFileSync(path.join(DIR, file), 'utf8');

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
  channelA: '50000000-0000-4000-8000-000000000005',
  channelB: '50000000-0000-4000-8000-000000000006',
  team: '51000000-0000-4000-8000-000000000005',
  teamChannel: '52000000-0000-4000-8000-000000000005',
  threadA: '60000000-0000-4000-8000-000000000006',
  threadB: '60000000-0000-4000-8000-000000000007',
  channelMessage1: '70000000-0000-4000-8000-000000000001',
  channelMessage2: '70000000-0000-4000-8000-000000000002',
  channelMessage3: '70000000-0000-4000-8000-000000000003',
  otherChannelMessage: '70000000-0000-4000-8000-000000000004',
  teamMessage: '70000000-0000-4000-8000-000000000005',
  directMessage1: '80000000-0000-4000-8000-000000000001',
  directMessage2: '80000000-0000-4000-8000-000000000002',
  removableMessage: '90000000-0000-4000-8000-000000000001',
} as const;

async function insertChannelCursor(
  participantId: string,
  channelId: string,
  messageId: string
): Promise<void> {
  await db.query(
    `INSERT INTO chat_channel_read_cursors
       (participant_id, channel_id, last_read_message_id, last_read_message_created_at)
     VALUES ($1, $2, $3, '2000-01-01T00:00:00Z')`,
    [participantId, channelId, messageId]
  );
}

async function insertDirectCursor(
  participantId: string,
  threadId: string,
  messageId: string
): Promise<void> {
  await db.query(
    `INSERT INTO direct_message_read_cursors
       (participant_id, thread_id, last_read_message_id, last_read_message_created_at)
     VALUES ($1, $2, $3, '2000-01-01T00:00:00Z')`,
    [participantId, threadId, messageId]
  );
}

describe('chat read-cursor persistence on real SQL (US-034 / #398)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    await db.exec(sqlOf(FILES[0]));

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

    await db.exec(sqlOf(FILES[1]));
    // 0051 only needs the teams PK for its channel linkage FK in this focused model test.
    await db.exec('CREATE TABLE teams (id UUID PRIMARY KEY);');
    await db.exec(sqlOf(FILES[2]));
    await db.exec(
      `CREATE TABLE team_memberships (
         team_id UUID NOT NULL REFERENCES teams(id),
         participant_id UUID NOT NULL REFERENCES participants(id),
         status VARCHAR(20) NOT NULL
       );`
    );
    await db.exec(sqlOf(FILES[3]));
    await db.exec(sqlOf(FILES[4]));
    await db.exec(sqlOf(FILES[5]));
  }, 60_000);

  beforeAll(async () => {
    await db.query(
      `INSERT INTO chat_channels (id, title, description, created_by)
       VALUES ($1, 'Forum A', 'First public forum', $3),
              ($2, 'Forum B', 'Second public forum', $3)`,
      [ids.channelA, ids.channelB, ids.avery]
    );
    await db.query('INSERT INTO teams (id) VALUES ($1)', [ids.team]);
    await db.query(
      `INSERT INTO team_memberships (team_id, participant_id, status)
       VALUES ($1, $2, 'Confirmed'), ($1, $3, 'Removed')`,
      [ids.team, ids.avery, ids.casey]
    );
    await db.query(
      `INSERT INTO chat_channels
         (id, title, description, created_by, channel_type, team_id)
       VALUES ($1, 'Team channel', 'Private team chat', $2, 'team', $3)`,
      [ids.teamChannel, ids.avery, ids.team]
    );
    await db.query(
      `INSERT INTO chat_messages (id, channel_id, author_id, body, created_at)
       VALUES ($1, $5, $6, 'first', '2026-11-10T12:00:00Z'),
              ($2, $5, $7, 'same timestamp', '2026-11-10T12:00:00Z'),
              ($3, $5, $6, 'later', '2026-11-10T12:01:00Z'),
              ($4, $8, $6, 'other channel', '2026-11-10T12:02:00Z'),
              ($9, $10, $6, 'team message', '2026-11-10T12:03:00Z')`,
      [
        ids.channelMessage1,
        ids.channelMessage2,
        ids.channelMessage3,
        ids.otherChannelMessage,
        ids.channelA,
        ids.avery,
        ids.blake,
        ids.channelB,
        ids.teamMessage,
        ids.teamChannel,
      ]
    );
    await db.query(
      `INSERT INTO direct_message_threads
         (id, participant_low_id, participant_high_id)
       VALUES ($1, $3, $4), ($2, $3, $5)`,
      [ids.threadA, ids.threadB, ids.avery, ids.blake, ids.casey]
    );
    await db.query(
      `INSERT INTO direct_messages (id, thread_id, author_id, body, created_at)
       VALUES ($1, $3, $4, 'direct A', '2026-11-10T13:00:00Z'),
              ($2, $5, $4, 'direct B', '2026-11-10T13:01:00Z')`,
      [ids.directMessage1, ids.directMessage2, ids.threadA, ids.avery, ids.threadB]
    );
  });

  afterEach(async () => {
    await db.query('DELETE FROM chat_channel_read_cursors');
    await db.query('DELETE FROM direct_message_read_cursors');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('creates valid durable cursors for a channel and direct-message thread', async () => {
    await insertChannelCursor(ids.avery, ids.channelA, ids.channelMessage1);
    await insertDirectCursor(ids.avery, ids.threadA, ids.directMessage1);

    const channel = await rows<{
      participant_id: string;
      channel_id: string;
      last_read_message_id: string;
      last_read_message_created_at: Date;
    }>('SELECT * FROM chat_channel_read_cursors');
    expect(channel[0]).toMatchObject({
      participant_id: ids.avery,
      channel_id: ids.channelA,
      last_read_message_id: ids.channelMessage1,
    });
    expect(channel[0].last_read_message_created_at.toISOString()).toBe(
      '2026-11-10T12:00:00.000Z'
    );

    const direct = await rows<{ last_read_message_id: string }>(
      'SELECT last_read_message_id FROM direct_message_read_cursors'
    );
    expect(direct[0].last_read_message_id).toBe(ids.directMessage1);
  });

  it('enforces one cursor per participant and logical conversation', async () => {
    await insertChannelCursor(ids.avery, ids.channelA, ids.channelMessage1);
    expect(
      await fails(
        `INSERT INTO chat_channel_read_cursors
           (participant_id, channel_id, last_read_message_id, last_read_message_created_at)
         VALUES ($1, $2, $3, NOW())`,
        [ids.avery, ids.channelA, ids.channelMessage2]
      )
    ).toMatch(/pk_chat_channel_read_cursors|duplicate key|unique/i);

    await insertDirectCursor(ids.avery, ids.threadA, ids.directMessage1);
    expect(
      await fails(
        `INSERT INTO direct_message_read_cursors
           (participant_id, thread_id, last_read_message_id, last_read_message_created_at)
         VALUES ($1, $2, $3, NOW())`,
        [ids.avery, ids.threadA, ids.directMessage1]
      )
    ).toMatch(/pk_direct_message_read_cursors|duplicate key|unique/i);
  });

  it('allows independent participant cursors and multiple conversations per participant', async () => {
    await insertChannelCursor(ids.avery, ids.channelA, ids.channelMessage1);
    await insertChannelCursor(ids.blake, ids.channelA, ids.channelMessage2);
    await insertChannelCursor(ids.avery, ids.channelB, ids.otherChannelMessage);

    const cursorRows = await rows<{ participant_id: string; channel_id: string }>(
      `SELECT participant_id, channel_id FROM chat_channel_read_cursors
       ORDER BY participant_id, channel_id`
    );
    expect(cursorRows).toHaveLength(3);
    expect(cursorRows).toEqual(
      expect.arrayContaining([
        { participant_id: ids.avery, channel_id: ids.channelA },
        { participant_id: ids.blake, channel_id: ids.channelA },
        { participant_id: ids.avery, channel_id: ids.channelB },
      ])
    );
  });

  it('rejects invalid participant and conversation references', async () => {
    expect(
      await fails(
        `INSERT INTO chat_channel_read_cursors
           (participant_id, channel_id, last_read_message_id, last_read_message_created_at)
         VALUES ($1, $2, $3, NOW())`,
        [ids.missing, ids.channelA, ids.channelMessage1]
      )
    ).toMatch(/foreign key|violates/i);
    expect(
      await fails(
        `INSERT INTO direct_message_read_cursors
           (participant_id, thread_id, last_read_message_id, last_read_message_created_at)
         VALUES ($1, 'ffffffff-ffff-4fff-8fff-ffffffffffff', $2, NOW())`,
        [ids.avery, ids.directMessage1]
      )
    ).toMatch(/foreign key|violates|DIRECT_MESSAGE_READ_CURSOR_THREAD_NOT_FOUND/i);
  });

  it('rejects a cursor message that belongs to another conversation', async () => {
    expect(
      await fails(
        `INSERT INTO chat_channel_read_cursors
           (participant_id, channel_id, last_read_message_id, last_read_message_created_at)
         VALUES ($1, $2, $3, NOW())`,
        [ids.avery, ids.channelA, ids.otherChannelMessage]
      )
    ).toMatch(/CHAT_READ_CURSOR_MESSAGE_MISMATCH/);
    expect(
      await fails(
        `INSERT INTO direct_message_read_cursors
           (participant_id, thread_id, last_read_message_id, last_read_message_created_at)
         VALUES ($1, $2, $3, NOW())`,
        [ids.avery, ids.threadA, ids.directMessage2]
      )
    ).toMatch(/DIRECT_MESSAGE_READ_CURSOR_MESSAGE_MISMATCH/);
  });

  it('enforces stable team-membership and DM-participant conversation boundaries', async () => {
    await expect(
      insertChannelCursor(ids.avery, ids.teamChannel, ids.teamMessage)
    ).resolves.toBeUndefined();
    expect(
      await fails(
        `INSERT INTO chat_channel_read_cursors
           (participant_id, channel_id, last_read_message_id, last_read_message_created_at)
         VALUES ($1, $2, $3, NOW())`,
        [ids.casey, ids.teamChannel, ids.teamMessage]
      )
    ).toMatch(/CHAT_READ_CURSOR_NOT_TEAM_MEMBER/);
    expect(
      await fails(
        `INSERT INTO direct_message_read_cursors
           (participant_id, thread_id, last_read_message_id, last_read_message_created_at)
         VALUES ($1, $2, $3, NOW())`,
        [ids.casey, ids.threadA, ids.directMessage1]
      )
    ).toMatch(/DIRECT_MESSAGE_READ_CURSOR_NOT_PARTICIPANT/);
  });

  it('uses the deterministic created_at + id position when timestamps tie', async () => {
    await insertChannelCursor(ids.avery, ids.channelA, ids.channelMessage1);
    const unread = await rows<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM chat_messages m
       JOIN chat_channel_read_cursors c
         ON c.channel_id = m.channel_id AND c.participant_id = $1
       WHERE m.channel_id = $2
         AND (m.created_at, m.id) >
             (c.last_read_message_created_at, c.last_read_message_id)`,
      [ids.avery, ids.channelA]
    );
    expect(unread[0].count).toBe(2);
  });

  it('keeps persisted positions when the idempotent migration is reapplied', async () => {
    await insertChannelCursor(ids.avery, ids.channelA, ids.channelMessage2);
    await insertDirectCursor(ids.blake, ids.threadA, ids.directMessage1);

    await expect(db.exec(sqlOf(FILES[5]))).resolves.not.toThrow();

    expect(
      await rows('SELECT * FROM chat_channel_read_cursors WHERE participant_id = $1', [
        ids.avery,
      ])
    ).toHaveLength(1);
    expect(
      await rows('SELECT * FROM direct_message_read_cursors WHERE participant_id = $1', [
        ids.blake,
      ])
    ).toHaveLength(1);
  });

  it('retains a deterministic cursor if a public message is later removed', async () => {
    await db.query(
      `INSERT INTO chat_messages (id, channel_id, author_id, body, created_at)
       VALUES ($1, $2, $3, 'removable public message', '2026-11-10T12:04:00Z')`,
      [ids.removableMessage, ids.channelA, ids.avery]
    );
    await insertChannelCursor(ids.avery, ids.channelA, ids.removableMessage);
    await db.query('DELETE FROM chat_messages WHERE id = $1', [ids.removableMessage]);

    const cursor = await rows<{
      last_read_message_id: string;
      last_read_message_created_at: Date;
    }>(
      `SELECT last_read_message_id, last_read_message_created_at
       FROM chat_channel_read_cursors
       WHERE participant_id = $1 AND channel_id = $2`,
      [ids.avery, ids.channelA]
    );
    expect(cursor[0].last_read_message_id).toBe(ids.removableMessage);
    expect(cursor[0].last_read_message_created_at.toISOString()).toBe(
      '2026-11-10T12:04:00.000Z'
    );
  });

  it('creates cursor and unread-range indexes without duplicating the existing DM index', async () => {
    const indexes = await rows<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname IN (
         'pk_chat_channel_read_cursors',
         'idx_chat_channel_read_cursors_channel',
         'idx_chat_messages_channel_created_id',
         'pk_direct_message_read_cursors',
         'idx_direct_message_read_cursors_thread',
         'idx_direct_messages_thread_created_id'
       )`
    );
    const byName = Object.fromEntries(indexes.map((index) => [index.indexname, index.indexdef]));
    expect(byName.pk_chat_channel_read_cursors).toMatch(/participant_id, channel_id/i);
    expect(byName.idx_chat_channel_read_cursors_channel).toMatch(/channel_id, participant_id/i);
    expect(byName.idx_chat_messages_channel_created_id).toMatch(/channel_id, created_at, id/i);
    expect(byName.pk_direct_message_read_cursors).toMatch(/participant_id, thread_id/i);
    expect(byName.idx_direct_message_read_cursors_thread).toMatch(/thread_id, participant_id/i);
    expect(byName.idx_direct_messages_thread_created_id).toMatch(/thread_id, created_at, id/i);
  });

  it('enables RLS with no public cursor policies', async () => {
    const rls = await rows<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname IN ('chat_channel_read_cursors', 'direct_message_read_cursors')
       ORDER BY relname`
    );
    expect(rls).toEqual([
      { relname: 'chat_channel_read_cursors', relrowsecurity: true },
      { relname: 'direct_message_read_cursors', relrowsecurity: true },
    ]);
    expect(
      await rows(
        `SELECT 1 FROM pg_policies
         WHERE tablename IN ('chat_channel_read_cursors', 'direct_message_read_cursors')`
      )
    ).toEqual([]);
  });

  it('uses the unique next migration number after 0057', () => {
    const migrationFiles = fs.readdirSync(DIR);
    expect(migrationFiles.filter((file) => file.startsWith('0058_'))).toEqual([
      '0058_create_chat_read_cursors.sql',
    ]);
    expect(migrationFiles).toContain('0057_connect_chat_message_reports.sql');
  });
});
