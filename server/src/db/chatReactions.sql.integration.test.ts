/**
 * US-035 / #405 — message reaction schema and service-role functions verified
 * against the real 0041–0061 chat SQL plus migration 0067.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { CHAT_REACTIONS } from './chatReactionModel.js';
import {
  createChatReactionDb,
  reactionIds as ids,
  reactionMigrationSql,
  suspendParticipant,
  unsuspendParticipant,
} from './chatReactions.testUtils.js';

let db: PGlite;

const rows = async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];

const failure = async (sql: string, params?: unknown[]): Promise<string> => {
  try {
    await db.query(sql, params);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

const setChannel = async (
  participant: string,
  channel: string,
  message: string,
  reaction: string,
  present: boolean
): Promise<boolean> =>
  (
    await rows<{ changed: boolean }>('SELECT * FROM set_chat_message_reaction($1, $2, $3, $4, $5)', [
      participant,
      channel,
      message,
      reaction,
      present,
    ])
  )[0]!.changed;

const setDm = async (
  participant: string,
  thread: string,
  message: string,
  reaction: string,
  present: boolean
): Promise<boolean> =>
  (
    await rows<{ changed: boolean }>('SELECT * FROM set_direct_message_reaction($1, $2, $3, $4, $5)', [
      participant,
      thread,
      message,
      reaction,
      present,
    ])
  )[0]!.changed;

const countChannelRows = async (message: string): Promise<number> =>
  Number((await rows<{ n: number }>('SELECT COUNT(*)::int AS n FROM chat_message_reactions WHERE message_id = $1', [message]))[0]!.n);

beforeAll(async () => {
  db = await createChatReactionDb();
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec('DELETE FROM chat_message_reactions; DELETE FROM direct_message_reactions; DELETE FROM participant_blocks;');
  await db.exec("UPDATE teams SET recruitment_status = 'Open'");
  await unsuspendParticipant(db, ids.reader);
  await unsuspendParticipant(db, ids.peer);
});

describe('0067 schema constraints (US-035 / #405)', () => {
  it('stores each of the eight approved codes and nothing else', async () => {
    for (const code of CHAT_REACTIONS) {
      await db.query(
        'INSERT INTO chat_message_reactions (message_id, participant_id, reaction) VALUES ($1, $2, $3)',
        [ids.pub1, ids.reader, code]
      );
    }
    expect(await countChannelRows(ids.pub1)).toBe(8);

    for (const bad of ['smile', '👍', 'THUMBS_UP', 'thumbs-up', '', 'custom:party_parrot']) {
      const message = await failure(
        'INSERT INTO direct_message_reactions (message_id, participant_id, reaction) VALUES ($1, $2, $3)',
        [ids.dm1, ids.reader, bad]
      );
      expect(message).toMatch(/chk_direct_message_reactions_approved/);
    }
  });

  it('makes a duplicate participant/message/reaction impossible', async () => {
    await db.query(
      "INSERT INTO chat_message_reactions (message_id, participant_id, reaction) VALUES ($1, $2, 'heart')",
      [ids.pub1, ids.reader]
    );
    const message = await failure(
      "INSERT INTO chat_message_reactions (message_id, participant_id, reaction) VALUES ($1, $2, 'heart')",
      [ids.pub1, ids.reader]
    );
    expect(message).toMatch(/pk_chat_message_reactions|duplicate key/);
  });

  it('requires an existing message and participant', async () => {
    expect(
      await failure(
        "INSERT INTO chat_message_reactions (message_id, participant_id, reaction) VALUES ($1, $2, 'heart')",
        [ids.missing, ids.reader]
      )
    ).toMatch(/foreign key/);
    expect(
      await failure(
        "INSERT INTO direct_message_reactions (message_id, participant_id, reaction) VALUES ($1, $2, 'heart')",
        [ids.dm1, ids.missing]
      )
    ).toMatch(/foreign key/);
  });

  it('follows the message lifecycle like the mention tables (ON DELETE CASCADE)', async () => {
    const scratch = 'aaaaaaaa-0000-4000-8000-00000000000a';
    await db.query(
      "INSERT INTO chat_messages (id, channel_id, author_id, body) VALUES ($1, $2, $3, 'temporary')",
      [scratch, ids.publicChannel, ids.peer]
    );
    await setChannel(ids.reader, ids.publicChannel, scratch, 'heart', true);
    await db.query('DELETE FROM chat_messages WHERE id = $1', [scratch]);
    expect(await countChannelRows(scratch)).toBe(0);
  });

  it('follows the participant lifecycle like the mention tables (ON DELETE CASCADE)', async () => {
    const temp = 'bbbbbbbb-0000-4000-8000-00000000000b';
    await db.query(
      "INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified) VALUES ($1, 'fb-temp', 'temp@example.test', 'Temp', 'PART', TRUE)",
      [temp]
    );
    await setChannel(temp, ids.publicChannel, ids.pub1, 'eyes', true);
    await db.query('DELETE FROM participants WHERE id = $1', [temp]);
    expect(await countChannelRows(ids.pub1)).toBe(0);
  });

  it('enables RLS and keeps tables and functions away from browser roles', async () => {
    const rls = await rows<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('chat_message_reactions', 'direct_message_reactions')"
    );
    expect(rls).toHaveLength(2);
    expect(rls.every((row) => row.relrowsecurity)).toBe(true);

    for (const role of ['anon', 'authenticated']) {
      for (const sql of [
        'SELECT * FROM chat_message_reactions',
        'SELECT * FROM direct_message_reactions',
        `SELECT * FROM set_chat_message_reaction('${ids.reader}', '${ids.publicChannel}', '${ids.pub1}', 'heart', TRUE)`,
        `SELECT * FROM set_direct_message_reaction('${ids.reader}', '${ids.dm}', '${ids.dm1}', 'heart', TRUE)`,
        `SELECT * FROM summarize_chat_message_reactions('${ids.reader}', ARRAY['${ids.pub1}']::uuid[])`,
        `SELECT * FROM summarize_direct_message_reactions('${ids.reader}', ARRAY['${ids.dm1}']::uuid[])`,
      ]) {
        await db.exec(`SET ROLE ${role}`);
        const message = await failure(sql);
        await db.exec('RESET ROLE');
        expect(message, `${role}: ${sql}`).toMatch(/permission denied/);
      }
    }
  });
});

describe('set_chat_message_reaction (public and team channels)', () => {
  it('adds once and treats a repeated add as a successful no-op', async () => {
    expect(await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'thumbs_up', true)).toBe(true);
    expect(await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'thumbs_up', true)).toBe(false);
    expect(await countChannelRows(ids.pub1)).toBe(1);
  });

  it('removes once and treats a repeated remove as a successful no-op', async () => {
    await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'thumbs_up', true);
    expect(await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'thumbs_up', false)).toBe(true);
    expect(await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'thumbs_up', false)).toBe(false);
    expect(await countChannelRows(ids.pub1)).toBe(0);
  });

  it('converges concurrent identical adds and removes on one deterministic state', async () => {
    const adds = await Promise.all([
      setChannel(ids.reader, ids.publicChannel, ids.pub1, 'party', true),
      setChannel(ids.reader, ids.publicChannel, ids.pub1, 'party', true),
      setChannel(ids.reader, ids.publicChannel, ids.pub1, 'party', true),
    ]);
    expect(adds.filter(Boolean)).toHaveLength(1);
    expect(await countChannelRows(ids.pub1)).toBe(1);

    const removes = await Promise.all([
      setChannel(ids.reader, ids.publicChannel, ids.pub1, 'party', false),
      setChannel(ids.reader, ids.publicChannel, ids.pub1, 'party', false),
    ]);
    expect(removes.filter(Boolean)).toHaveLength(1);
    expect(await countChannelRows(ids.pub1)).toBe(0);
  });

  it('lets one participant use several different approved reactions on one message', async () => {
    await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'heart', true);
    await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'laugh', true);
    expect(await countChannelRows(ids.pub1)).toBe(2);
  });

  it('rejects an unapproved reaction before any write', async () => {
    expect(await failure('SELECT * FROM set_chat_message_reaction($1, $2, $3, $4, TRUE)', [ids.reader, ids.publicChannel, ids.pub1, 'smile'])).toMatch(
      /CHAT_REACTION_INVALID/
    );
    expect(await failure('SELECT * FROM set_chat_message_reaction($1, $2, $3, NULL, TRUE)', [ids.reader, ids.publicChannel, ids.pub1])).toMatch(
      /CHAT_REACTION_INVALID/
    );
  });

  it('gives a random id and a message from another channel the same not-found answer', async () => {
    for (const message of [ids.missing, ids.team1, ids.other1]) {
      expect(
        await failure('SELECT * FROM set_chat_message_reaction($1, $2, $3, $4, TRUE)', [ids.reader, ids.publicChannel, message, 'heart'])
      ).toMatch(/CHAT_REACTION_MESSAGE_NOT_FOUND/);
    }
  });

  it('applies the team-channel write rules: confirmed member of a live team only', async () => {
    expect(await setChannel(ids.reader, ids.teamChannel, ids.team1, 'check', true)).toBe(true);

    // outsider is Removed from this team (and only a member of another team).
    expect(
      await failure('SELECT * FROM set_chat_message_reaction($1, $2, $3, $4, TRUE)', [ids.outsider, ids.teamChannel, ids.team1, 'check'])
    ).toMatch(/TEAM_CHANNEL_NOT_A_MEMBER/);
    expect(
      await failure('SELECT * FROM set_chat_message_reaction($1, $2, $3, $4, TRUE)', [ids.reader, ids.otherTeamChannel, ids.other1, 'check'])
    ).toMatch(/TEAM_CHANNEL_NOT_A_MEMBER/);

    await db.query("UPDATE teams SET recruitment_status = 'Disbanded' WHERE id = $1", [ids.team]);
    for (const present of [true, false]) {
      expect(
        await failure('SELECT * FROM set_chat_message_reaction($1, $2, $3, $4, $5)', [ids.reader, ids.teamChannel, ids.team1, 'check', present])
      ).toMatch(/TEAM_CHANNEL_READ_ONLY/);
    }
  });

  it('refuses ADMIN and suspended accounts', async () => {
    expect(
      await failure('SELECT * FROM set_chat_message_reaction($1, $2, $3, $4, TRUE)', [ids.admin, ids.publicChannel, ids.pub1, 'heart'])
    ).toMatch(/CHAT_REACTION_NOT_ELIGIBLE/);
    await suspendParticipant(db, ids.reader);
    expect(
      await failure('SELECT * FROM set_chat_message_reaction($1, $2, $3, $4, TRUE)', [ids.reader, ids.publicChannel, ids.pub1, 'heart'])
    ).toMatch(/CHAT_REACTION_NOT_ELIGIBLE/);
  });
});

describe('set_direct_message_reaction', () => {
  it('lets either thread participant add and remove idempotently', async () => {
    expect(await setDm(ids.reader, ids.dm, ids.dm1, 'heart', true)).toBe(true);
    expect(await setDm(ids.reader, ids.dm, ids.dm1, 'heart', true)).toBe(false);
    expect(await setDm(ids.peer, ids.dm, ids.dm1, 'heart', true)).toBe(true);
    expect(await setDm(ids.reader, ids.dm, ids.dm1, 'heart', false)).toBe(true);
    expect(await setDm(ids.reader, ids.dm, ids.dm1, 'heart', false)).toBe(false);
  });

  it('gives a missing thread and somebody else’s thread the same answer', async () => {
    for (const thread of [ids.otherDm, ids.missing]) {
      expect(
        await failure('SELECT * FROM set_direct_message_reaction($1, $2, $3, $4, TRUE)', [ids.reader, thread, ids.otherDm1, 'heart'])
      ).toMatch(/DM_NOT_A_PARTICIPANT/);
    }
  });

  it('does not accept a message from another thread under the caller’s own thread', async () => {
    expect(
      await failure('SELECT * FROM set_direct_message_reaction($1, $2, $3, $4, TRUE)', [ids.peer, ids.dm, ids.otherDm1, 'heart'])
    ).toMatch(/CHAT_REACTION_MESSAGE_NOT_FOUND/);
  });

  it('denies add AND remove when either participant has blocked the other', async () => {
    await setDm(ids.reader, ids.dm, ids.dm1, 'heart', true);
    for (const [blocker, blocked] of [
      [ids.reader, ids.peer],
      [ids.peer, ids.reader],
    ]) {
      await db.query('INSERT INTO participant_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [blocker, blocked]);
      for (const present of [true, false]) {
        expect(
          await failure('SELECT * FROM set_direct_message_reaction($1, $2, $3, $4, $5)', [ids.reader, ids.dm, ids.dm1, 'heart', present])
        ).toMatch(/DM_PEER_BLOCKED/);
      }
      await db.exec('DELETE FROM participant_blocks');
    }
  });

  it('applies the send rules for the peer and the caller', async () => {
    await suspendParticipant(db, ids.peer);
    expect(
      await failure('SELECT * FROM set_direct_message_reaction($1, $2, $3, $4, TRUE)', [ids.reader, ids.dm, ids.dm1, 'heart'])
    ).toMatch(/DM_PEER_UNVERIFIED/);
    await unsuspendParticipant(db, ids.peer);
    await suspendParticipant(db, ids.reader);
    expect(
      await failure('SELECT * FROM set_direct_message_reaction($1, $2, $3, $4, TRUE)', [ids.reader, ids.dm, ids.dm1, 'heart'])
    ).toMatch(/DM_ACCOUNT_SUSPENDED/);
  });
});

describe('summaries: counts and own state only', () => {
  it('aggregates several participants per message and reports the viewer’s own state', async () => {
    await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'heart', true);
    await setChannel(ids.peer, ids.publicChannel, ids.pub1, 'heart', true);
    await setChannel(ids.lurker, ids.publicChannel, ids.pub1, 'heart', true);
    await setChannel(ids.peer, ids.publicChannel, ids.pub1, 'eyes', true);

    const summary = await rows<{ message_id: string; reaction: string; reaction_count: number; reacted_by_me: boolean }>(
      'SELECT * FROM summarize_chat_message_reactions($1, $2::uuid[]) ORDER BY reaction',
      [ids.reader, [ids.pub1, ids.pub2]]
    );
    expect(summary).toEqual([
      { message_id: ids.pub1, reaction: 'eyes', reaction_count: 1, reacted_by_me: false },
      { message_id: ids.pub1, reaction: 'heart', reaction_count: 3, reacted_by_me: true },
    ]);
    // The function's output columns carry no participant identity at all.
    expect(Object.keys(summary[0]!).sort()).toEqual(['message_id', 'reacted_by_me', 'reaction', 'reaction_count']);
  });

  it('returns only the requested messages', async () => {
    await setChannel(ids.reader, ids.publicChannel, ids.pub1, 'heart', true);
    await setDm(ids.peer, ids.otherDm, ids.otherDm1, 'sad', true);
    expect(
      await rows('SELECT * FROM summarize_chat_message_reactions($1, $2::uuid[])', [ids.reader, [ids.pub2]])
    ).toEqual([]);
    expect(
      await rows('SELECT * FROM summarize_direct_message_reactions($1, $2::uuid[])', [ids.reader, [ids.dm1]])
    ).toEqual([]);
  });
});

describe('no unread, cursor, mention, or activity side effects', () => {
  it('leaves unread counts, read cursors, mention rows, messages, and DM activity unchanged', async () => {
    const counts = async (participant: string) =>
      rows('SELECT * FROM get_participant_chat_activity_counts($1) ORDER BY conversation_type, conversation_id', [participant]);
    const snapshot = async () => ({
      readerCounts: await counts(ids.reader),
      peerCounts: await counts(ids.peer),
      channelCursors: await rows('SELECT * FROM chat_channel_read_cursors ORDER BY participant_id, channel_id'),
      dmCursors: await rows('SELECT * FROM direct_message_read_cursors ORDER BY participant_id, thread_id'),
      mentions: await rows('SELECT * FROM chat_message_mentions ORDER BY message_id'),
      dmMentions: await rows('SELECT * FROM direct_message_mentions ORDER BY message_id'),
      messages: await rows('SELECT id, created_at FROM chat_messages ORDER BY id'),
      threads: await rows('SELECT id, last_message_at, updated_at FROM direct_message_threads ORDER BY id'),
    });

    await rows('SELECT * FROM mark_chat_conversation_read($1, $2, $3, $4)', [ids.reader, 'channel', ids.publicChannel, ids.pub1]);
    const before = await snapshot();

    await setChannel(ids.reader, ids.publicChannel, ids.pub2, 'party', true);
    await setChannel(ids.peer, ids.publicChannel, ids.pub1, 'heart', true);
    await setChannel(ids.peer, ids.teamChannel, ids.team1, 'heart', true);
    await setDm(ids.peer, ids.dm, ids.dm1, 'heart', true);
    await setDm(ids.reader, ids.dm, ids.dm1, 'check', true);
    await setDm(ids.reader, ids.dm, ids.dm1, 'check', false);

    expect(await snapshot()).toEqual(before);
  });

  it('never writes notification, cursor, or activity tables', () => {
    const sql = reactionMigrationSql().toLowerCase();
    for (const table of [
      'participant_notifications',
      'chat_channel_read_cursors',
      'direct_message_read_cursors',
      'chat_message_mentions',
      'direct_message_mentions',
      'chat_messages',
      'direct_messages',
      'direct_message_threads',
    ]) {
      expect(sql).not.toMatch(new RegExp(`(insert into|update|delete from)\\s+${table}`));
    }
  });
});
