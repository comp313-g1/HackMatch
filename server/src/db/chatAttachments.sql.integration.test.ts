/**
 * US-035 / #409 — attachment schema and service-role functions on the real
 * 0041–0068 chat SQL (PGlite).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { reactionIds as ids, suspendParticipant, unsuspendParticipant } from './chatReactions.testUtils.js';
import { createChatAttachmentDb } from './chatAttachments.testUtils.js';

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

type Scope = 'channel' | 'direct_message';
async function reserve(
  participant: string,
  scope: Scope,
  conversation: string,
  size = 100,
  mime = 'image/png'
): Promise<{ outcome: string; attachment_id: string | null; retry_after_seconds: number }> {
  return (
    await rows<{ outcome: string; attachment_id: string | null; retry_after_seconds: number }>(
      'SELECT * FROM reserve_chat_attachment_upload($1, $2, $3, $4, $5, $6, $7, $8)',
      [participant, scope, conversation, randomUUID(), 'file.png', mime, size, 'not_scanned']
    )
  )[0]!;
}

async function pendingUpload(participant: string, scope: Scope, conversation: string): Promise<string> {
  const result = await reserve(participant, scope, conversation);
  const table = scope === 'channel' ? 'chat_message_attachments' : 'direct_message_attachments';
  await db.query(`UPDATE ${table} SET status = 'pending' WHERE id = $1`, [result.attachment_id]);
  return result.attachment_id!;
}

const sendChannel = (participant: string, channel: string, body: string, attachments: string[]) =>
  rows<{ id: string }>('SELECT * FROM send_chat_message_with_attachments($1, $2, $3, $4)', [participant, channel, body, attachments]);
const sendDirect = (participant: string, thread: string, body: string, attachments: string[]) =>
  rows<{ id: string }>('SELECT * FROM send_direct_message_with_attachments($1, $2, $3, $4)', [participant, thread, body, attachments]);

const count = async (sql: string, params?: unknown[]) => Number((await rows<{ n: number }>(sql, params))[0]!.n);
const queued = () => count('SELECT COUNT(*)::int AS n FROM chat_attachment_object_deletions');

beforeAll(async () => {
  db = await createChatAttachmentDb();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM chat_message_attachments; DELETE FROM direct_message_attachments;
    DELETE FROM chat_attachment_object_deletions; DELETE FROM participant_blocks;
    UPDATE teams SET recruitment_status = 'Open';
  `);
  await unsuspendParticipant(db, ids.peer);
});

describe('0068 schema', () => {
  it('rejects unapproved types, bad sizes, non-UUID keys, and inconsistent link state', async () => {
    const insert = (overrides: Record<string, unknown>) => {
      const row = {
        uploader_id: ids.reader,
        channel_id: ids.publicChannel,
        storage_key: randomUUID(),
        display_name: 'a.png',
        mime_type: 'image/png',
        size_bytes: 10,
        status: 'pending',
        scan_status: 'not_scanned',
        ...overrides,
      };
      const keys = Object.keys(row);
      return failure(
        `INSERT INTO chat_message_attachments (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(row)
      );
    };
    expect(await insert({})).toBe('');
    for (const [label, overrides] of [
      ['svg', { mime_type: 'image/svg+xml' }],
      ['zip', { mime_type: 'application/zip' }],
      ['video', { mime_type: 'video/mp4' }],
      ['zero size', { size_bytes: 0 }],
      ['over 10 MB', { size_bytes: 10_485_761 }],
      ['filename as key', { storage_key: '../photo.png' }],
      ['attached without message', { status: 'attached' }],
      ['unknown scan status', { scan_status: 'safe' }],
      ['blank name', { display_name: '   ' }],
    ] as const) {
      expect(await insert(overrides as Record<string, unknown>), label).not.toBe('');
    }
    expect(await insert({ size_bytes: 10_485_760 })).toBe(''); // exactly 10 MB is allowed
  });

  it('enables RLS and keeps tables and functions away from browser roles', async () => {
    const rls = await rows<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('chat_message_attachments','direct_message_attachments','chat_attachment_object_deletions')"
    );
    expect(rls.map((r) => r.relrowsecurity)).toEqual([true, true, true]);
    for (const role of ['anon', 'authenticated']) {
      for (const sql of [
        'SELECT * FROM chat_message_attachments',
        'SELECT * FROM direct_message_attachments',
        'SELECT * FROM chat_attachment_object_deletions',
        `SELECT * FROM chat_attachment_usage('${ids.reader}')`,
        `SELECT * FROM reserve_chat_attachment_upload('${ids.reader}', 'channel', '${ids.publicChannel}', '${randomUUID()}', 'a.png', 'image/png', 1, 'not_scanned')`,
        `SELECT * FROM send_chat_message_with_attachments('${ids.reader}', '${ids.publicChannel}', 'x', ARRAY['${randomUUID()}']::uuid[])`,
        `SELECT * FROM send_direct_message_with_attachments('${ids.reader}', '${ids.dm}', 'x', ARRAY['${randomUUID()}']::uuid[])`,
        'SELECT expire_chat_attachment_uploads(10)',
      ]) {
        await db.exec(`SET ROLE ${role}`);
        const message = await failure(sql);
        await db.exec('RESET ROLE');
        expect(message, `${role}: ${sql}`).toMatch(/permission denied/);
      }
    }
  });
});

describe('reservation: 20 per rolling hour and 100 MB per participant', () => {
  it('allows exactly 20 reservations in an hour across both tables, then reports retry timing', async () => {
    for (let i = 0; i < 20; i += 1) {
      const scope: Scope = i % 2 === 0 ? 'channel' : 'direct_message';
      expect((await reserve(ids.reader, scope, scope === 'channel' ? ids.publicChannel : ids.dm)).outcome).toBe('reserved');
    }
    const limited = await reserve(ids.reader, 'channel', ids.teamChannel);
    expect(limited.outcome).toBe('rate_limited');
    expect(limited.retry_after_seconds).toBeGreaterThan(3500);
    expect((await reserve(ids.peer, 'channel', ids.publicChannel)).outcome).toBe('reserved'); // isolated per participant

    await db.query("UPDATE chat_message_attachments SET created_at = NOW() - INTERVAL '61 minutes' WHERE uploader_id = $1", [ids.reader]);
    expect((await reserve(ids.reader, 'channel', ids.publicChannel)).outcome).toBe('reserved');
  });

  it('enforces the 100 MB quota at the exact boundary, counting unattached uploads', async () => {
    const tenMb = 10_485_760;
    for (let i = 0; i < 9; i += 1) expect((await reserve(ids.reader, 'channel', ids.publicChannel, tenMb)).outcome).toBe('reserved');
    // 94,371,840 bytes used; 10,485,760 left exactly.
    await db.query("UPDATE chat_message_attachments SET created_at = NOW() - INTERVAL '2 hours'");
    expect((await reserve(ids.reader, 'direct_message', ids.dm, tenMb + 1 - 1)).outcome).toBe('reserved'); // exactly 100 MB
    expect((await reserve(ids.reader, 'direct_message', ids.dm, 1)).outcome).toBe('quota_exceeded');
    const usage = (await rows<{ stored_bytes: string }>('SELECT * FROM chat_attachment_usage($1)', [ids.reader]))[0]!;
    expect(Number(usage.stored_bytes)).toBe(104_857_600);
  });

  it('serializes simultaneous reservations so the quota cannot be overshot', async () => {
    await db.query(
      `INSERT INTO chat_message_attachments (uploader_id, channel_id, storage_key, display_name, mime_type, size_bytes, status, scan_status, created_at)
       SELECT $1, $2, gen_random_uuid()::text, 'big.pdf', 'application/pdf', 10485760, 'pending', 'not_scanned', NOW() - INTERVAL '2 hours'
       FROM generate_series(1, 9)`,
      [ids.reader, ids.publicChannel]
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () => reserve(ids.reader, 'channel', ids.publicChannel, 5_000_000))
    );
    expect(results.filter((r) => r.outcome === 'reserved')).toHaveLength(2); // 2 × 5 MB fit in the last 10 MB
    expect(results.filter((r) => r.outcome === 'quota_exceeded')).toHaveLength(2);
  });
});

describe('sending a message with attachments (one transaction)', () => {
  it('links up to 5 of the sender’s pending uploads for that conversation', async () => {
    const uploads = [];
    for (let i = 0; i < 5; i += 1) uploads.push(await pendingUpload(ids.reader, 'channel', ids.publicChannel));
    const [message] = await sendChannel(ids.reader, ids.publicChannel, 'five files', uploads);
    const linked = await rows<{ status: string; message_id: string }>(
      'SELECT status, message_id FROM chat_message_attachments ORDER BY created_at'
    );
    expect(linked.every((row) => row.status === 'attached' && row.message_id === message!.id)).toBe(true);
  });

  it('rejects a sixth attachment, duplicates, and an empty list', async () => {
    const six = [];
    for (let i = 0; i < 6; i += 1) six.push(await pendingUpload(ids.reader, 'channel', ids.publicChannel));
    expect(await failure('SELECT * FROM send_chat_message_with_attachments($1, $2, $3, $4)', [ids.reader, ids.publicChannel, 'x', six])).toMatch(
      /CHAT_ATTACHMENT_LIMIT/
    );
    expect(
      await failure('SELECT * FROM send_chat_message_with_attachments($1, $2, $3, $4)', [ids.reader, ids.publicChannel, 'x', [six[0], six[0]]])
    ).toMatch(/CHAT_ATTACHMENT_VALIDATION_ERROR/);
    expect(await failure('SELECT * FROM send_chat_message_with_attachments($1, $2, $3, $4)', [ids.reader, ids.publicChannel, 'x', []])).toMatch(
      /CHAT_ATTACHMENT_VALIDATION_ERROR/
    );
  });

  it('refuses someone else’s upload, another conversation’s upload, a used upload, or an expired one — and stores no message', async () => {
    const theirs = await pendingUpload(ids.peer, 'channel', ids.publicChannel);
    const elsewhere = await pendingUpload(ids.reader, 'channel', ids.teamChannel);
    const used = await pendingUpload(ids.reader, 'channel', ids.publicChannel);
    await sendChannel(ids.reader, ids.publicChannel, 'first', [used]);
    const expired = await pendingUpload(ids.reader, 'channel', ids.publicChannel);
    await db.query("UPDATE chat_message_attachments SET created_at = NOW() - INTERVAL '25 hours' WHERE id = $1", [expired]);
    const before = await count('SELECT COUNT(*)::int AS n FROM chat_messages');

    for (const attachment of [theirs, elsewhere, used, expired, randomUUID()]) {
      expect(
        await failure('SELECT * FROM send_chat_message_with_attachments($1, $2, $3, $4)', [ids.reader, ids.publicChannel, 'x', [attachment]])
      ).toMatch(/CHAT_ATTACHMENT_NOT_AVAILABLE/);
    }
    expect(await count('SELECT COUNT(*)::int AS n FROM chat_messages')).toBe(before);
  });

  it('keeps the existing message rules: text required, team write rules apply', async () => {
    const upload = await pendingUpload(ids.reader, 'channel', ids.teamChannel);
    expect(await failure('SELECT * FROM send_chat_message_with_attachments($1, $2, $3, $4)', [ids.reader, ids.teamChannel, '   ', [upload]])).toMatch(
      /chk_chat_messages_body_nonempty/
    );
    await db.query("UPDATE teams SET recruitment_status = 'Disbanded' WHERE id = $1", [ids.team]);
    expect(
      await failure('SELECT * FROM send_chat_message_with_attachments($1, $2, $3, $4)', [ids.reader, ids.teamChannel, 'hello', [upload]])
    ).toMatch(/TEAM_CHANNEL_READ_ONLY/);
  });

  it('DM: re-checks blocks and peer eligibility at write time', async () => {
    const upload = await pendingUpload(ids.reader, 'direct_message', ids.dm);
    await db.query('INSERT INTO participant_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [ids.peer, ids.reader]);
    expect(await failure('SELECT * FROM send_direct_message_with_attachments($1, $2, $3, $4)', [ids.reader, ids.dm, 'hi', [upload]])).toMatch(
      /DM_PEER_BLOCKED/
    );
    await db.exec('DELETE FROM participant_blocks');
    await suspendParticipant(db, ids.peer);
    expect(await failure('SELECT * FROM send_direct_message_with_attachments($1, $2, $3, $4)', [ids.reader, ids.dm, 'hi', [upload]])).toMatch(
      /DM_PEER_UNVERIFIED/
    );
    await unsuspendParticipant(db, ids.peer);
    expect(await sendDirect(ids.reader, ids.dm, 'hi', [upload])).toHaveLength(1);
    expect(await failure('SELECT * FROM send_direct_message_with_attachments($1, $2, $3, $4)', [ids.outsider, ids.dm, 'hi', [upload]])).toMatch(
      /DM_NOT_A_PARTICIPANT/
    );
  });

  it('the link trigger caps a message at 5 even for a direct write racing the send', async () => {
    const five = [];
    for (let i = 0; i < 5; i += 1) five.push(await pendingUpload(ids.reader, 'channel', ids.publicChannel));
    const [message] = await sendChannel(ids.reader, ids.publicChannel, 'full', five);
    const extra = await pendingUpload(ids.reader, 'channel', ids.publicChannel);
    expect(
      await failure(
        "UPDATE chat_message_attachments SET message_id = $1, status = 'attached', attached_at = NOW() WHERE id = $2",
        [message!.id, extra]
      )
    ).toMatch(/CHAT_ATTACHMENT_LIMIT/);
    const theirMessage = (await rows<{ id: string }>("INSERT INTO chat_messages (channel_id, author_id, body) VALUES ($1, $2, 'peer') RETURNING id", [ids.publicChannel, ids.peer]))[0]!;
    expect(
      await failure(
        "UPDATE chat_message_attachments SET message_id = $1, status = 'attached', attached_at = NOW() WHERE id = $2",
        [theirMessage.id, extra]
      )
    ).toMatch(/CHAT_ATTACHMENT_NOT_AVAILABLE/); // not the uploader's message
  });

  it('serializes simultaneous associations so a message can never exceed 5 attachments', async () => {
    const uploads = await Promise.all(
      Array.from({ length: 6 }, () => pendingUpload(ids.reader, 'channel', ids.publicChannel))
    );
    const [message] = await rows<{ id: string }>(
      "INSERT INTO chat_messages (channel_id, author_id, body) VALUES ($1, $2, 'concurrent links') RETURNING id",
      [ids.publicChannel, ids.reader]
    );

    const outcomes = await Promise.allSettled(
      uploads.map((upload) =>
        db.query(
          "UPDATE chat_message_attachments SET message_id = $1, status = 'attached', attached_at = NOW() WHERE id = $2",
          [message!.id, upload]
        )
      )
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(
      await count('SELECT COUNT(*)::int AS n FROM chat_message_attachments WHERE message_id = $1', [message!.id])
    ).toBe(5);
  });
});

describe('lifecycle: cascades and expiry queue storage objects for deletion', () => {
  it('queues the object when a message, a participant, or a row is deleted', async () => {
    const upload = await pendingUpload(ids.reader, 'channel', ids.publicChannel);
    const [message] = await sendChannel(ids.reader, ids.publicChannel, 'temporary', [upload]);
    const key = (await rows<{ storage_key: string }>('SELECT storage_key FROM chat_message_attachments WHERE id = $1', [upload]))[0]!.storage_key;
    await db.query('DELETE FROM chat_messages WHERE id = $1', [message!.id]);
    expect(await count('SELECT COUNT(*)::int AS n FROM chat_message_attachments')).toBe(0);
    expect(await rows('SELECT storage_key FROM chat_attachment_object_deletions')).toEqual([{ storage_key: key }]);

    const temp = randomUUID();
    await db.query(
      "INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified) VALUES ($1, 'fb-tmp', 'tmp@example.test', 'Tmp', 'PART', TRUE)",
      [temp]
    );
    await reserve(temp, 'channel', ids.publicChannel);
    await db.query('DELETE FROM participants WHERE id = $1', [temp]);
    expect(await queued()).toBe(2);
  });

  it('expires unsent uploads after 24 h and stuck reservations after 15 min, never attached ones', async () => {
    const old = await pendingUpload(ids.reader, 'channel', ids.publicChannel);
    const fresh = await pendingUpload(ids.reader, 'direct_message', ids.dm);
    const stuck = (await reserve(ids.reader, 'channel', ids.publicChannel)).attachment_id!;
    const sent = await pendingUpload(ids.reader, 'channel', ids.publicChannel);
    await sendChannel(ids.reader, ids.publicChannel, 'kept', [sent]);
    await db.query("UPDATE chat_message_attachments SET created_at = NOW() - INTERVAL '24 hours 1 minute' WHERE id IN ($1, $2)", [old, sent]);
    await db.query("UPDATE chat_message_attachments SET created_at = NOW() - INTERVAL '16 minutes' WHERE id = $1", [stuck]);

    expect((await rows<{ expire_chat_attachment_uploads: number }>('SELECT expire_chat_attachment_uploads(100)'))[0]!.expire_chat_attachment_uploads).toBe(2);
    const remaining = (await rows<{ id: string }>('SELECT id FROM chat_message_attachments UNION ALL SELECT id FROM direct_message_attachments')).map((r) => r.id);
    expect(remaining.sort()).toEqual([fresh, sent].sort());
    expect(await queued()).toBe(2);
  });
});
