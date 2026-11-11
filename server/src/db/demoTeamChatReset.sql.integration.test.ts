/**
 * #437 — the guarded demo team-chat removal (migration 0062) verified on the real SQL of
 * 0041, 0051, 0052, 0053 and 0055: it removes the private chat of DEMO teams so the demo can be
 * re-seeded, refuses every other team, and leaves the history protections of 0052 fully in force.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const sqlOf = (file: string): string => fs.readFileSync(path.join(DIR, file), 'utf8');

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
const count = async (table: string): Promise<number> =>
  Number((await rows<{ n: number | bigint }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n);

const id = {
  demoOwner: '10000000-0000-4000-8000-000000000003',
  demoMember: '10000000-0000-4000-8000-000000000004',
  realOwner: '20000000-0000-4000-8000-000000000001',
  demoTeam: '30000000-0000-4000-8000-000000000001',
  demoTeam2: '30000000-0000-4000-8000-000000000002',
  realTeam: '40000000-0000-4000-8000-000000000001',
  demoChannel: '35000000-0000-4000-8000-000000000001',
  demoChannel2: '35000000-0000-4000-8000-000000000002',
  realChannel: '45000000-0000-4000-8000-000000000001',
  publicChannel: '46000000-0000-4000-8000-000000000001',
  thread: '37000000-0000-4000-8000-000000000001',
} as const;

const REMOVE = 'SELECT * FROM demo_remove_team_chat($1::uuid[])';

async function seedDemoChat(): Promise<void> {
  await db.query(
    `INSERT INTO chat_channels (id, title, description, created_by, channel_type, team_id) VALUES
       ($1, 'Team: Civic Signal', 'demo team channel', $4, 'team', $5),
       ($2, 'Team: Campus Compass', 'demo team channel', $4, 'team', $6),
       ($3, 'Team: Real Team', 'real team channel', $7, 'team', $8)`,
    [id.demoChannel, id.demoChannel2, id.realChannel, id.demoOwner, id.demoTeam, id.demoTeam2, id.realOwner, id.realTeam]
  );
  await db.query(
    `INSERT INTO chat_channels (id, title, description, created_by) VALUES ($1, 'Public forum', 'open', $2)`,
    [id.publicChannel, id.realOwner]
  );
  await db.query(
    `INSERT INTO chat_messages (channel_id, author_id, body) VALUES
       ($1, $3, 'welcome'), ($1, $3, 'next steps'), ($2, $3, 'hello campus'), ($2, $4, 'hi!')`,
    [id.demoChannel, id.demoChannel2, id.demoOwner, id.demoMember]
  );
  await db.query(`INSERT INTO chat_messages (channel_id, author_id, body) VALUES ($1, $2, 'real message')`, [
    id.realChannel,
    id.realOwner,
  ]);
  await db.query(`INSERT INTO chat_messages (channel_id, author_id, body) VALUES ($1, $2, 'public message')`, [
    id.publicChannel,
    id.realOwner,
  ]);
}

describe('demo team chat reset on real SQL (#437 / migration 0062)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    for (const file of [
      '0001_create_participants_table.sql',
      '0010_add_participant_suspension.sql',
      '0039_account_enforcement_models.sql',
      '0004_create_profile_tables.sql',
      '0041_create_chat_channel_message_models.sql',
    ]) {
      await db.exec(sqlOf(file));
    }
    await db.exec(
      `CREATE TABLE teams (
         id UUID PRIMARY KEY,
         owner_participant_id UUID NOT NULL REFERENCES participants(id),
         recruitment_status VARCHAR(20) NOT NULL DEFAULT 'Open'
       );
       CREATE TABLE team_memberships (
         id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
         team_id UUID NOT NULL REFERENCES teams(id),
         participant_id UUID NOT NULL REFERENCES participants(id),
         status VARCHAR(20) NOT NULL
       );`
    );
    for (const file of [
      '0051_add_team_channel_linkage_to_chat_channels.sql',
      '0052_enforce_team_channel_lifecycle.sql',
      '0053_create_direct_message_threads.sql',
      '0055_create_direct_messages.sql',
      '0062_create_demo_team_chat_reset.sql',
    ]) {
      await db.exec(sqlOf(file));
    }
    for (const [pid, uid] of [
      [id.demoOwner, 'hm-demo-v1-part-avery'],
      [id.demoMember, 'hm-demo-v1-part-blake'],
      [id.realOwner, 'real-user-uid'],
    ] as const) {
      await db.query(
        `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
         VALUES ($1, $2, $3, 'Test', 'PART', TRUE)`,
        [pid, uid, `${uid}@example.test`]
      );
    }
    await db.query(`INSERT INTO teams (id, owner_participant_id) VALUES ($1, $4), ($2, $4), ($3, $5)`, [
      id.demoTeam,
      id.demoTeam2,
      id.realTeam,
      id.demoOwner,
      id.realOwner,
    ]);
    await db.query(
      `INSERT INTO team_memberships (team_id, participant_id, status) VALUES
         ($1, $3, 'Confirmed'), ($2, $3, 'Confirmed'), ($2, $4, 'Confirmed'), ($5, $6, 'Confirmed')`,
      [id.demoTeam, id.demoTeam2, id.demoOwner, id.demoMember, id.realTeam, id.realOwner]
    );
  }, 60_000);

  beforeEach(async () => {
    await db.exec('DELETE FROM direct_messages; DELETE FROM direct_message_threads;');
    // Reset the chat fixtures through the same function (demo) and by hand for the others.
    await db.query(REMOVE, [[id.demoTeam, id.demoTeam2]]);
    await db.exec(
      `ALTER TABLE chat_messages DISABLE TRIGGER trigger_chat_messages_protect_team_history;
       ALTER TABLE chat_channels DISABLE TRIGGER trigger_chat_channels_protect_team_deletion;
       DELETE FROM chat_messages; DELETE FROM chat_channels;
       ALTER TABLE chat_messages ENABLE TRIGGER trigger_chat_messages_protect_team_history;
       ALTER TABLE chat_channels ENABLE TRIGGER trigger_chat_channels_protect_team_deletion;`
    );
    await seedDemoChat();
  });

  afterAll(async () => {
    await db.close();
  });

  it('seeded team messages are accepted only from confirmed members (the rule the seed manifest mirrors)', async () => {
    expect(await count('chat_messages')).toBe(6);
    const refused = await failure(
      `INSERT INTO chat_messages (channel_id, author_id, body) VALUES ($1, $2, 'not a member')`,
      [id.demoChannel, id.demoMember]
    );
    expect(refused).toContain('TEAM_CHANNEL_NOT_A_MEMBER');
  });

  it('without the function, a team channel and its messages cannot be deleted (0052 is intact)', async () => {
    expect(await failure('DELETE FROM chat_messages WHERE channel_id = $1', [id.demoChannel])).toContain(
      'TEAM_CHANNEL_HISTORY_IMMUTABLE'
    );
    expect(await failure('DELETE FROM chat_channels WHERE id = $1', [id.demoChannel])).toContain(
      'TEAM_CHANNEL_HISTORY_IMMUTABLE'
    );
    expect(await failure('DELETE FROM team_memberships WHERE team_id = $1', [id.demoTeam])).toContain(
      'TEAM_MEMBERSHIP_HISTORY_IMMUTABLE'
    );
  });

  it('removes the channels and messages of the demo teams, and reports how many', async () => {
    const [result] = await rows<{ channels_removed: number; messages_removed: number }>(REMOVE, [
      [id.demoTeam, id.demoTeam2],
    ]);
    expect(Number(result!.channels_removed)).toBe(2);
    expect(Number(result!.messages_removed)).toBe(4);
    const left = await rows<{ id: string }>('SELECT id FROM chat_channels ORDER BY id');
    expect(left.map((row) => row.id)).toEqual([id.realChannel, id.publicChannel].sort());
  });

  it('after the removal the demo teams can be deleted and recreated, which is what re-seeding does', async () => {
    await db.query(REMOVE, [[id.demoTeam, id.demoTeam2]]);
    await expect(db.query('DELETE FROM team_memberships WHERE team_id = ANY($1::uuid[])', [[id.demoTeam, id.demoTeam2]])).resolves.toBeTruthy();
    await expect(db.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [[id.demoTeam, id.demoTeam2]])).resolves.toBeTruthy();
    // restore for later tests
    await db.query(`INSERT INTO teams (id, owner_participant_id) VALUES ($1, $3), ($2, $3)`, [id.demoTeam, id.demoTeam2, id.demoOwner]);
    await db.query(
      `INSERT INTO team_memberships (team_id, participant_id, status) VALUES ($1, $3, 'Confirmed'), ($2, $3, 'Confirmed'), ($2, $4, 'Confirmed')`,
      [id.demoTeam, id.demoTeam2, id.demoOwner, id.demoMember]
    );
  });

  it('refuses a team that is not owned by a demo account, and removes nothing at all', async () => {
    expect(await failure(REMOVE, [[id.realTeam]])).toContain('DEMO_CHAT_RESET_NOT_DEMO_TEAM');
    expect(await failure(REMOVE, [[id.demoTeam, id.realTeam]])).toContain('DEMO_CHAT_RESET_NOT_DEMO_TEAM');
    expect(await count('chat_channels')).toBe(4);
    expect(await count('chat_messages')).toBe(6);
  });

  it('never touches a real team, the public forum or direct messages', async () => {
    await db.query(
      `INSERT INTO direct_message_threads (id, participant_low_id, participant_high_id) VALUES ($1, $2, $3)`,
      [id.thread, id.demoOwner, id.demoMember]
    );
    await db.query(`INSERT INTO direct_messages (thread_id, author_id, body) VALUES ($1, $2, 'hi')`, [id.thread, id.demoOwner]);

    await db.query(REMOVE, [[id.demoTeam, id.demoTeam2]]);

    expect(await rows('SELECT 1 FROM chat_channels WHERE id = $1', [id.realChannel])).toHaveLength(1);
    expect(await rows('SELECT 1 FROM chat_messages WHERE channel_id = $1', [id.realChannel])).toHaveLength(1);
    expect(await rows('SELECT 1 FROM chat_channels WHERE id = $1', [id.publicChannel])).toHaveLength(1);
    expect(await rows('SELECT 1 FROM chat_messages WHERE channel_id = $1', [id.publicChannel])).toHaveLength(1);
    expect(await count('direct_message_threads')).toBe(1);
    expect(await count('direct_messages')).toBe(1);
  });

  it('leaves the history protections switched back on afterwards, also after a refusal', async () => {
    await db.query(REMOVE, [[id.demoTeam]]);
    await failure(REMOVE, [[id.realTeam]]);

    expect(await failure('DELETE FROM chat_messages WHERE channel_id = $1', [id.demoChannel2])).toContain(
      'TEAM_CHANNEL_HISTORY_IMMUTABLE'
    );
    expect(await failure('DELETE FROM chat_channels WHERE id = $1', [id.demoChannel2])).toContain(
      'TEAM_CHANNEL_HISTORY_IMMUTABLE'
    );
    const triggers = await rows<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger
       WHERE tgname IN ('trigger_chat_messages_protect_team_history', 'trigger_chat_channels_protect_team_deletion')`
    );
    expect(triggers).toHaveLength(2);
    expect(triggers.every((row) => row.tgenabled === 'O')).toBe(true);
  });

  it('does nothing for an empty list, a missing team or a demo team that has no chat', async () => {
    expect(Number((await rows<{ channels_removed: number }>(REMOVE, [[]]))[0]!.channels_removed)).toBe(0);
    expect(Number((await rows<{ channels_removed: number }>(REMOVE, [['99999999-0000-4000-8000-000000000009']]))[0]!.channels_removed)).toBe(0);
    await db.query(REMOVE, [[id.demoTeam, id.demoTeam2]]);
    expect(Number((await rows<{ channels_removed: number }>(REMOVE, [[id.demoTeam]]))[0]!.channels_removed)).toBe(0);
  });

  it('can be run again after a reseed (idempotent)', async () => {
    await db.query(REMOVE, [[id.demoTeam, id.demoTeam2]]);
    await db.query(
      `INSERT INTO chat_channels (id, title, description, created_by, channel_type, team_id)
       VALUES ($1, 'Team: Civic Signal', 'recreated', $2, 'team', $3)`,
      [id.demoChannel, id.demoOwner, id.demoTeam]
    );
    await db.query(`INSERT INTO chat_messages (channel_id, author_id, body) VALUES ($1, $2, 'again')`, [id.demoChannel, id.demoOwner]);
    const [result] = await rows<{ channels_removed: number; messages_removed: number }>(REMOVE, [[id.demoTeam, id.demoTeam2]]);
    expect(Number(result!.channels_removed)).toBe(1);
    expect(Number(result!.messages_removed)).toBe(1);
  });

  it('can be executed by the service role only', async () => {
    const privileges = await rows<{ role: string; allowed: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'demo_remove_team_chat(uuid[])', 'EXECUTE') AS allowed
       FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r`
    );
    const byRole = Object.fromEntries(privileges.map((row) => [row.role, row.allowed]));
    expect(byRole).toEqual({ anon: false, authenticated: false, service_role: true });
  });

  it('is additive/idempotent and uses the unique next migration number', async () => {
    await expect(db.exec(sqlOf('0062_create_demo_team_chat_reset.sql'))).resolves.not.toThrow();
    const files = fs.readdirSync(DIR).filter((file) => file.startsWith('0062_'));
    expect(files).toEqual(['0062_create_demo_team_chat_reset.sql']);
  });
});
