/**
 * US-032 / #386 — direct-message thread table on the REAL SQL (in-process Postgres).
 * Also proves the TypeScript canonical ordering agrees with PostgreSQL's uuid ordering.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { canonicalParticipantPair } from './directMessage.repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const FILES = ['0001_create_participants_table.sql', '0053_create_direct_message_threads.sql'];
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

describe('direct_message_threads on real SQL (US-032 / #386)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
    // 0053 uses set_updated_at(), created by an earlier migration.
    await db.exec(`CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;`);
    for (const f of FILES) await db.exec(sqlOf(f));
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it('applies idempotently', async () => {
    await expect(db.exec(sqlOf(FILES[1]))).resolves.not.toThrow();
  });

  it('accepts a canonical pair and rejects the reversed pair and a self pair', async () => {
    const [a, b] = [await person(), await person()];
    const pair = canonicalParticipantPair(a, b)!;
    expect(await fails('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$2)', [pair.low, pair.high])).toBeNull();
    expect(await fails('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$2)', [pair.high, pair.low])).toMatch(/chk_direct_message_threads_canonical_pair/);
    expect(await fails('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$1)', [a])).toMatch(/chk_direct_message_threads_canonical_pair/);
  });

  it('allows only ONE thread per pair', async () => {
    const [a, b] = [await person(), await person()];
    const { low, high } = canonicalParticipantPair(a, b)!;
    await db.query('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$2)', [low, high]);
    expect(await fails('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$2)', [low, high])).toMatch(/uq_direct_message_threads_pair|duplicate key/);
  });

  it('TypeScript canonical ordering matches PostgreSQL for many random pairs', async () => {
    for (let i = 0; i < 60; i += 1) {
      const [x, y] = [randomUUID(), randomUUID()];
      const ts = canonicalParticipantPair(x, y)!;
      const pg = (await rows<{ low: string; high: string }>(
        'SELECT LEAST($1::uuid,$2::uuid)::text AS low, GREATEST($1::uuid,$2::uuid)::text AS high',
        [x, y]
      ))[0];
      expect(ts).toEqual(pg);
    }
  });

  it('participants of a thread cannot be changed', async () => {
    const [a, b, c] = [await person(), await person(), await person()];
    const { low, high } = canonicalParticipantPair(a, b)!;
    await db.query('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$2)', [low, high]);
    expect(await fails('UPDATE direct_message_threads SET participant_high_id=$1 WHERE participant_low_id=$2 AND participant_high_id=$3', [c, low, high])).toMatch(/DIRECT_MESSAGE_THREAD_PARTICIPANTS_IMMUTABLE/);
    expect(await fails('UPDATE direct_message_threads SET updated_at=NOW() WHERE participant_low_id=$1', [low])).toBeNull();
  });

  it('neither participant of a thread can be deleted (history is not orphaned)', async () => {
    const [a, b] = [await person(), await person()];
    const { low, high } = canonicalParticipantPair(a, b)!;
    await db.query('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$2)', [low, high]);
    // One of them is the low side and the other the high side: both must be protected.
    expect(await fails('DELETE FROM participants WHERE id=$1', [low])).toMatch(/foreign key|violates/i);
    expect(await fails('DELETE FROM participants WHERE id=$1', [high])).toMatch(/foreign key|violates/i);
  });

  it('refuses a participant that does not exist, on either side of the pair', async () => {
    const a = await person();
    const ghostLow = '00000000-0000-4000-8000-000000000000';
    const ghostHigh = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const asHigh = canonicalParticipantPair(a, ghostLow)!; // ghost is the low side
    expect(asHigh.low).toBe(ghostLow);
    expect(await fails('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$2)', [asHigh.low, asHigh.high])).toMatch(/foreign key|violates/i);
    const asLow = canonicalParticipantPair(a, ghostHigh)!; // ghost is the high side
    expect(asLow.high).toBe(ghostHigh);
    expect(await fails('INSERT INTO direct_message_threads (participant_low_id, participant_high_id) VALUES ($1,$2)', [asLow.low, asLow.high])).toMatch(/foreign key|violates/i);
  });

  it('has row level security enabled with no public policies', async () => {
    const r = await rows<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname='direct_message_threads'");
    expect(r[0].relrowsecurity).toBe(true);
    expect((await rows('SELECT 1 FROM pg_policies WHERE tablename=$1', ['direct_message_threads']))).toHaveLength(0);
  });
});
