/**
 * US-034 / #403 — cohesive message -> mention -> unread -> mark-read ->
 * refreshed-count verification against the real 0058–0061 SQL. PGlite keeps
 * this integration suite deterministic and independent of external services.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');
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
  fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');

const ids = {
  reader: '10000000-0000-4000-8000-000000000001',
  peer: '20000000-0000-4000-8000-000000000002',
  outsider: '30000000-0000-4000-8000-000000000003',
  team: '40000000-0000-4000-8000-000000000004',
  publicChannel: '50000000-0000-4000-8000-000000000005',
  teamChannel: '60000000-0000-4000-8000-000000000006',
  dm: '70000000-0000-4000-8000-000000000007',
  unrelatedDm: '70000000-0000-4000-8000-000000000008',
  m1: '80000000-0000-4000-8000-000000000001',
  m2: '80000000-0000-4000-8000-000000000002',
  m3: '80000000-0000-4000-8000-000000000003',
  d1: '90000000-0000-4000-8000-000000000001',
  d2: '90000000-0000-4000-8000-000000000002',
  d3: '90000000-0000-4000-8000-000000000003',
} as const;

interface ActivityRow {
  conversation_type: 'channel' | 'direct_message';
  conversation_id: string;
  unread_count: number | bigint;
  unread_mention_count: number | bigint;
}

interface MarkRow extends ActivityRow {
  last_read_message_id: string;
  last_read_message_created_at: Date;
  advanced: boolean;
}

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

async function activity(participantId: string = ids.reader): Promise<ActivityRow[]> {
  return rows<ActivityRow>('SELECT * FROM get_participant_chat_activity_counts($1)', [
    participantId,
  ]);
}

function findActivity(
  result: ActivityRow[],
  type: ActivityRow['conversation_type'],
  conversationId: string
): { unread: number; mentions: number } | undefined {
  const row = result.find(
    (item) =>
      item.conversation_type === type && item.conversation_id === conversationId
  );
  return row
    ? {
        unread: Number(row.unread_count),
        mentions: Number(row.unread_mention_count),
      }
    : undefined;
}

async function mark(
  type: ActivityRow['conversation_type'],
  conversationId: string,
  messageId: string,
  participantId = ids.reader
): Promise<MarkRow> {
  return (
    await rows<MarkRow>(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [participantId, type, conversationId, messageId]
    )
  )[0];
}

async function channelMessage(input: {
  id: string;
  channelId?: string;
  authorId?: string;
  body: string;
  createdAt: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO chat_messages (id, channel_id, author_id, body, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.id,
      input.channelId ?? ids.publicChannel,
      input.authorId ?? ids.peer,
      input.body,
      input.createdAt,
    ]
  );
}

async function directMessage(input: {
  id: string;
  threadId?: string;
  authorId?: string;
  body: string;
  createdAt: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO direct_messages (id, thread_id, author_id, body, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.id,
      input.threadId ?? ids.dm,
      input.authorId ?? ids.peer,
      input.body,
      input.createdAt,
    ]
  );
}

describe('US-034 unread and mention accuracy on real SQL (#403)', () => {
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
    await db.query('INSERT INTO teams (id) VALUES ($1)', [ids.team]);
    await db.query(
      `INSERT INTO team_memberships (team_id, participant_id, status)
       VALUES ($1, $2, 'Confirmed'),
              ($1, $3, 'Confirmed'),
              ($1, $4, 'Removed')`,
      [ids.team, ids.reader, ids.peer, ids.outsider]
    );
    await db.query(
      `INSERT INTO chat_channels
         (id, title, description, created_by, channel_type, team_id)
       VALUES ($1, 'Public accuracy', 'Public', $3, 'public', NULL),
              ($2, 'Team accuracy', 'Private', $3, 'team', $4)`,
      [ids.publicChannel, ids.teamChannel, ids.peer, ids.team]
    );
    await db.query(
      `INSERT INTO direct_message_threads
         (id, participant_low_id, participant_high_id)
       VALUES ($1, $3, $4), ($2, $4, $5)`,
      [ids.dm, ids.unrelatedDm, ids.reader, ids.peer, ids.outsider]
    );
    await db.exec(sqlOf(FILES[11]));
    await db.exec(sqlOf(FILES[12]));
  }, 60_000);

  afterEach(async () => {
    await db.query('DELETE FROM chat_channel_read_cursors');
    await db.query('DELETE FROM direct_message_read_cursors');
    await db.query('DELETE FROM chat_messages');
    await db.query('DELETE FROM direct_messages');
    await db.query(
      `INSERT INTO direct_message_threads
         (id, participant_low_id, participant_high_id)
       VALUES ($1, $3, $4), ($2, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [ids.dm, ids.unrelatedDm, ids.reader, ids.peer, ids.outsider]
    );
    await db.query(
      `UPDATE team_memberships
       SET status = CASE WHEN participant_id = $1 THEN 'Removed' ELSE 'Confirmed' END
       WHERE team_id = $2`,
      [ids.outsider, ids.team]
    );
    await db.query(
      `UPDATE participants
       SET is_suspended = FALSE,
           suspended_at = NULL,
           suspension_reason = NULL,
           is_deactivated = FALSE,
           deactivated_at = NULL,
           deactivation_reason = NULL
       WHERE id IN ($1, $2, $3)`,
      [ids.reader, ids.peer, ids.outsider]
    );
    await db.query(
      `UPDATE participant_profiles
       SET handle = CASE participant_id
         WHEN $1 THEN 'reader_1'
         WHEN $2 THEN 'peer_1'
         ELSE 'outsider_1'
       END
       WHERE participant_id IN ($1, $2, $3)`,
      [ids.reader, ids.peer, ids.outsider]
    );
  });

  afterAll(async () => db?.close());

  it('increments public, team, and DM counts per participant while excluding own messages', async () => {
    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 0,
      mentions: 0,
    });

    await channelMessage({
      id: ids.m1,
      body: 'first public update',
      createdAt: '2026-11-10T12:00:00Z',
    });
    await channelMessage({
      id: ids.m2,
      channelId: ids.teamChannel,
      body: 'team update',
      createdAt: '2026-11-10T12:01:00Z',
    });
    await directMessage({
      id: ids.d1,
      body: 'direct update',
      createdAt: '2026-11-10T12:02:00Z',
    });

    let reader = await activity();
    expect(findActivity(reader, 'channel', ids.publicChannel)?.unread).toBe(1);
    expect(findActivity(reader, 'channel', ids.teamChannel)?.unread).toBe(1);
    expect(findActivity(reader, 'direct_message', ids.dm)?.unread).toBe(1);

    await channelMessage({
      id: ids.m3,
      authorId: ids.reader,
      body: 'reader reply',
      createdAt: '2026-11-10T12:03:00Z',
    });
    reader = await activity();
    expect(findActivity(reader, 'channel', ids.publicChannel)?.unread).toBe(1);
    expect(findActivity(await activity(ids.peer), 'channel', ids.publicChannel)?.unread).toBe(1);
  });

  it('categorizes deterministic mentions without duplicates and preserves stable identity', async () => {
    await channelMessage({
      id: ids.m1,
      body: '@READER_1 @reader_1 @outsider_1 email@example.test @@ghost @a',
      createdAt: '2026-11-10T13:00:00Z',
    });
    const metadata = await rows<{
      mentioned_participant_id: string;
      message_id: string;
      created_at: Date;
    }>(
      `SELECT * FROM chat_message_mentions
       WHERE message_id = $1
       ORDER BY mentioned_participant_id`,
      [ids.m1]
    );
    expect(metadata.map((row) => row.mentioned_participant_id)).toEqual([
      ids.reader,
      ids.outsider,
    ]);
    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 1,
      mentions: 1,
    });
    expect(findActivity(await activity(ids.outsider), 'channel', ids.publicChannel)).toEqual({
      unread: 1,
      mentions: 1,
    });

    await db.query(
      "UPDATE participant_profiles SET handle = 'reader_renamed' WHERE participant_id = $1",
      [ids.reader]
    );
    expect(
      (await rows<{ mentioned_participant_id: string }>(
        `SELECT mentioned_participant_id
         FROM chat_message_mentions
         WHERE message_id = $1
         ORDER BY mentioned_participant_id`,
        [ids.m1]
      )).map((row) => row.mentioned_participant_id)
    ).toEqual([ids.reader, ids.outsider]);

    await db.query(
      `UPDATE participants
       SET is_suspended = TRUE,
           suspended_at = NOW(),
           suspension_reason = 'accuracy test'
       WHERE id = $1`,
      [ids.reader]
    );
    expect(await activity()).toEqual([]);
    expect(Object.keys(metadata[0]).sort()).toEqual([
      'created_at',
      'mentioned_participant_id',
      'message_id',
    ]);
    expect(JSON.stringify(metadata)).not.toMatch(/email|handle|password|otp|token|firebase/i);
  });

  it('clears only activity at or before the cursor and persists it across a fresh query', async () => {
    for (const [id, body] of [
      [ids.m1, '@reader_1 first'],
      [ids.m2, 'middle'],
      [ids.m3, '@reader_1 last'],
    ] as const) {
      await channelMessage({
        id,
        body,
        createdAt: '2026-11-10T14:00:00Z',
      });
    }

    const middle = await mark('channel', ids.publicChannel, ids.m2);
    expect(middle).toMatchObject({
      last_read_message_id: ids.m2,
      advanced: true,
      unread_count: 1,
      unread_mention_count: 1,
    });
    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 1,
      mentions: 1,
    });

    const older = await mark('channel', ids.publicChannel, ids.m1);
    expect(older.advanced).toBe(false);
    expect(older.last_read_message_id).toBe(ids.m2);
    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 1,
      mentions: 1,
    });

    expect((await mark('channel', ids.publicChannel, ids.m3)).advanced).toBe(true);
    expect((await mark('channel', ids.publicChannel, ids.m3)).advanced).toBe(false);
    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 0,
      mentions: 0,
    });
  });

  it('orders concurrent same-time messages deterministically and never finishes behind', async () => {
    await channelMessage({
      id: ids.m1,
      body: 'baseline',
      createdAt: '2026-11-10T15:00:00Z',
    });
    await mark('channel', ids.publicChannel, ids.m1);

    await Promise.all([
      channelMessage({
        id: ids.m3,
        body: '@reader_1 higher id',
        createdAt: '2026-11-10T15:01:00Z',
      }),
      channelMessage({
        id: ids.m2,
        body: 'lower id',
        createdAt: '2026-11-10T15:01:00Z',
      }),
    ]);
    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 2,
      mentions: 1,
    });

    const lower = await mark('channel', ids.publicChannel, ids.m2);
    expect(Number(lower.unread_count)).toBe(1);
    expect(Number(lower.unread_mention_count)).toBe(1);

    await Promise.all([
      mark('channel', ids.publicChannel, ids.m3),
      mark('channel', ids.publicChannel, ids.m2),
    ]);
    const cursor = await rows<{ last_read_message_id: string }>(
      `SELECT last_read_message_id
       FROM chat_channel_read_cursors
       WHERE participant_id = $1 AND channel_id = $2`,
      [ids.reader, ids.publicChannel]
    );
    expect(cursor[0].last_read_message_id).toBe(ids.m3);
    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 0,
      mentions: 0,
    });
  });

  it('counts a message committed while mark-read runs without moving or skipping the cursor', async () => {
    await channelMessage({
      id: ids.m1,
      body: 'seen baseline',
      createdAt: '2026-11-10T16:00:00Z',
    });
    await Promise.all([
      mark('channel', ids.publicChannel, ids.m1),
      channelMessage({
        id: ids.m2,
        body: '@reader_1 arrived concurrently',
        createdAt: '2026-11-10T16:01:00Z',
      }),
    ]);

    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 1,
      mentions: 1,
    });
    expect(
      (await rows<{ last_read_message_id: string }>(
        `SELECT last_read_message_id FROM chat_channel_read_cursors
         WHERE participant_id = $1 AND channel_id = $2`,
        [ids.reader, ids.publicChannel]
      ))[0].last_read_message_id
    ).toBe(ids.m1);
  });

  it('omits unauthorized private activity and fails mark-read without content leakage', async () => {
    await channelMessage({
      id: ids.m1,
      channelId: ids.teamChannel,
      body: 'private team secret @reader_1',
      createdAt: '2026-11-10T17:00:00Z',
    });
    await directMessage({
      id: ids.d1,
      body: 'private direct secret @reader_1',
      createdAt: '2026-11-10T17:01:00Z',
    });
    await directMessage({
      id: ids.d2,
      threadId: ids.unrelatedDm,
      authorId: ids.peer,
      body: 'unrelated direct secret @outsider_1',
      createdAt: '2026-11-10T17:02:00Z',
    });

    const outsider = await activity(ids.outsider);
    expect(findActivity(outsider, 'channel', ids.teamChannel)).toBeUndefined();
    expect(findActivity(outsider, 'direct_message', ids.dm)).toBeUndefined();
    expect(JSON.stringify(outsider)).not.toMatch(
      /private team secret|private direct secret|email|password|otp|token|firebase/i
    );

    await db.query(
      "UPDATE team_memberships SET status = 'Removed' WHERE team_id = $1 AND participant_id = $2",
      [ids.team, ids.reader]
    );
    expect(findActivity(await activity(), 'channel', ids.teamChannel)).toBeUndefined();
    const teamDenial = await failure(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [ids.reader, 'channel', ids.teamChannel, ids.m1]
    );
    expect(teamDenial).toMatch(/CHAT_MARK_READ_TEAM_ACCESS_DENIED/);
    expect(teamDenial).not.toMatch(/private team secret|reader@example/i);

    const dmDenial = await failure(
      'SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)',
      [ids.outsider, 'direct_message', ids.dm, ids.d1]
    );
    expect(dmDenial).toMatch(/CHAT_MARK_READ_DM_ACCESS_DENIED/);
    expect(dmDenial).not.toMatch(/private direct secret|reader@example/i);
  });

  it('keeps stale cursor ordering safe and omits deleted conversations on refresh', async () => {
    await channelMessage({
      id: ids.m1,
      body: 'cursor target',
      createdAt: '2026-11-10T18:00:00Z',
    });
    await mark('channel', ids.publicChannel, ids.m1);
    await db.query('DELETE FROM chat_messages WHERE id = $1', [ids.m1]);
    await channelMessage({
      id: ids.m2,
      body: 'after deleted cursor target',
      createdAt: '2026-11-10T18:01:00Z',
    });
    expect(findActivity(await activity(), 'channel', ids.publicChannel)).toEqual({
      unread: 1,
      mentions: 0,
    });

    await directMessage({
      id: ids.d1,
      body: 'temporary DM',
      createdAt: '2026-11-10T18:02:00Z',
    });
    await mark('direct_message', ids.dm, ids.d1);
    await db.query('DELETE FROM direct_messages WHERE thread_id = $1', [ids.dm]);
    await db.query('DELETE FROM direct_message_threads WHERE id = $1', [ids.dm]);

    const refreshed = await activity();
    expect(findActivity(refreshed, 'direct_message', ids.dm)).toBeUndefined();
    expect(
      await rows('SELECT * FROM direct_message_read_cursors WHERE thread_id = $1', [ids.dm])
    ).toEqual([]);
  });
});

