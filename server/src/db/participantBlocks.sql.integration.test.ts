/** US-032 / #388 — participant_blocks on the REAL SQL (in-process Postgres). */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const FILES = ['0001_create_participants_table.sql', '0054_create_participant_blocks.sql'];
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
let seq = 0;
const person = async () => {
  seq += 1;
  return (await rows<{ id: string }>(
    "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ($1,$2,'P','PART',true) RETURNING id",
    [`fb-${seq}`, `p${seq}@x.com`]
  ))[0].id;
};
const block = (a: string, b: string) => fails('INSERT INTO participant_blocks (blocker_id, blocked_id) VALUES ($1,$2)', [a, b]);

describe('participant_blocks on real SQL (US-032 / #388)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
    for (const f of FILES) await db.exec(sqlOf(f));
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('applies idempotently', async () => {
    await expect(db.exec(sqlOf(FILES[1]))).resolves.not.toThrow();
  });

  it('records a directional block and lets the other direction exist independently', async () => {
    const [a, b] = [await person(), await person()];
    expect(await block(a, b)).toBeNull();
    expect(await block(b, a)).toBeNull();
    expect((await rows('SELECT 1 FROM participant_blocks WHERE blocker_id=$1 AND blocked_id=$2', [a, b]))).toHaveLength(1);
  });

  it('rejects a duplicate block and a self-block', async () => {
    const [a, b] = [await person(), await person()];
    await block(a, b);
    expect(await block(a, b)).toMatch(/duplicate key|participant_blocks_pkey/);
    expect(await block(a, a)).toMatch(/chk_participant_blocks_not_self/);
  });

  it('refuses a participant that does not exist, on either side', async () => {
    const a = await person();
    const ghost = '99999999-9999-4999-8999-999999999999';
    expect(await block(a, ghost)).toMatch(/foreign key|violates/i);
    expect(await block(ghost, a)).toMatch(/foreign key|violates/i);
  });

  it('neither the blocker nor the blocked participant can be deleted while the block exists', async () => {
    const [a, b] = [await person(), await person()];
    await block(a, b);
    expect(await fails('DELETE FROM participants WHERE id=$1', [a])).toMatch(/foreign key|violates/i);
    expect(await fails('DELETE FROM participants WHERE id=$1', [b])).toMatch(/foreign key|violates/i);
  });

  it('an unblock (deleting the row) is allowed', async () => {
    const [a, b] = [await person(), await person()];
    await block(a, b);
    expect(await fails('DELETE FROM participant_blocks WHERE blocker_id=$1 AND blocked_id=$2', [a, b])).toBeNull();
  });

  it('has row level security enabled with no public policies, and a lookup index on blocked_id', async () => {
    expect((await rows<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname='participant_blocks'"))[0].relrowsecurity).toBe(true);
    expect(await rows("SELECT 1 FROM pg_policies WHERE tablename='participant_blocks'")).toHaveLength(0);
    expect(await rows("SELECT 1 FROM pg_indexes WHERE indexname='idx_participant_blocks_blocked'")).toHaveLength(1);
  });
});
