/**
 * US-031 / #382 — team lifecycle behavior for private channel history, on the REAL SQL
 * (migrations applied to an in-process Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const FILES = [
  '0001_create_participants_table.sql',
  '0005_create_pending_event_submissions.sql',
  '0007_create_events_table.sql',
  '0010_add_participant_suspension.sql',
  '0011_create_team_recruitment_tables.sql',
  '0041_create_chat_channel_message_models.sql',
  '0051_add_team_channel_linkage_to_chat_channels.sql',
  '0052_enforce_team_channel_lifecycle.sql',
];
const sqlOf = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];
const fails = async (sql: string, params?: unknown[]): Promise<string | null> => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

const ids: Record<string, string> = {};
let seq = 0;

async function newParticipant(label: string): Promise<string> {
  seq += 1;
  return (await rows<{ id: string }>(
    "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ($1,$2,$3,'PART',true) RETURNING id",
    [`fb-${label}-${seq}`, `${label}${seq}@x.com`, label]
  ))[0].id;
}

/** A team with an owner (Confirmed) and its private channel. */
async function newTeamWithChannel(): Promise<{ team: string; event: string; channel: string }> {
  seq += 1;
  const event = (await rows<{ id: string }>(
    `INSERT INTO events (title,official_url,normalized_url,format,min_team_size,max_team_size,status,start_date,end_date)
     VALUES ($1,$2,$2,'Online',1,4,'Published',NOW() - interval '1 hour',NOW() + interval '14 days') RETURNING id`,
    [`Event ${seq}`, `https://example.com/e${seq}`]
  ))[0].id;
  const team = (await rows<{ id: string }>(
    `INSERT INTO teams (event_id,owner_participant_id,name,pitch,goal,commitment_hours)
     VALUES ($1,$2,$3,'pitch','Learning',10) RETURNING id`,
    [event, ids.owner, `Team ${seq}`]
  ))[0].id;
  await db.query("INSERT INTO team_memberships (team_id,event_id,participant_id,role) VALUES ($1,$2,$3,'Owner')", [team, event, ids.owner]);
  const channel = (await rows<{ id: string }>(
    "INSERT INTO chat_channels (title,description,created_by,channel_type,team_id) VALUES ('Team chat','private',$1,'team',$2) RETURNING id",
    [ids.owner, team]
  ))[0].id;
  return { team, event, channel };
}

const join = (t: { team: string; event: string }, participant: string) =>
  db.query("INSERT INTO team_memberships (team_id,event_id,participant_id,role) VALUES ($1,$2,$3,'Member')", [t.team, t.event, participant]);

const post = (channel: string, author: string, body = 'hello') =>
  fails('INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,$3)', [channel, author, body]);

const count = async (sql: string, params: unknown[]) => (await rows<{ c: number }>(sql, params))[0].c;

describe('team channel lifecycle on real SQL (US-031 / #382)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
    for (const f of FILES) await db.exec(sqlOf(f));
    ids.owner = await newParticipant('owner');
    ids.member = await newParticipant('member');
    ids.outsider = await newParticipant('outsider');
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('applies idempotently', async () => {
    await expect(db.exec(sqlOf('0052_enforce_team_channel_lifecycle.sql'))).resolves.not.toThrow();
  });

  describe('writes', () => {
    it('a confirmed member can write; an outsider cannot', async () => {
      const t = await newTeamWithChannel();
      await join(t, ids.member);
      expect(await post(t.channel, ids.owner)).toBeNull();
      expect(await post(t.channel, ids.member)).toBeNull();
      expect(await post(t.channel, ids.outsider)).toMatch(/TEAM_CHANNEL_NOT_A_MEMBER/);
      expect(await count('SELECT count(*)::int c FROM chat_messages WHERE channel_id=$1', [t.channel])).toBe(2);
    });

    it.each(['Removed', 'Released'])('a %s member can no longer write, but earlier messages stay', async (status) => {
      const t = await newTeamWithChannel();
      await join(t, ids.member);
      expect(await post(t.channel, ids.member, 'before')).toBeNull();
      await db.query("UPDATE team_memberships SET status=$3, ended_at=NOW() WHERE team_id=$1 AND participant_id=$2", [t.team, ids.member, status]);
      expect(await post(t.channel, ids.member, 'after')).toMatch(/TEAM_CHANNEL_NOT_A_MEMBER/);
      const bodies = (await rows<{ body: string }>('SELECT body FROM chat_messages WHERE channel_id=$1', [t.channel])).map((r) => r.body);
      expect(bodies).toContain('before');
      expect(bodies).not.toContain('after');
    });

    it('a Locked team keeps chatting', async () => {
      const t = await newTeamWithChannel();
      await db.query("UPDATE teams SET recruitment_status='Locked' WHERE id=$1", [t.team]);
      expect(await post(t.channel, ids.owner)).toBeNull();
    });

    it('a Disbanded team channel is read-only history, even for a still-Confirmed row', async () => {
      const t = await newTeamWithChannel();
      expect(await post(t.channel, ids.owner, 'kept')).toBeNull();
      await db.query("UPDATE teams SET recruitment_status='Disbanded' WHERE id=$1", [t.team]);
      expect(await post(t.channel, ids.owner, 'late')).toMatch(/TEAM_CHANNEL_READ_ONLY/);
      expect(await count('SELECT count(*)::int c FROM chat_messages WHERE channel_id=$1', [t.channel])).toBe(1);
    });

    it('a suspended account cannot write; reinstated it can', async () => {
      const t = await newTeamWithChannel();
      await db.query('UPDATE participants SET is_suspended=TRUE WHERE id=$1', [ids.owner]);
      expect(await post(t.channel, ids.owner)).toMatch(/TEAM_CHANNEL_ACCOUNT_SUSPENDED/);
      await db.query('UPDATE participants SET is_suspended=FALSE WHERE id=$1', [ids.owner]);
      expect(await post(t.channel, ids.owner)).toBeNull();
    });

    it('membership of another team does not allow writing to this one', async () => {
      const a = await newTeamWithChannel();
      const b = await newTeamWithChannel();
      await join(b, ids.member);
      expect(await post(a.channel, ids.member)).toMatch(/TEAM_CHANNEL_NOT_A_MEMBER/);
    });

    it('public (US-030) channels are unaffected by every rule', async () => {
      const pub = (await rows<{ id: string }>("INSERT INTO chat_channels (title,description,created_by) VALUES ('P','d',$1) RETURNING id", [ids.owner]))[0].id;
      expect(await post(pub, ids.outsider)).toBeNull();
      await db.query('UPDATE participants SET is_suspended=TRUE WHERE id=$1', [ids.outsider]);
      expect(await post(pub, ids.outsider)).toBeNull();
      await db.query('UPDATE participants SET is_suspended=FALSE WHERE id=$1', [ids.outsider]);
      expect(await fails('DELETE FROM chat_messages WHERE channel_id=$1', [pub])).toBeNull();
      expect(await fails('DELETE FROM chat_channels WHERE id=$1', [pub])).toBeNull();
    });
  });

  describe('history and membership integrity', () => {
    it('team messages cannot be deleted or rewritten, but no-op updates are harmless', async () => {
      const t = await newTeamWithChannel();
      await post(t.channel, ids.owner, 'original');
      expect(await fails('DELETE FROM chat_messages WHERE channel_id=$1', [t.channel])).toMatch(/TEAM_CHANNEL_HISTORY_IMMUTABLE/);
      expect(await fails("UPDATE chat_messages SET body='edited' WHERE channel_id=$1", [t.channel])).toMatch(/TEAM_CHANNEL_HISTORY_IMMUTABLE/);
      expect(await fails('UPDATE chat_messages SET body=body WHERE channel_id=$1', [t.channel])).toBeNull();
      expect((await rows<{ body: string }>('SELECT body FROM chat_messages WHERE channel_id=$1', [t.channel]))[0].body).toBe('original');
    });

    it('a team channel cannot be deleted, so its history cannot cascade away', async () => {
      const t = await newTeamWithChannel();
      await post(t.channel, ids.owner);
      expect(await fails('DELETE FROM chat_channels WHERE id=$1', [t.channel])).toMatch(/TEAM_CHANNEL_HISTORY_IMMUTABLE/);
      expect(await count('SELECT count(*)::int c FROM chat_messages WHERE channel_id=$1', [t.channel])).toBe(1);
    });

    it('membership rows of a team with a channel cannot be deleted; status changes are fine', async () => {
      const t = await newTeamWithChannel();
      await join(t, ids.member);
      expect(await fails('DELETE FROM team_memberships WHERE team_id=$1', [t.team])).toMatch(/TEAM_MEMBERSHIP_HISTORY_IMMUTABLE/);
      expect(await fails("UPDATE team_memberships SET status='Removed', ended_at=NOW() WHERE team_id=$1 AND participant_id=$2", [t.team, ids.member])).toBeNull();
      expect(await count('SELECT count(*)::int c FROM team_memberships WHERE team_id=$1', [t.team])).toBe(2);
    });

    it('membership rows of a team WITHOUT a channel can still be deleted (existing behavior)', async () => {
      const t = await newTeamWithChannel();
      await db.query('ALTER TABLE chat_channels DISABLE TRIGGER trigger_chat_channels_protect_team_deletion');
      await db.query('DELETE FROM chat_channels WHERE id=$1', [t.channel]);
      await db.query('ALTER TABLE chat_channels ENABLE TRIGGER trigger_chat_channels_protect_team_deletion');
      expect(await fails('DELETE FROM team_memberships WHERE team_id=$1', [t.team])).toBeNull();
    });
  });
});
