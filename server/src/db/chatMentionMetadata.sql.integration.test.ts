/**
 * US-034 / #400 — deterministic @handle parsing and transactional mention
 * persistence verified against the real 0060 SQL in an in-process Postgres.
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
  '0060_create_chat_message_mentions.sql',
] as const;
const sqlOf = (file: (typeof FILES)[number]): string =>
  fs.readFileSync(path.join(DIR, file), 'utf8');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> => (await db.query(sql, params)).rows as T[];

const ids = {
  author: '10000000-0000-4000-8000-000000000001',
  alice: '20000000-0000-4000-8000-000000000002',
  bob: '30000000-0000-4000-8000-000000000003',
  hidden: '40000000-0000-4000-8000-000000000004',
  suspended: '50000000-0000-4000-8000-000000000005',
  unverified: '60000000-0000-4000-8000-000000000006',
  replacement: '70000000-0000-4000-8000-000000000007',
  team: '80000000-0000-4000-8000-000000000008',
  publicChannel: '90000000-0000-4000-8000-000000000009',
  teamChannel: 'a0000000-0000-4000-8000-00000000000a',
  dmThread: 'b0000000-0000-4000-8000-00000000000b',
} as const;

async function createChannelMessage(channelId: string, body: string): Promise<string> {
  return (
    await rows<{ id: string }>(
      `INSERT INTO chat_messages (channel_id, author_id, body)
       VALUES ($1, $2, $3) RETURNING id`,
      [channelId, ids.author, body]
    )
  )[0].id;
}

async function createDirectMessage(body: string): Promise<string> {
  return (
    await rows<{ id: string }>(
      `INSERT INTO direct_messages (thread_id, author_id, body)
       VALUES ($1, $2, $3) RETURNING id`,
      [ids.dmThread, ids.author, body]
    )
  )[0].id;
}

async function chatMentionRecipients(messageId: string): Promise<string[]> {
  return (
    await rows<{ mentioned_participant_id: string }>(
      `SELECT mentioned_participant_id
       FROM chat_message_mentions
       WHERE message_id = $1
       ORDER BY mentioned_participant_id`,
      [messageId]
    )
  ).map((row) => row.mentioned_participant_id);
}

async function dmMentionRecipients(messageId: string): Promise<string[]> {
  return (
    await rows<{ mentioned_participant_id: string }>(
      `SELECT mentioned_participant_id
       FROM direct_message_mentions
       WHERE message_id = $1
       ORDER BY mentioned_participant_id`,
      [messageId]
    )
  ).map((row) => row.mentioned_participant_id);
}

describe('chat mention metadata on real SQL (US-034 / #400)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    await db.exec(sqlOf(FILES[0]));
    await db.exec(sqlOf(FILES[1]));
    await db.exec(sqlOf(FILES[2]));
    await db.exec(sqlOf(FILES[3]));
    await db.exec(sqlOf(FILES[4]));

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
    await db.exec(sqlOf(FILES[5]));
    await db.exec(sqlOf(FILES[6]));
    await db.exec(sqlOf(FILES[7]));
    await db.exec(sqlOf(FILES[8]));
    await db.exec(
      "ALTER TABLE participant_profiles ADD COLUMN moderation_status VARCHAR(30) NOT NULL DEFAULT 'None'"
    );

    for (const [id, key, verified] of [
      [ids.author, 'author', true],
      [ids.alice, 'alice', true],
      [ids.bob, 'bob', true],
      [ids.hidden, 'hidden', true],
      [ids.suspended, 'suspended', true],
      [ids.unverified, 'unverified', false],
      [ids.replacement, 'replacement', true],
    ] as const) {
      await db.query(
        `INSERT INTO participants
           (id, firebase_uid, email, full_name, role, is_verified)
         VALUES ($1, $2, $3, $4, 'PART', $5)`,
        [id, `fb-${key}`, `${key}@example.test`, key, verified]
      );
    }

    await db.query(
      `INSERT INTO participant_profiles
         (participant_id, handle, moderation_status)
       VALUES
         ($1, 'author_1', 'None'),
         ($2, 'Alice_1', 'None'),
         ($3, 'Bob-Two', 'None'),
         ($4, 'hidden_user', 'Hidden'),
         ($5, 'suspended_user', 'None'),
         ($6, 'unverified_user', 'None'),
         ($7, 'replacement_user', 'None')`,
      [
        ids.author,
        ids.alice,
        ids.bob,
        ids.hidden,
        ids.suspended,
        ids.unverified,
        ids.replacement,
      ]
    );
    await db.query(
      `UPDATE participants
       SET is_suspended = TRUE,
           suspended_at = NOW(),
           suspension_reason = 'mention privacy test'
       WHERE id = $1`,
      [ids.suspended]
    );

    await db.query('INSERT INTO teams (id) VALUES ($1)', [ids.team]);
    await db.query(
      `INSERT INTO team_memberships (team_id, participant_id, status)
       VALUES
         ($1, $2, 'Confirmed'),
         ($1, $3, 'Confirmed'),
         ($1, $4, 'Removed')`,
      [ids.team, ids.author, ids.alice, ids.bob]
    );
    await db.query(
      `INSERT INTO chat_channels
         (id, title, description, created_by, channel_type, team_id)
       VALUES
         ($1, 'Public', 'Public forum', $3, 'public', NULL),
         ($2, 'Private team', 'Team forum', $3, 'team', $4)`,
      [ids.publicChannel, ids.teamChannel, ids.author, ids.team]
    );
    await db.query(
      `INSERT INTO direct_message_threads
         (id, participant_low_id, participant_high_id)
       VALUES ($1, $2, $3)`,
      [ids.dmThread, ids.author, ids.alice]
    );

    await db.exec(sqlOf(FILES[9]));
  }, 60_000);

  afterEach(async () => {
    await db.query('DELETE FROM participant_blocks');
    await db.query('DELETE FROM direct_messages');
    await db.query('DELETE FROM chat_messages');
    await db.query(
      "UPDATE participant_profiles SET handle = 'replacement_user' WHERE participant_id = $1",
      [ids.replacement]
    );
    await db.query(
      "UPDATE participant_profiles SET handle = 'Alice_1' WHERE participant_id = $1",
      [ids.alice]
    );
    await db.query(
      `UPDATE participants
       SET is_suspended = FALSE,
           suspended_at = NULL,
           suspension_reason = NULL
       WHERE id = $1`,
      [ids.alice]
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it('parses the approved handle grammar case-insensitively without loose substring matches', async () => {
    const parsed = await rows<{ normalized_handle: string }>(
      `SELECT * FROM extract_chat_mention_handles(
        'Hi @Alice_1, @alice_1 and @Bob-Two; email@example.com @@ghost @a @bad.token'
      )`
    );
    expect(parsed.map((row) => row.normalized_handle)).toEqual([
      'alice_1',
      'bad',
      'bob-two',
    ]);
  });

  it('persists one public-channel event per resolved eligible participant', async () => {
    const messageId = await createChannelMessage(
      ids.publicChannel,
      '@ALICE_1 @alice_1 @Bob-Two @hidden_user @suspended_user @unverified_user @missing'
    );
    expect(await chatMentionRecipients(messageId)).toEqual([ids.alice, ids.bob]);
  });

  it('keeps historical mentions on stable participant ids across handle changes', async () => {
    const originalMessage = await createChannelMessage(ids.publicChannel, 'Hello @Alice_1');
    expect(await chatMentionRecipients(originalMessage)).toEqual([ids.alice]);

    await db.query("UPDATE participant_profiles SET handle = 'alice_new' WHERE participant_id = $1", [
      ids.alice,
    ]);
    await db.query("UPDATE participant_profiles SET handle = 'Alice_1' WHERE participant_id = $1", [
      ids.replacement,
    ]);

    expect(await chatMentionRecipients(originalMessage)).toEqual([ids.alice]);
    const laterMessage = await createChannelMessage(ids.publicChannel, 'Hello @alice_1');
    expect(await chatMentionRecipients(laterMessage)).toEqual([ids.replacement]);
  });

  it('limits private team mentions to current Confirmed team members', async () => {
    const messageId = await createChannelMessage(
      ids.teamChannel,
      'Confirmed @Alice_1; removed @Bob-Two; outsider @replacement_user'
    );
    expect(await chatMentionRecipients(messageId)).toEqual([ids.alice]);
  });

  it('limits DM mentions to the eligible peer and honors a block in either direction', async () => {
    const messageId = await createDirectMessage('@Alice_1 @alice_1 @Bob-Two');
    expect(await dmMentionRecipients(messageId)).toEqual([ids.alice]);

    await db.query(
      'INSERT INTO participant_blocks (blocker_id, blocked_id) VALUES ($1, $2)',
      [ids.alice, ids.author]
    );
    const blockedMessage = await createDirectMessage('@Alice_1');
    expect(await dmMentionRecipients(blockedMessage)).toEqual([]);
  });

  it('does not reinterpret or expose a persisted mention after account suspension', async () => {
    const messageId = await createChannelMessage(ids.publicChannel, '@Alice_1');
    await db.query(
      `UPDATE participants
       SET is_suspended = TRUE,
           suspended_at = NOW(),
           suspension_reason = 'later account change'
       WHERE id = $1`,
      [ids.alice]
    );

    expect(await chatMentionRecipients(messageId)).toEqual([ids.alice]);
    const metadata = await rows<Record<string, unknown>>(
      'SELECT * FROM chat_message_mentions WHERE message_id = $1',
      [messageId]
    );
    expect(Object.keys(metadata[0]).sort()).toEqual([
      'created_at',
      'mentioned_participant_id',
      'message_id',
    ]);
    expect(JSON.stringify(metadata)).not.toMatch(/email|handle|password|otp|token|firebase/i);
  });

  it('enforces duplicate prevention in the database and keeps no-mention sends unchanged', async () => {
    const mentionMessage = await createChannelMessage(ids.publicChannel, '@Alice_1 @alice_1');
    expect(await chatMentionRecipients(mentionMessage)).toEqual([ids.alice]);
    await expect(
      db.query(
        `INSERT INTO chat_message_mentions (message_id, mentioned_participant_id)
         VALUES ($1, $2)`,
        [mentionMessage, ids.alice]
      )
    ).rejects.toThrow(/pk_chat_message_mentions|duplicate key/i);

    const ordinaryMessage = await createChannelMessage(ids.publicChannel, 'ordinary message');
    expect(await chatMentionRecipients(ordinaryMessage)).toEqual([]);
  });

  it('provides participant lookup indexes, RLS with no public policies, and no notification rows', async () => {
    const indexes = await rows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN (
         'idx_chat_message_mentions_participant_created',
         'idx_direct_message_mentions_participant_created'
       ) ORDER BY indexname`
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      'idx_chat_message_mentions_participant_created',
      'idx_direct_message_mentions_participant_created',
    ]);

    const rls = await rows<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname IN ('chat_message_mentions', 'direct_message_mentions')
       ORDER BY relname`
    );
    expect(rls).toEqual([
      { relname: 'chat_message_mentions', relrowsecurity: true },
      { relname: 'direct_message_mentions', relrowsecurity: true },
    ]);
    expect(
      await rows(
        `SELECT 1 FROM pg_policies
         WHERE tablename IN ('chat_message_mentions', 'direct_message_mentions')`
      )
    ).toEqual([]);
    expect(sqlOf(FILES[9])).not.toMatch(/INSERT\s+INTO\s+participant_notifications/i);
  });

  it('is additive/idempotent and uses the unique next migration number', async () => {
    await expect(db.exec(sqlOf(FILES[9]))).resolves.not.toThrow();
    const migrationFiles = fs.readdirSync(DIR);
    expect(migrationFiles.filter((file) => file.startsWith('0060_'))).toEqual([
      '0060_create_chat_message_mentions.sql',
    ]);
    expect(migrationFiles).toContain('0059_create_chat_unread_count_query.sql');
  });
});
