/**
 * US-033 / #395 — participant chat-message reports verified against the real
 * US-025, chat, team-channel, DM, moderation-target, and #395 migrations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(__dirname, '../../../supabase/migrations');
const baseMigrations = [
  '0001_create_participants_table.sql',
  '0004_create_profile_tables.sql',
  '0005_create_pending_event_submissions.sql',
  '0007_create_events_table.sql',
  '0010_add_participant_suspension.sql',
  '0011_create_team_recruitment_tables.sql',
  '0037_create_moderation_cases.sql',
  '0038_moderation_enforcement_fields.sql',
  '0039_account_enforcement_models.sql',
  '0041_create_chat_channel_message_models.sql',
  '0048_create_moderation_reports.sql',
  '0051_add_team_channel_linkage_to_chat_channels.sql',
  '0053_create_direct_message_threads.sql',
  '0054_create_participant_blocks.sql',
  '0055_create_direct_messages.sql',
  '0056_extend_moderation_case_chat_targets.sql',
];
const migration = '0057_connect_chat_message_reports.sql';
const sqlOf = (file: string) => fs.readFileSync(path.join(migrationDirectory, file), 'utf8');

let db: PGlite;
let reporterId: string;
let teammateId: string;
let unrelatedId: string;
let eventId: string;
let teamId: string;
let publicMessageId: string;
let teamMessageId: string;
let directMessageId: string;

const rows = async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];

async function failure(sql: string, params?: unknown[]): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

async function submitReport(reporter: string, target: string) {
  return rows<{ report_id: string; case_id: string; reports_used_in_window: number }>(
    `SELECT * FROM submit_moderation_report(
      $1::uuid,
      'chat_message'::varchar,
      $2::uuid,
      'Harassment'::varchar,
      'Visible abusive message'::text,
      NULL::varchar
    )`,
    [reporter, target]
  );
}

describe('participant chat-message reports on real SQL (US-033 / #395)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    for (const file of baseMigrations) await db.exec(sqlOf(file));

    eventId = (
      await rows<{ id: string }>(
        `INSERT INTO events (
          title, official_url, normalized_url, start_date, end_date, format, min_team_size, max_team_size
        ) VALUES (
          'Shadow Event', 'https://example.test/event', 'https://example.test/event',
          NOW(), NOW() + INTERVAL '30 days', 'Online', 2, 4
        ) RETURNING id`
      )
    )[0].id;

    reporterId = (
      await rows<{ id: string }>(
        "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ('fb-reporter','reporter@example.test','Reporter','PART',true) RETURNING id"
      )
    )[0].id;
    teammateId = (
      await rows<{ id: string }>(
        "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ('fb-teammate','teammate@example.test','Teammate','PART',true) RETURNING id"
      )
    )[0].id;
    unrelatedId = (
      await rows<{ id: string }>(
        "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ('fb-unrelated','unrelated@example.test','Unrelated','PART',true) RETURNING id"
      )
    )[0].id;

    teamId = (
      await rows<{ id: string }>(
        `INSERT INTO teams (
          event_id, owner_participant_id, name, pitch, goal, commitment_hours, recruitment_status
        ) VALUES ($1,$2,'Private Team','Build safely','Learning',10,'Open') RETURNING id`,
        [eventId, reporterId]
      )
    )[0].id;
    await db.query(
      `INSERT INTO team_memberships (team_id,event_id,participant_id,role,status)
       VALUES ($1,$2,$3,'Owner','Confirmed'),($1,$2,$4,'Member','Confirmed')`,
      [teamId, eventId, reporterId, teammateId]
    );

    const publicChannelId = (
      await rows<{ id: string }>(
        "INSERT INTO chat_channels (title,description,created_by) VALUES ('General','Public forum',$1) RETURNING id",
        [reporterId]
      )
    )[0].id;
    const teamChannelId = (
      await rows<{ id: string }>(
        `INSERT INTO chat_channels (title,description,created_by,channel_type,team_id)
         VALUES ('Private Team','Private forum',$1,'team',$2) RETURNING id`,
        [reporterId, teamId]
      )
    )[0].id;
    publicMessageId = (
      await rows<{ id: string }>(
        "INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,'Public target') RETURNING id",
        [publicChannelId, teammateId]
      )
    )[0].id;
    teamMessageId = (
      await rows<{ id: string }>(
        "INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,'Private target') RETURNING id",
        [teamChannelId, teammateId]
      )
    )[0].id;

    const threadId = (
      await rows<{ id: string }>(
        `INSERT INTO direct_message_threads (participant_low_id,participant_high_id)
         VALUES (LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid)) RETURNING id`,
        [reporterId, teammateId]
      )
    )[0].id;
    directMessageId = (
      await rows<{ id: string }>(
        "INSERT INTO direct_messages (thread_id,author_id,body) VALUES ($1,$2,'DM target') RETURNING id",
        [threadId, teammateId]
      )
    )[0].id;

    await db.exec(sqlOf(migration));
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('re-applies safely and preserves existing report target types', async () => {
    await expect(db.exec(sqlOf(migration))).resolves.not.toThrow();
    const constraints = await rows<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'moderation_reports'::regclass
          AND conname = 'moderation_reports_target_type_check'`
    );
    expect(constraints).toHaveLength(1);
    expect(constraints[0].definition).toMatch(/team/);
    expect(constraints[0].definition).toMatch(/profile/);
    expect(constraints[0].definition).toMatch(/event/);
    expect(constraints[0].definition).toMatch(/url/);
    expect(constraints[0].definition).toMatch(/chat_message/);
  });

  it('submits a public-message report into the existing case pipeline', async () => {
    const result = await submitReport(reporterId, publicMessageId);
    expect(result).toHaveLength(1);
    expect(result[0].reports_used_in_window).toBe(1);

    const linked = await rows<{ target_type: string; report_count: number }>(
      `SELECT target_type, report_count FROM moderation_cases WHERE id = $1`,
      [result[0].case_id]
    );
    expect(linked).toEqual([{ target_type: 'chat_message', report_count: 1 }]);
  });

  it('allows a confirmed member to report a private team message', async () => {
    const result = await submitReport(reporterId, teamMessageId);
    expect(result).toHaveLength(1);
    expect(result[0].case_id).toBeTruthy();
  });

  it('rejects an unrelated participant without confirming the private team message', async () => {
    expect(await failure(
      `SELECT * FROM submit_moderation_report(
        $1::uuid,'chat_message'::varchar,$2::uuid,'Harassment'::varchar,NULL::text,NULL::varchar
      )`,
      [unrelatedId, teamMessageId]
    )).toMatch(/TARGET_NOT_FOUND/);
  });

  it('does not treat a direct_messages UUID as the #392 chat_message target', async () => {
    expect(await failure(
      `SELECT * FROM submit_moderation_report(
        $1::uuid,'chat_message'::varchar,$2::uuid,'Harassment'::varchar,NULL::text,NULL::varchar
      )`,
      [unrelatedId, directMessageId]
    )).toMatch(/TARGET_NOT_FOUND/);
  });

  it('preserves the US-025 duplicate policy: separate reports link to one open case', async () => {
    const first = await submitReport(teammateId, publicMessageId);
    const second = await submitReport(teammateId, publicMessageId);

    expect(second[0].case_id).toBe(first[0].case_id);
    const linked = await rows<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM moderation_reports
        WHERE case_id = $1
          AND reporter_id = $2`,
      [first[0].case_id, teammateId]
    );
    expect(linked[0].count).toBe(2);
  });

  it('keeps polymorphic target_id free of a physical chat foreign key', async () => {
    const foreignKeys = await rows<{ column_name: string }>(
      `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.constraint_schema = kcu.constraint_schema
        WHERE tc.table_name = 'moderation_reports'
          AND tc.constraint_type = 'FOREIGN KEY'`
    );
    expect(foreignKeys.map((row) => row.column_name).sort()).toEqual([
      'case_id',
      'reporter_id',
    ]);
  });
});
