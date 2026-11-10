/**
 * US-031 / #378 — team-channel linkage, deterministic constraints and lookup indexes,
 * verified against the REAL SQL (migrations applied to an in-process Postgres).
 *
 * The US-030 chat tables are created first and seeded with legacy public channels and
 * messages; migration 0051 is applied afterwards, so "existing data is preserved" is tested
 * on genuine pre-existing rows, not on an empty table. Runs in the normal test suite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const BASE = [
  '0001_create_participants_table.sql',
  '0005_create_pending_event_submissions.sql',
  '0007_create_events_table.sql',
  '0011_create_team_recruitment_tables.sql',
  '0041_create_chat_channel_message_models.sql',
];
const MIGRATION = '0051_add_team_channel_linkage_to_chat_channels.sql';
const sqlOf = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];

/** Resolves to the error message, or null when the statement succeeded. */
const fails = async (sql: string, params?: unknown[]): Promise<string | null> => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

const ids: Record<string, string> = {};
let legacyBefore: { h: string; c: number; m: number };

const legacyFingerprint = async () => {
  const ch = await rows<{ h: string; c: number }>(
    `SELECT md5(COALESCE(string_agg(id::text||'|'||title||'|'||description||'|'||created_by::text||'|'||created_at::text||'|'||updated_at::text, ',' ORDER BY id),'')) h, count(*)::int c
       FROM chat_channels WHERE id = ANY($1::uuid[])`,
    [[ids.legacyA, ids.legacyB]]
  );
  const m = await rows<{ c: number }>('SELECT count(*)::int c FROM chat_messages WHERE channel_id = ANY($1::uuid[])', [[ids.legacyA, ids.legacyB]]);
  return { ...ch[0], m: m[0].c };
};

async function newTeam(label: string): Promise<string> {
  const eventKey = `${label}-${Math.random().toString(36).slice(2, 8)}`;
  const event = await rows<{ id: string }>(
    `INSERT INTO events (title,official_url,normalized_url,format,min_team_size,max_team_size,status,start_date,end_date)
     VALUES ($1,$2,$2,'Online',1,4,'Published',NOW() - interval '1 hour',NOW() + interval '14 days') RETURNING id`,
    [`Event ${eventKey}`, `https://example.com/${eventKey}`]
  );
  const team = await rows<{ id: string }>(
    `INSERT INTO teams (event_id,owner_participant_id,name,pitch,goal,commitment_hours)
     VALUES ($1,$2,$3,'pitch','Learning',10) RETURNING id`,
    [event[0].id, ids.owner, `Team ${label}`]
  );
  return team[0].id;
}

const newPublic = async (title: string) =>
  (await rows<{ id: string }>(
    // Exactly the column list US-030 code uses: no channel_type, no team_id.
    `INSERT INTO chat_channels (title, description, created_by) VALUES ($1,'desc',$2) RETURNING id`,
    [title, ids.owner]
  ))[0].id;

const newTeamChannel = (teamId: string, title = 'Team chat') =>
  rows<{ id: string; channel_type: string; team_id: string }>(
    `INSERT INTO chat_channels (title, description, created_by, channel_type, team_id) VALUES ($1,'private',$2,'team',$3) RETURNING id, channel_type, team_id`,
    [title, ids.owner, teamId]
  );

describe('chat_channels team linkage on real SQL (US-031 / #378)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
    for (const f of BASE) await db.exec(sqlOf(f));

    ids.owner = (await rows<{ id: string }>(
      "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ('fb-owner','o@x.com','Owner','PART',true) RETURNING id"
    ))[0].id;
    ids.member = (await rows<{ id: string }>(
      "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ('fb-member','m@x.com','Member','PART',true) RETURNING id"
    ))[0].id;

    // Legacy US-030 data created BEFORE the new migration exists.
    ids.legacyA = await newPublic('General');
    ids.legacyB = await newPublic('Hack tips');
    for (const [channel, body] of [[ids.legacyA, 'hello'], [ids.legacyA, 'world'], [ids.legacyB, 'tip one']]) {
      await db.query('INSERT INTO chat_messages (channel_id, author_id, body) VALUES ($1,$2,$3)', [channel, ids.owner, body]);
    }
    legacyBefore = await legacyFingerprint();

    await db.exec(sqlOf(MIGRATION));
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  // =========================================================================
  describe('retaining US-030 public channel behavior', () => {
    it('applies cleanly, and re-applies without error (idempotent)', async () => {
      await expect(db.exec(sqlOf(MIGRATION))).resolves.not.toThrow();
      await expect(db.exec(sqlOf(MIGRATION))).resolves.not.toThrow();
    });

    it('legacy channels and messages are byte-for-byte unchanged by the migration', async () => {
      expect(legacyBefore.c).toBe(2);
      expect(legacyBefore.m).toBe(3);
      expect(await legacyFingerprint()).toEqual(legacyBefore);
    });

    it('every legacy channel became public with no team', async () => {
      const r = await rows<{ channel_type: string; team_id: string | null }>(
        'SELECT channel_type, team_id FROM chat_channels WHERE id = ANY($1::uuid[])',
        [[ids.legacyA, ids.legacyB]]
      );
      expect(r).toHaveLength(2);
      expect(r.every((x) => x.channel_type === 'public' && x.team_id === null)).toBe(true);
    });

    it('the exact INSERT US-030 code uses still works and yields a public channel', async () => {
      const id = await newPublic('Created the US-030 way');
      const r = await rows<{ channel_type: string; team_id: string | null }>('SELECT channel_type, team_id FROM chat_channels WHERE id=$1', [id]);
      expect(r[0]).toEqual({ channel_type: 'public', team_id: null });
    });

    it('an explicit public channel is accepted, and any number of public channels may coexist', async () => {
      expect(await fails("INSERT INTO chat_channels (title,description,created_by,channel_type,team_id) VALUES ('P1','d',$1,'public',NULL)", [ids.owner])).toBeNull();
      expect(await fails("INSERT INTO chat_channels (title,description,created_by,channel_type) VALUES ('P2','d',$1,'public')", [ids.owner])).toBeNull();
      const n = await rows<{ c: number }>("SELECT count(*)::int c FROM chat_channels WHERE team_id IS NULL");
      expect(n[0].c).toBeGreaterThanOrEqual(4);
    });

    it('messages can still be posted to and read from a public channel', async () => {
      await db.query('INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,$3)', [ids.legacyA, ids.member, 'new message']);
      const r = await rows<{ body: string }>('SELECT body FROM chat_messages WHERE channel_id=$1 ORDER BY created_at, id', [ids.legacyA]);
      expect(r.map((x) => x.body)).toContain('new message');
    });

    it('title and description rules from 0041 are unchanged', async () => {
      expect(await fails("INSERT INTO chat_channels (title,description,created_by) VALUES ('  ','d',$1)", [ids.owner])).toMatch(/chk_chat_channels_title_nonempty/);
      expect(await fails("INSERT INTO chat_channels (title,description,created_by) VALUES ('t','  ',$1)", [ids.owner])).toMatch(/chk_chat_channels_description_nonempty/);
    });

    it('deleting a public channel still removes its messages (existing cascade)', async () => {
      const id = await newPublic('Short lived');
      await db.query("INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,'bye')", [id, ids.owner]);
      await db.query('DELETE FROM chat_channels WHERE id=$1', [id]);
      expect((await rows<{ c: number }>('SELECT count(*)::int c FROM chat_messages WHERE channel_id=$1', [id]))[0].c).toBe(0);
    });
  });

  // =========================================================================
  describe('the columns', () => {
    it('channel_type is NOT NULL varchar(10) defaulting to public; team_id is a nullable uuid', async () => {
      const c = await rows<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string; character_maximum_length: number | null }>(
        "SELECT column_name,is_nullable,column_default,data_type,character_maximum_length FROM information_schema.columns WHERE table_name='chat_channels' AND column_name IN ('channel_type','team_id') ORDER BY column_name"
      );
      const byName = Object.fromEntries(c.map((x) => [x.column_name, x]));
      expect(byName.channel_type).toMatchObject({ is_nullable: 'NO', data_type: 'character varying', character_maximum_length: 10 });
      expect(byName.channel_type.column_default).toMatch(/'public'/);
      expect(byName.team_id).toMatchObject({ is_nullable: 'YES', data_type: 'uuid' });
    });

    it('both columns are documented', async () => {
      const r = await rows<{ c: string }>(
        "SELECT col_description('chat_channels'::regclass, a.attnum) c FROM pg_attribute a WHERE a.attrelid='chat_channels'::regclass AND a.attname IN ('channel_type','team_id') ORDER BY a.attname"
      );
      expect(r.every((x) => /US-031/.test(x.c))).toBe(true);
    });
  });

  // =========================================================================
  describe('linking a private channel to an existing team (deterministic rules)', () => {
    it('a team channel with a valid team is created and reads back as type team', async () => {
      const team = await newTeam('alpha');
      const r = await newTeamChannel(team);
      expect(r[0]).toMatchObject({ channel_type: 'team', team_id: team });
    });

    it('a team can have only ONE channel, and the message names the rule', async () => {
      const team = await newTeam('one-only');
      await newTeamChannel(team);
      const err = await fails("INSERT INTO chat_channels (title,description,created_by,channel_type,team_id) VALUES ('dup','d',$1,'team',$2)", [ids.owner, team]);
      expect(err).toMatch(/uq_chat_channels_team_id|duplicate key/i);
      expect((await rows<{ c: number }>('SELECT count(*)::int c FROM chat_channels WHERE team_id=$1', [team]))[0].c).toBe(1);
    });

    it('different teams each get their own channel', async () => {
      const [a, b] = [await newTeam('t-a'), await newTeam('t-b')];
      const [ca, cb] = [(await newTeamChannel(a))[0].id, (await newTeamChannel(b))[0].id];
      expect(ca).not.toBe(cb);
    });

    it.each([
      ['a team channel without a team', "INSERT INTO chat_channels (title,description,created_by,channel_type) VALUES ('x','d',$1,'team')", /chk_chat_channels_team_linkage/],
      ['a team channel with team_id explicitly NULL', "INSERT INTO chat_channels (title,description,created_by,channel_type,team_id) VALUES ('x','d',$1,'team',NULL)", /chk_chat_channels_team_linkage/],
      ['a public channel carrying a team', null, /chk_chat_channels_team_linkage/],
      ['an unknown channel type', "INSERT INTO chat_channels (title,description,created_by,channel_type) VALUES ('x','d',$1,'private')", /chk_chat_channels_channel_type/],
      ['an empty channel type', "INSERT INTO chat_channels (title,description,created_by,channel_type) VALUES ('x','d',$1,'')", /chk_chat_channels_channel_type|chk_chat_channels_team_linkage/],
      ['a NULL channel type', "INSERT INTO chat_channels (title,description,created_by,channel_type) VALUES ('x','d',$1,NULL)", /not-null|null value/i],
      ['a channel type in the wrong case', "INSERT INTO chat_channels (title,description,created_by,channel_type) VALUES ('x','d',$1,'TEAM')", /chk_chat_channels_channel_type|chk_chat_channels_team_linkage/],
    ])('rejects %s and leaves no row behind', async (_label, sql, expected) => {
      const before = (await rows<{ c: number }>('SELECT count(*)::int c FROM chat_channels'))[0].c;
      let err: string | null;
      if (sql === null) {
        const team = await newTeam('pub-with-team');
        err = await fails("INSERT INTO chat_channels (title,description,created_by,channel_type,team_id) VALUES ('x','d',$1,'public',$2)", [ids.owner, team]);
      } else {
        err = await fails(sql, [ids.owner]);
      }
      expect(err).toMatch(expected);
      expect((await rows<{ c: number }>('SELECT count(*)::int c FROM chat_channels'))[0].c).toBe(before);
    });

    it('refuses a team that does not exist', async () => {
      const err = await fails(
        "INSERT INTO chat_channels (title,description,created_by,channel_type,team_id) VALUES ('ghost','d',$1,'team',$2)",
        [ids.owner, '99999999-9999-4999-8999-999999999999']
      );
      expect(err).toMatch(/foreign key|violates/i);
    });

    it('a failed multi-row insert is atomic: nothing from the batch is stored', async () => {
      const team = await newTeam('batch');
      const before = (await rows<{ c: number }>('SELECT count(*)::int c FROM chat_channels'))[0].c;
      const err = await fails(
        `INSERT INTO chat_channels (title,description,created_by,channel_type,team_id) VALUES
           ('ok','d',$1,'team',$2),
           ('bad','d',$1,'team',NULL)`,
        [ids.owner, team]
      );
      expect(err).not.toBeNull();
      expect((await rows<{ c: number }>('SELECT count(*)::int c FROM chat_channels'))[0].c).toBe(before);
    });

    it('a rolled-back transaction leaves no half-linked channel', async () => {
      const team = await newTeam('rollback');
      await db.exec('BEGIN');
      await newTeamChannel(team);
      await db.exec('ROLLBACK');
      expect((await rows<{ c: number }>('SELECT count(*)::int c FROM chat_channels WHERE team_id=$1', [team]))[0].c).toBe(0);
    });

    it('private team messages work like any other chat message', async () => {
      const team = await newTeam('msgs');
      const channel = (await newTeamChannel(team))[0].id;
      await db.query("INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,'secret plan')", [channel, ids.member]);
      const r = await rows<{ body: string }>('SELECT body FROM chat_messages WHERE channel_id=$1', [channel]);
      expect(r.map((x) => x.body)).toEqual(['secret plan']);
    });
  });

  // =========================================================================
  describe('the linkage is permanent', () => {
    it.each([
      ['pointing the channel at another team', async (channel: string) => db.query('UPDATE chat_channels SET team_id=$2 WHERE id=$1', [channel, await newTeam('other')])],
      ['removing the team (team_id NULL)', async (channel: string) => db.query('UPDATE chat_channels SET team_id=NULL WHERE id=$1', [channel])],
      ['turning it into a public channel', async (channel: string) => db.query("UPDATE chat_channels SET channel_type='public', team_id=NULL WHERE id=$1", [channel])],
      ['changing only the type', async (channel: string) => db.query("UPDATE chat_channels SET channel_type='public' WHERE id=$1", [channel])],
    ])('rejects %s on a team channel and changes nothing', async (_label, attempt) => {
      const team = await newTeam('perm');
      const channel = (await newTeamChannel(team))[0].id;
      const before = await rows('SELECT * FROM chat_channels WHERE id=$1', [channel]);
      await expect(attempt(channel)).rejects.toThrow(/CHAT_CHANNEL_LINKAGE_IMMUTABLE|chk_chat_channels/);
      expect(await rows('SELECT * FROM chat_channels WHERE id=$1', [channel])).toEqual(before);
    });

    it('rejects turning a public forum into a team channel', async () => {
      const channel = await newPublic('Stay public');
      const team = await newTeam('convert');
      await expect(db.query("UPDATE chat_channels SET channel_type='team', team_id=$2 WHERE id=$1", [channel, team])).rejects.toThrow(
        /CHAT_CHANNEL_LINKAGE_IMMUTABLE/
      );
      const r = await rows<{ channel_type: string; team_id: string | null }>('SELECT channel_type, team_id FROM chat_channels WHERE id=$1', [channel]);
      expect(r[0]).toEqual({ channel_type: 'public', team_id: null });
    });

    it('re-saving the same values is allowed (idempotent updates do not fail)', async () => {
      const team = await newTeam('same');
      const channel = (await newTeamChannel(team))[0].id;
      await expect(db.query("UPDATE chat_channels SET channel_type='team', team_id=$2 WHERE id=$1", [channel, team])).resolves.toBeDefined();
    });

    it('title and description can still be edited, and updated_at moves forward', async () => {
      const team = await newTeam('edit');
      const channel = (await newTeamChannel(team, 'Old title'))[0].id;
      const before = (await rows<{ updated_at: Date }>('SELECT updated_at FROM chat_channels WHERE id=$1', [channel]))[0].updated_at;
      await db.query("SELECT pg_sleep(0.01)");
      await db.query("UPDATE chat_channels SET title='New title', description='New description' WHERE id=$1", [channel]);
      const after = (await rows<{ title: string; description: string; updated_at: Date; team_id: string }>('SELECT title,description,updated_at,team_id FROM chat_channels WHERE id=$1', [channel]))[0];
      expect(after).toMatchObject({ title: 'New title', description: 'New description', team_id: team });
      expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // =========================================================================
  describe('team lifecycle never removes channel history (RESTRICT)', () => {
    it('a team that has a channel cannot be deleted, and both stay intact', async () => {
      const team = await newTeam('keep');
      const channel = (await newTeamChannel(team))[0].id;
      await db.query("INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,'history')", [channel, ids.owner]);

      await expect(db.query('DELETE FROM teams WHERE id=$1', [team])).rejects.toThrow(/foreign key|violates/i);

      expect((await rows<{ c: number }>('SELECT count(*)::int c FROM teams WHERE id=$1', [team]))[0].c).toBe(1);
      expect((await rows<{ body: string }>('SELECT body FROM chat_messages WHERE channel_id=$1', [channel]))[0].body).toBe('history');
    });

    it('the restriction applies only to teams that are linked: a team without a channel is unaffected', async () => {
      const team = await newTeam('no-channel');
      await expect(db.query('DELETE FROM teams WHERE id=$1', [team])).resolves.toBeDefined();
    });

    it.each(['Locked', 'Disbanded', 'Open'])('moving the team to %s does not touch its channel or messages', async (status) => {
      const team = await newTeam(`life-${status}`);
      const channel = (await newTeamChannel(team))[0].id;
      await db.query("INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,'before')", [channel, ids.owner]);
      const before = await rows('SELECT * FROM chat_channels WHERE id=$1', [channel]);

      await db.query('UPDATE teams SET recruitment_status=$2 WHERE id=$1', [team, status]);

      expect(await rows('SELECT * FROM chat_channels WHERE id=$1', [channel])).toEqual(before);
      expect((await rows<{ c: number }>('SELECT count(*)::int c FROM chat_messages WHERE channel_id=$1', [channel]))[0].c).toBe(1);
    });

    it('a deleted channel (not team) removes only its own messages, never the team', async () => {
      const team = await newTeam('chan-delete');
      const channel = (await newTeamChannel(team))[0].id;
      await db.query("INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,'x')", [channel, ids.owner]);
      await db.query('DELETE FROM chat_channels WHERE id=$1', [channel]);
      expect((await rows<{ c: number }>('SELECT count(*)::int c FROM teams WHERE id=$1', [team]))[0].c).toBe(1);
    });
  });

  // =========================================================================
  describe('lookup indexes', () => {
    it('defines the unique per-team index and the public-listing index with the right predicates', async () => {
      const r = await rows<{ indexname: string; indexdef: string }>(
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='chat_channels' AND indexname IN ('uq_chat_channels_team_id','idx_chat_channels_public_created_at')"
      );
      const byName = Object.fromEntries(r.map((x) => [x.indexname, x.indexdef]));
      expect(byName.uq_chat_channels_team_id).toMatch(/UNIQUE INDEX .*\(team_id\) WHERE \(team_id IS NOT NULL\)/);
      expect(byName.idx_chat_channels_public_created_at).toMatch(/\(created_at DESC\) WHERE \(\(channel_type\)::text = 'public'::text\)/);
    });

    it('the team lookup is served by the unique index', async () => {
      const team = await newTeam('lookup');
      await newTeamChannel(team);
      await db.exec('ANALYZE chat_channels; SET enable_seqscan = off');
      try {
        const plan = (await rows<{ 'QUERY PLAN': string }>('EXPLAIN SELECT * FROM chat_channels WHERE team_id = $1', [team])).map((p) => p['QUERY PLAN']).join('\n');
        expect(plan).toMatch(/uq_chat_channels_team_id/);
      } finally {
        await db.exec('RESET enable_seqscan');
      }
    });

    it('the newest-first public listing is served by its own index, in order, without a sort', async () => {
      await db.exec('ANALYZE chat_channels; SET enable_seqscan = off');
      try {
        const plan = (
          await rows<{ 'QUERY PLAN': string }>("EXPLAIN SELECT * FROM chat_channels WHERE channel_type='public' ORDER BY created_at DESC LIMIT 25")
        ).map((p) => p['QUERY PLAN']).join('\n');
        expect(plan).toMatch(/idx_chat_channels_public_created_at/);
        expect(plan).not.toMatch(/(^|->\s+)Sort\s+\(/m);
      } finally {
        await db.exec('RESET enable_seqscan');
      }
    });

    it('the public listing query returns every public channel and no team channel', async () => {
      const team = await newTeam('hidden');
      const hidden = (await newTeamChannel(team, 'Private team chat'))[0].id;
      const listed = await rows<{ id: string; channel_type: string }>("SELECT id, channel_type FROM chat_channels WHERE channel_type='public' ORDER BY created_at DESC");
      expect(listed.map((c) => c.id)).not.toContain(hidden);
      expect(listed.every((c) => c.channel_type === 'public')).toBe(true);
      expect(listed.map((c) => c.id)).toEqual(expect.arrayContaining([ids.legacyA, ids.legacyB]));
    });

    it('looking up a team that has no channel finds nothing', async () => {
      const team = await newTeam('empty');
      expect(await rows('SELECT id FROM chat_channels WHERE team_id=$1', [team])).toEqual([]);
    });
  });

  // =========================================================================
  describe('guards and housekeeping', () => {
    it('adds exactly the new triggers and indexes, without disturbing the existing ones', async () => {
      const triggers = (await rows<{ tgname: string }>("SELECT tgname FROM pg_trigger WHERE tgrelid='chat_channels'::regclass AND NOT tgisinternal ORDER BY 1")).map((t) => t.tgname);
      expect(triggers).toEqual(['trigger_chat_channels_prevent_relinking', 'trigger_chat_channels_updated_at']);
      const idx = (await rows<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename='chat_channels' ORDER BY 1")).map((i) => i.indexname);
      expect(idx).toEqual(
        expect.arrayContaining([
          'chat_channels_pkey',
          'idx_chat_channels_created_at',
          'idx_chat_channels_created_by',
          'idx_chat_channels_public_created_at',
          'uq_chat_channels_team_id',
        ])
      );
    });

    it('row-level security is still on with no policies (access stays API-only)', async () => {
      const r = await rows<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname='chat_channels'");
      expect(r[0].relrowsecurity).toBe(true);
      expect((await rows<{ c: number }>("SELECT count(*)::int c FROM pg_policies WHERE tablename='chat_channels'"))[0].c).toBe(0);
    });
  });
});
