/**
 * US-033 / #392 — moderation-case chat target types verified against the
 * real migration in an in-process PostgreSQL-compatible database.
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
  '0037_create_moderation_cases.sql',
  '0041_create_chat_channel_message_models.sql',
  '0048_create_moderation_reports.sql',
];
const migration = '0056_extend_moderation_case_chat_targets.sql';
const sqlOf = (file: string) =>
  fs.readFileSync(path.join(migrationDirectory, file), 'utf8');

let db: PGlite;
let adminId: string;
let participantId: string;
let channelId: string;
let messageId: string;

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

describe('moderation_cases chat targets on real SQL (US-033 / #392)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
    );
    for (const file of baseMigrations) await db.exec(sqlOf(file));

    adminId = (
      await rows<{ id: string }>(
        "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ('fb-admin','admin@example.test','Admin','ADMIN',true) RETURNING id"
      )
    )[0].id;
    participantId = (
      await rows<{ id: string }>(
        "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ('fb-part','part@example.test','Part','PART',true) RETURNING id"
      )
    )[0].id;
    channelId = (
      await rows<{ id: string }>(
        "INSERT INTO chat_channels (title,description,created_by) VALUES ('General','Public forum',$1) RETURNING id",
        [participantId]
      )
    )[0].id;
    messageId = (
      await rows<{ id: string }>(
        "INSERT INTO chat_messages (channel_id,author_id,body) VALUES ($1,$2,'Moderate this message') RETURNING id",
        [channelId, participantId]
      )
    )[0].id;

    for (const [targetType, flaggedUrl] of [
      ['team', null],
      ['profile', null],
      ['event', null],
      ['url', 'https://example.test/flagged'],
    ] as const) {
      await db.query(
        `INSERT INTO moderation_cases (target_type,target_id,reason,created_by,flagged_url)
         VALUES ($1,gen_random_uuid(),'Existing case',$2,$3)`,
        [targetType, adminId, flaggedUrl]
      );
    }

    await db.exec(sqlOf(migration));
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('re-applies safely and preserves every existing target type and row', async () => {
    await expect(db.exec(sqlOf(migration))).resolves.not.toThrow();

    const existing = await rows<{ target_type: string; count: number }>(
      `SELECT target_type, count(*)::int AS count
       FROM moderation_cases
       WHERE target_type IN ('team','profile','event','url')
       GROUP BY target_type
       ORDER BY target_type`
    );

    expect(existing).toEqual([
      { target_type: 'event', count: 1 },
      { target_type: 'profile', count: 1 },
      { target_type: 'team', count: 1 },
      { target_type: 'url', count: 1 },
    ]);
  });

  it.each([
    ['chat_channel', () => channelId],
    ['chat_message', () => messageId],
  ] as const)('accepts the %s polymorphic target type', async (targetType, targetId) => {
    await expect(
      db.query(
        `INSERT INTO moderation_cases (target_type,target_id,reason,created_by)
         VALUES ($1,$2,'Chat target',$3)`,
        [targetType, targetId(), adminId]
      )
    ).resolves.toBeDefined();
  });

  it('rejects unsupported target types at the database boundary', async () => {
    expect(
      await failure(
        `INSERT INTO moderation_cases (target_type,target_id,reason,created_by)
         VALUES ('direct_message',gen_random_uuid(),'Unsupported',$1)`,
        [adminId]
      )
    ).toMatch(/moderation_cases_target_type_check|check constraint/i);
  });

  it('keeps target_id polymorphic with no physical chat foreign key', async () => {
    const foreignKeys = await rows<{ column_name: string; foreign_table_name: string }>(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.constraint_schema = kcu.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.table_name = 'moderation_cases'
         AND tc.constraint_type = 'FOREIGN KEY'`
    );

    expect(foreignKeys).toEqual([
      { column_name: 'created_by', foreign_table_name: 'participants' },
    ]);
    expect(foreignKeys.some((key) => key.column_name === 'target_id')).toBe(false);
  });

  it('installs one CHECK constraint containing old and new target names', async () => {
    const constraints = await rows<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'moderation_cases'::regclass
         AND conname = 'moderation_cases_target_type_check'`
    );

    expect(constraints).toHaveLength(1);
    expect(constraints[0].definition).toMatch(/team/);
    expect(constraints[0].definition).toMatch(/profile/);
    expect(constraints[0].definition).toMatch(/event/);
    expect(constraints[0].definition).toMatch(/url/);
    expect(constraints[0].definition).toMatch(/chat_channel/);
    expect(constraints[0].definition).toMatch(/chat_message/);
  });
});
