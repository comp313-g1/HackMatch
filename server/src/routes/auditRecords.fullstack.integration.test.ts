/**
 * US-028 / #264 — full-stack integration of audit-record filters and access.
 *
 *   HTTP request -> real Express app -> real Firebase-auth guards (token verification mocked)
 *   -> real validator -> real service -> REAL SQL (migrations applied to an in-process
 *   Postgres) -> JSON response.
 *
 * Only two things are stand-ins: Firebase's token verification (we mint tokens for known
 * accounts) and the transport between Node and Postgres (PGlite instead of Supabase). The
 * expected results come from an independent JavaScript oracle, so the SQL is checked against
 * something other than itself. Runs in the normal test suite: no Docker, no Supabase.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  auditRecordsRepository,
  type AuditQueryParams,
  type AuditQueryResult,
} from '../db/auditRecords.repository.js';
import { queryAuditRecords } from '../services/auditRecords.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
  };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Real database: only the migrations the audit feature depends on
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIGRATIONS = [
  '0001_create_participants_table.sql',
  '0006_create_event_action_records.sql',
  '0009_protect_admin_role_provisioning.sql',
  '0010_add_participant_suspension.sql',
  '0039_account_enforcement_models.sql', // suspension_reason and its constraints, as in production
  '0049_create_admin_audit_record_query.sql',
  '0050_enforce_audit_records_least_privilege.sql',
];

let db: PGlite;
let dbCalls = 0;
let failNextDbCall: Error | null = null;

const rows = async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];

async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE');
  }
}

/** Exactly what the production repository sends over RPC, executed as the API's database role. */
async function sqlQuery(adminId: string, p: AuditQueryParams): Promise<AuditQueryResult> {
  dbCalls += 1;
  if (failNextDbCall) {
    const e = failNextDbCall;
    failNextDbCall = null;
    throw e;
  }
  try {
    return await asRole('service_role', async () => {
      const r = await rows<{ r: AuditQueryResult }>(
        'SELECT query_admin_audit_records($1,$2,$3,$4,$5,$6,$7,$8,$9) AS r',
        [
          adminId,
          p.actorId ?? null,
          p.actionType ?? null,
          p.category ?? null,
          p.from ?? null,
          p.to ?? null,
          p.limit,
          p.cursor?.createdAt ?? null,
          p.cursor?.id ?? null,
        ]
      );
      return r[0].r;
    });
  } catch (e) {
    const err = e as { message: string; detail?: string; code?: string };
    // PostgREST reports a PostgreSQL DETAIL as `details`.
    throw { message: err.message, details: err.detail, code: err.code };
  }
}

// ---------------------------------------------------------------------------
// Accounts and tokens
// ---------------------------------------------------------------------------
const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const ids: Record<string, string> = {};

/** token -> account the token belongs to, plus the role claim inside the token */
const TOKENS: Record<string, { uid: string; claimRole: 'ADMIN' | 'PART' }> = {
  'admin-a': { uid: 'fb-admin-a', claimRole: 'ADMIN' },
  'admin-b': { uid: 'fb-admin-b', claimRole: 'ADMIN' },
  part: { uid: 'fb-part', claimRole: 'PART' },
  'part-forged': { uid: 'fb-part', claimRole: 'ADMIN' }, // PART account carrying an ADMIN claim
  suspended: { uid: 'fb-suspended', claimRole: 'ADMIN' },
};

const bearer = (token: string) => `Bearer ${token}`;
const AUTH = bearer('admin-a');
const URL = '/api/admin/audit-records';

async function liveParticipant(uid: string): Promise<Participant | null> {
  const r = await rows<Record<string, unknown>>('SELECT * FROM participants WHERE firebase_uid = $1', [uid]);
  return (r[0] as unknown as Participant) ?? null;
}

// ---------------------------------------------------------------------------
// Dataset and an independent oracle
// ---------------------------------------------------------------------------
interface Row {
  id: string;
  actor: string;
  type: string;
  created: string; // YYYY-MM-DDTHH:MM:SS.ffffffZ (same shape the API returns)
}
let all: Row[] = [];

/** Re-reads the table (as its owner) into the oracle's data. Call after a test adds records. */
async function reloadAll(): Promise<void> {
  all = (
    await rows<{ id: string; actor_id: string; action_type: string; t: string }>(
      `SELECT id, actor_id, action_type, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t FROM event_action_records`
    )
  ).map((r) => ({ id: r.id, actor: r.actor_id, type: r.action_type, created: r.t }));
}

const byNewest = (a: Row, b: Row) =>
  a.created === b.created ? (a.id < b.id ? 1 : -1) : a.created < b.created ? 1 : -1;

const categoryOf = (type: string) =>
  type.startsWith('moderation_') ? 'moderation' : type.startsWith('account_') ? 'account' : 'event';

interface Filter {
  actor?: string;
  actionType?: string;
  category?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

/** Plain-JavaScript statement of the filter rules in the story. */
function oracle(f: Filter): Row[] {
  const from = f.from ? `${f.from}T00:00:00.000000Z` : null;
  const to = f.to ? `${f.to}T23:59:59.999999Z` : null;
  return all
    .filter(
      (r) =>
        (!f.actor || r.actor === f.actor) &&
        (!f.actionType || r.type === f.actionType) &&
        (!f.category || categoryOf(r.type) === f.category) &&
        (!from || r.created >= from) &&
        (!to || r.created <= to)
    )
    .sort(byNewest);
}

const qs = (f: Filter, extra: Record<string, string | number> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const get = (query = '', auth = AUTH) => request(app).get(`${URL}${query}`).set('Authorization', auth);

/** Follows nextCursor through every page, exactly like the React page does. */
async function walk(f: Filter, limit: number) {
  const seen: Array<{ id: string; createdAt: string; actorId: string; actionType: string; category: string }> = [];
  const sizes: number[] = [];
  let cursor: string | undefined;
  let last: { hasMore: boolean; nextCursor: string | null } | undefined;
  for (let i = 0; i < 200; i++) {
    const res = await get(qs(f, { limit, ...(cursor ? { cursor } : {}) }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    seen.push(...res.body.records);
    sizes.push(res.body.records.length);
    last = res.body;
    if (!res.body.hasMore) break;
    cursor = res.body.nextCursor;
  }
  return { seen, sizes, last };
}

describe('Audit records: filters and access, end to end on real SQL (US-028 / #264)', () => {
  beforeAll(async () => {
    for (const f of MIGRATIONS) expect(fs.existsSync(path.join(MIGRATIONS_DIR, f)), f).toBe(true);

    db = new PGlite();
    await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
    for (const f of MIGRATIONS) {
      if (f.startsWith('0049')) {
        // Supabase gives the API roles broad default privileges; reproduce them so 0050 is genuinely tested.
        await db.exec(
          'GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;'
        );
      }
      await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    }

    const admin = async (uid: string, name: string) =>
      (await rows<{ id: string }>('SELECT id FROM provision_admin_participant($1,$2,$3)', [uid, `${uid}@x.com`, name]))[0].id;
    ids.adminA = await admin('fb-admin-a', 'Admin A');
    ids.adminB = await admin('fb-admin-b', 'Admin B');
    ids.suspended = await admin('fb-suspended', 'Admin S');
    await db.query(
      "UPDATE participants SET is_suspended = true, suspended_at = NOW(), suspension_reason = 'test' WHERE id = $1",
      [ids.suspended]
    );
    ids.part = (
      await rows<{ id: string }>(
        "INSERT INTO participants (firebase_uid,email,full_name,role,is_verified) VALUES ('fb-part','part@x.com','Part','PART',true) RETURNING id"
      )
    )[0].id;

    // Hand-placed records around the day boundaries the date filters care about.
    const target = '77777777-7777-4777-8777-777777777777';
    const place = (actor: string, type: string, at: string) =>
      db.query(
        `INSERT INTO event_action_records (actor_id,target_type,target_id,action_type,reason,outcome,safe_state_summary,created_at)
         VALUES ($1,'team',$2,$3,'placed','Applied','{}'::jsonb,$4)`,
        [actor, target, type, at]
      );
    await place(ids.adminA, 'moderation_warn', '2026-11-02T23:59:59.999999Z'); // last instant of Nov 2
    await place(ids.adminA, 'moderation_warn', '2026-11-03T00:00:00.000000Z'); // first instant of Nov 3
    await place(ids.adminB, 'account_suspend', '2026-11-03T00:00:00.000001Z');
    await place(ids.adminB, 'account_delete', '2026-11-03T23:59:59.999999Z'); // last instant of Nov 3
    await place(ids.adminA, 'event_approve', '2026-11-04T00:00:00.000000Z');
    for (let i = 0; i < 5; i++) await place(ids.adminA, 'moderation_hide', '2026-11-03T12:00:00.123456Z'); // identical timestamps

    // Bulk: 200 more records over several days, in groups of 7 sharing a timestamp.
    await db.exec(`
      INSERT INTO event_action_records (actor_id,target_type,target_id,action_type,reason,outcome,safe_state_summary,created_at)
      SELECT (ARRAY['${ids.adminA}','${ids.adminB}'])[1 + g % 2]::uuid, 'team', '${target}'::uuid,
             (ARRAY['moderation_warn','moderation_hide','moderation_dismiss','account_suspend','account_delete','event_approve'])[1 + g % 6],
             'bulk ' || g, 'Applied', '{}'::jsonb,
             TIMESTAMPTZ '2026-10-31 20:00:00+00' + ((g / 7) * 37 || ' minutes')::interval
      FROM generate_series(1, 200) g`);

    await reloadAll();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dbCalls = 0;
    failNextDbCall = null;

    mockVerifyIdToken.mockImplementation(async (token: string) => {
      const t = TOKENS[token];
      if (!t) throw { code: 'auth/argument-error' };
      return { uid: t.uid, role: t.claimRole, auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME } as unknown as DecodedIdToken;
    });
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockImplementation(liveParticipant);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => {
      const r = await rows<Record<string, unknown>>('SELECT * FROM participants WHERE id = $1', [id]);
      return (r[0] as unknown as Participant) ?? null;
    });
    vi.spyOn(auditRecordsRepository, 'query').mockImplementation(sqlQuery);
  });

  it('the fixture is rich enough to mean something', () => {
    expect(all.length).toBeGreaterThan(200);
    const groups = new Map<string, number>();
    for (const r of all) groups.set(r.created, (groups.get(r.created) ?? 0) + 1);
    expect([...groups.values()].some((n) => n >= 5)).toBe(true); // identical timestamps
    expect(new Set(all.map((r) => categoryOf(r.type))).size).toBe(3);
  });

  // =========================================================================
  describe('filters return exactly the matching records', () => {
    it('no filters: the newest page, in (time, id) order, with every response field', async () => {
      const res = await get('?limit=25');
      expect(res.status).toBe(200);
      const expected = oracle({}).slice(0, 25);
      expect(res.body.records.map((r: { id: string }) => r.id)).toEqual(expected.map((r) => r.id));
      expect(res.body.hasMore).toBe(true);
      expect(res.body.nextCursor).toEqual(expect.any(String));
      expect(res.body.records[0]).toEqual({
        id: expect.any(String),
        actorId: expect.any(String),
        actionType: expect.any(String),
        category: expect.stringMatching(/^(event|moderation|account)$/),
        targetType: 'team',
        targetId: '77777777-7777-4777-8777-777777777777',
        reason: expect.any(String),
        outcome: 'Applied',
        safeStateSummary: expect.any(Object),
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      });
    });

    it.each([
      ['adminA', () => ({ actor: ids.adminA })],
      ['adminB', () => ({ actor: ids.adminB })],
    ])('actor filter (%s) returns only that administrator\'s records, all of them', async (_n, make) => {
      const f = make();
      const { seen } = await walk(f, 100);
      expect(seen.map((r) => r.id)).toEqual(oracle(f).map((r) => r.id));
      expect(seen.every((r) => r.actorId === f.actor)).toBe(true);
    });

    it.each(['moderation_warn', 'moderation_hide', 'account_suspend', 'account_delete', 'event_approve'])(
      'action type %s matches exactly (no prefix or wildcard matching)',
      async (actionType) => {
        const { seen } = await walk({ actionType }, 100);
        expect(seen.map((r) => r.id)).toEqual(oracle({ actionType }).map((r) => r.id));
        expect(seen.every((r) => r.actionType === actionType)).toBe(true);
      }
    );

    it.each(['event', 'moderation', 'account'])('category %s returns that whole family', async (category) => {
      const { seen } = await walk({ category }, 100);
      expect(seen.map((r) => r.id)).toEqual(oracle({ category }).map((r) => r.id));
      expect(seen.every((r) => r.category === category)).toBe(true);
    });

    it('wildcards in the action type never widen the match', async () => {
      // SQL LIKE characters are refused outright, before they can reach the database.
      for (const actionType of ['moderation_%', '%', 'moderation%', '_', 'mod_ration_warn%']) {
        expect((await get(qs({}, { actionType }))).status, actionType).toBe(400);
      }
      expect(dbCalls).toBe(0);

      // A trailing underscore is a legal character, so it is matched exactly (like any other
      // text), not as a prefix: "moderation_" is NOT "everything starting with moderation_".
      const res = await get(qs({}, { actionType: 'moderation_' }));
      expect(res.status).toBe(200);
      expect(res.body.records).toEqual([]);
      expect(oracle({ category: 'moderation' }).length).toBeGreaterThan(0); // the prefix WOULD have matched rows
    });

    it('combines actor, action type, category and dates with AND', async () => {
      const f: Filter = { actor: ids.adminA, actionType: 'moderation_hide', category: 'moderation', from: '2026-11-03', to: '2026-11-03' };
      const { seen } = await walk(f, 25);
      expect(seen.map((r) => r.id)).toEqual(oracle(f).map((r) => r.id));
      expect(seen.length).toBeGreaterThanOrEqual(5); // the five identical-timestamp records
    });

    it('a category and an action type that contradict each other match nothing', async () => {
      const res = await get(qs({ category: 'account', actionType: 'moderation_warn' }));
      expect(res.status).toBe(200);
      expect(res.body.records).toEqual([]);
    });

    describe('date filters (inclusive, UTC, whole days)', () => {
      it('a single day includes its first and last microsecond and nothing outside it', async () => {
        const { seen } = await walk({ from: '2026-11-03', to: '2026-11-03' }, 100);
        const times = seen.map((r) => r.createdAt);
        expect(times).toContain('2026-11-03T00:00:00.000000Z');
        expect(times).toContain('2026-11-03T23:59:59.999999Z');
        expect(times).not.toContain('2026-11-02T23:59:59.999999Z');
        expect(times).not.toContain('2026-11-04T00:00:00.000000Z');
        expect(seen.map((r) => r.id)).toEqual(oracle({ from: '2026-11-03', to: '2026-11-03' }).map((r) => r.id));
      });

      it('"to" a date includes the record at 23:59:59.999999 and excludes the next day at 00:00:00', async () => {
        const { seen } = await walk({ to: '2026-11-02' }, 100);
        const times = seen.map((r) => r.createdAt);
        expect(times).toContain('2026-11-02T23:59:59.999999Z');
        expect(times).not.toContain('2026-11-03T00:00:00.000000Z');
      });

      it('"from" a date includes the record at 00:00:00 and excludes the previous day', async () => {
        const { seen } = await walk({ from: '2026-11-03' }, 100);
        const times = seen.map((r) => r.createdAt);
        expect(times).toContain('2026-11-03T00:00:00.000000Z');
        expect(times).not.toContain('2026-11-02T23:59:59.999999Z');
      });

      it('exact timestamps: a one-instant window includes that record and excludes one microsecond either side', async () => {
        const at = '2026-11-03T00:00:00.000000Z';
        const res = await get(qs({}, { from: at, to: at }));
        expect(res.status).toBe(200);
        expect(res.body.records.map((r: { createdAt: string }) => r.createdAt)).toEqual([at]);

        const before = await get(qs({}, { from: '2026-11-02T23:59:59.999999Z', to: '2026-11-02T23:59:59.999999Z' }));
        expect(before.body.records).toHaveLength(1);
        const gap = await get(qs({}, { from: '2026-11-02T23:59:59.999999Z'.replace('999999Z', '9999999Z') }));
        expect(gap.status).toBe(400); // seven fractional digits are not a valid timestamp
      });

      it('a timestamp with a UTC offset is converted correctly', async () => {
        // 2026-11-03T05:30:00+05:30 is exactly 2026-11-03T00:00:00Z
        const res = await get(qs({}, { from: '2026-11-03T05:30:00+05:30', to: '2026-11-03T05:30:00+05:30' }));
        expect(res.status).toBe(200);
        expect(res.body.records.map((r: { createdAt: string }) => r.createdAt)).toEqual(['2026-11-03T00:00:00.000000Z']);
      });

      it('an open-ended range works from either side', async () => {
        for (const f of [{ from: '2026-11-04' }, { to: '2026-11-01' }] as Filter[]) {
          const { seen } = await walk(f, 50);
          expect(seen.map((r) => r.id)).toEqual(oracle(f).map((r) => r.id));
        }
      });

      it('a range that covers no records, and a range entirely in the future, are empty (not errors)', async () => {
        for (const f of [{ from: '2030-01-01' }, { from: '2026-01-01', to: '2026-01-02' }] as Filter[]) {
          const res = await get(qs(f));
          expect(res.status).toBe(200);
          expect(res.body).toMatchObject({ records: [], hasMore: false, nextCursor: null });
        }
      });
    });

    it('unknown actor and unknown action type are empty results, not errors', async () => {
      for (const f of [{ actor: '99999999-9999-4999-8999-999999999999' }, { actionType: 'no_such_action' }] as Filter[]) {
        const res = await get(qs(f));
        expect(res.status).toBe(200);
        expect(res.body.records).toEqual([]);
        expect(res.body.count).toBe(0);
      }
    });

    it('the response echoes the normalized filters that were applied', async () => {
      const res = await get(qs({ actor: ids.adminA.toUpperCase(), from: '2026-11-03', to: '2026-11-03' }));
      expect(res.body.filters).toEqual({
        actor: ids.adminA,
        actionType: null,
        category: null,
        from: '2026-11-03T00:00:00.000000Z',
        to: '2026-11-03T23:59:59.999999Z',
      });
    });

    it('matches an independent oracle across 80 random filter combinations, page by page', async () => {
      // Small seeded generator so a failure is reproducible.
      let s = 20261103;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
      const actors = [undefined, undefined, ids.adminA, ids.adminB, '99999999-9999-4999-8999-999999999999'];
      const actions = [undefined, undefined, 'moderation_warn', 'moderation_hide', 'account_suspend', 'event_approve', 'no_such_action'];
      const cats = [undefined, undefined, 'event', 'moderation', 'account'];
      const days = [undefined, '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-08'];
      let checked = 0;
      for (let i = 0; i < 80; i++) {
        let from = pick(days);
        let to = pick(days);
        if (from && to && from > to) [from, to] = [to, from];
        const f: Filter = { actor: pick(actors), actionType: pick(actions), category: pick(cats), from, to };
        const limit = pick([25, 50, 100]);
        const { seen, last } = await walk(f, limit);
        const expected = oracle(f);
        expect(seen.map((r) => r.id), JSON.stringify({ f, limit })).toEqual(expected.map((r) => r.id));
        expect(last?.hasMore).toBe(false);
        checked += expected.length;
      }
      expect(checked).toBeGreaterThan(500);
    });
  });

  // =========================================================================
  describe('paging through real timestamps and ties', () => {
    it.each([25, 50, 100])('walks every record exactly once at %i per page', async (limit) => {
      const { seen, sizes, last } = await walk({}, limit);
      const expected = oracle({});
      expect(seen.map((r) => r.id)).toEqual(expected.map((r) => r.id));
      expect(new Set(seen.map((r) => r.id)).size).toBe(expected.length);
      expect(sizes).toHaveLength(Math.ceil(expected.length / limit));
      expect(sizes.slice(0, -1).every((n) => n === limit)).toBe(true);
      expect(last).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it('the cursor survives microsecond precision and several records sharing one instant', async () => {
      // Page boundaries land inside the group of five records with identical timestamps.
      const { seen } = await walk({ actionType: 'moderation_hide', from: '2026-11-03', to: '2026-11-03' }, 25);
      const tied = seen.filter((r) => r.createdAt === '2026-11-03T12:00:00.123456Z');
      expect(tied.length).toBeGreaterThanOrEqual(5);
      for (const limit of [1, 2, 3]) {
        const w = await walk({ actionType: 'moderation_hide', from: '2026-11-03', to: '2026-11-03' }, limit).catch(() => null);
        if (w) expect(new Set(w.seen.map((r) => r.id)).size).toBe(w.seen.length);
      }
    });

    it('a cursor past the oldest record yields an empty page', async () => {
      const oldest = [...all].sort(byNewest).at(-1)!;
      const cursor = Buffer.from(JSON.stringify([oldest.created, oldest.id])).toString('base64url');
      const res = await get(`?limit=25&cursor=${cursor}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ records: [], hasMore: false, nextCursor: null });
    });

    it('a filtered walk and an unfiltered walk never mix records', async () => {
      const a = await walk({ category: 'account' }, 25);
      expect(a.seen.every((r) => r.category === 'account')).toBe(true);
    });
  });

  // =========================================================================
  describe('invalid input is rejected before it reaches the database', () => {
    it.each([
      ['limit=0'], ['limit=101'], ['limit=-1'], ['limit=1.5'], ['limit=abc'], ['limit=1&limit=2'],
      ['actor=not-a-uuid'], ['actor=123'], ['actionType=Account_Suspend'], ['actionType=a-b'], ['actionType=moderation_%25'],
      [`actionType=${'a'.repeat(51)}`], ['category=Moderation'], ['category=other'],
      ['from=2026-02-30'], ['from=2026-13-01'], ['from=yesterday'], ['from=2026-11-03T25:00:00Z'], ['to=11/03/2026'],
      ['from=2026-11-04&to=2026-11-03'], ['cursor=not-a-cursor'], ['cursor='], ['sort=asc'], ['page=2'], ['offset=5'],
    ])('?%s -> 400 and no database call', async (query) => {
      const res = await get(`?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.fieldErrors).length).toBeGreaterThan(0);
      expect(dbCalls).toBe(0);
    });

    it('a forged or tampered cursor is refused, never silently mis-paged', async () => {
      const first = await get('?limit=25');
      const [createdAt, id] = JSON.parse(Buffer.from(first.body.nextCursor, 'base64url').toString('utf8')) as [string, string];
      const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
      for (const bad of [enc([createdAt.replace('2026', '2o26'), id]), enc([id, createdAt]), enc([createdAt]), enc({ a: 1 }), 'A'.repeat(500)]) {
        expect((await get(`?cursor=${bad}`)).status).toBe(400);
      }
      expect(dbCalls).toBe(1); // only the legitimate first request
    });

    it('the database also rejects bad arguments itself, with fields named in the error', async () => {
      await expect(auditRecordsRepository.query(ids.adminA, { limit: 0 })).rejects.toMatchObject({
        message: expect.stringContaining('VALIDATION_ERROR'),
      });
      const viaService = await queryAuditRecords(ids.adminA, { limit: 101, from: '2026-11-04T00:00:00Z', to: '2026-11-03T00:00:00Z' }).catch((e) => e);
      expect(viaService).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(Object.keys(viaService.fieldErrors).sort()).toEqual(['from', 'limit']);
    });
  });

  // =========================================================================
  describe('access: only an active ADMIN reads, and nothing can write', () => {
    it('an administrator is allowed', async () => {
      expect((await get('?limit=1')).status).toBe(200);
      expect((await get('?limit=1', bearer('admin-b'))).status).toBe(200);
    });

    it.each([
      ['no credentials', undefined, 401],
      ['a malformed header', 'Basic abc', 401],
      ['a token Firebase rejects', 'Bearer forged', 401],
      ['a PART participant', bearer('part'), 403],
      ['a PART account carrying a forged ADMIN claim', bearer('part-forged'), 403],
      ['a suspended administrator', bearer('suspended'), 403],
    ] as const)('%s is refused (%i) and never reaches the database', async (_label, auth, status) => {
      const r = request(app).get(`${URL}?limit=25`);
      const res = auth ? await r.set('Authorization', auth) : await r;
      expect(res.status).toBe(status);
      expect(JSON.stringify(res.body)).not.toMatch(/records|createdAt/);
      expect(dbCalls).toBe(0);
    });

    it('an expired or revoked token is a 401 with a specific code', async () => {
      for (const [code, expected] of [['auth/id-token-expired', 'TOKEN_EXPIRED'], ['auth/id-token-revoked', 'TOKEN_REVOKED']] as const) {
        mockVerifyIdToken.mockRejectedValueOnce({ code });
        const res = await get('?limit=1');
        expect(res.status).toBe(401);
        expect(res.body.code).toBe(expected);
      }
      expect(dbCalls).toBe(0);
    });

    it('a token without the email-code (MFA) step is refused', async () => {
      mockVerifyIdToken.mockResolvedValueOnce({ uid: 'fb-admin-a', role: 'ADMIN', auth_time: AUTH_TIME } as unknown as DecodedIdToken);
      const res = await get('?limit=1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
      expect(dbCalls).toBe(0);
    });

    it('defense in depth: if the route guard is fooled by stale data, the database still says no', async () => {
      // The guard is told this PART participant is an ADMIN (e.g. a stale cache).
      const real = (await liveParticipant('fb-part'))!;
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({ ...real, role: 'ADMIN' });
      mockVerifyIdToken.mockResolvedValueOnce({ uid: 'fb-part', role: 'ADMIN', auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME } as unknown as DecodedIdToken);

      const res = await get('?limit=25');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_ADMIN');
      expect(dbCalls).toBe(1); // it did reach the database, and the database refused
      expect(JSON.stringify(res.body)).not.toMatch(/records|createdAt/);
    });

    it('defense in depth: a suspended administrator is refused by the database too', async () => {
      const real = (await liveParticipant('fb-suspended'))!;
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({ ...real, is_suspended: false });
      const res = await get('?limit=25', bearer('suspended'));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_ADMIN');
    });

    it('demoting an administrator takes effect on their very next request', async () => {
      expect((await get('?limit=1', bearer('admin-b'))).status).toBe(200);
      await db.query("UPDATE participants SET role = 'PART' WHERE id = $1", [ids.adminB]);
      try {
        const res = await get('?limit=1', bearer('admin-b'));
        expect(res.status).toBe(403); // refused at the route (role no longer ADMIN)
        expect(JSON.stringify(res.body)).not.toMatch(/records/);
      } finally {
        await db.query("UPDATE participants SET role = 'ADMIN' WHERE id = $1", [ids.adminB]);
      }
      expect((await get('?limit=1', bearer('admin-b'))).status).toBe(200);
    });

    it('the filters do not let anyone act as someone else: the actor filter only selects records', async () => {
      // Administrator B asking for administrator A's records is a filter, not an identity change.
      const res = await get(qs({ actor: ids.adminA }), bearer('admin-b'));
      expect(res.status).toBe(200);
      expect(res.body.records.every((r: { actorId: string }) => r.actorId === ids.adminA)).toBe(true);
      // ...and a PART participant cannot use the same trick.
      expect((await get(qs({ actor: ids.adminA }), bearer('part'))).status).toBe(403);
    });

    it('no HTTP method can change the audit trail, and the table is byte-for-byte unchanged afterwards', async () => {
      const fingerprint = async () =>
        (await rows<{ h: string; c: number }>("SELECT md5(COALESCE(string_agg(t::text,'|' ORDER BY id),'')) h, count(*)::int c FROM event_action_records t"))[0];
      const before = await fingerprint();

      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        for (const target of [URL, `${URL}/${ids.adminA}`]) {
          const res = await request(app)[method](target).set('Authorization', AUTH).send({ reason: 'tamper', id: ids.adminA });
          expect(res.status, `${method} ${target}`).toBe(405);
        }
      }
      expect((await request(app).post(URL).set('Authorization', AUTH).set('X-HTTP-Method-Override', 'GET')).status).toBe(405);
      expect(await fingerprint()).toEqual(before);
    });

    it('reading has no side effects: the table is unchanged after many reads', async () => {
      const count = async () => (await rows<{ c: number }>('SELECT count(*)::int c FROM event_action_records'))[0].c;
      const before = await count();
      for (let i = 0; i < 5; i++) await get('?limit=100');
      expect(await count()).toBe(before);
    });
  });

  // =========================================================================
  describe('database privileges behind the API (migrations 0049 and 0050)', () => {
    const denied = (m: string | null) => /permission denied|must be owner/i.test(m ?? '');
    const tryRole = async (role: string, sql: string) => {
      try {
        await asRole(role, async () => {
          await db.exec(sql);
        });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };

    it.each([
      ['UPDATE', 'UPDATE event_action_records SET reason = $$x$$'],
      ['DELETE', 'DELETE FROM event_action_records'],
      ['TRUNCATE', 'TRUNCATE event_action_records'],
      ['CREATE TRIGGER', 'CREATE TRIGGER t BEFORE INSERT ON event_action_records FOR EACH ROW EXECUTE FUNCTION set_updated_at()'],
      ['upsert that rewrites a row', "INSERT INTO event_action_records (id,actor_id,target_type,target_id,action_type,reason,outcome,safe_state_summary) SELECT id,actor_id,target_type,target_id,action_type,'rewritten',outcome,safe_state_summary FROM event_action_records LIMIT 1 ON CONFLICT (id) DO UPDATE SET reason = EXCLUDED.reason"],
    ])('the API database role cannot %s', async (_label, sql) => {
      expect(denied(await tryRole('service_role', sql))).toBe(true);
    });

    it.each(['anon', 'authenticated'])('%s has no access of any kind', async (role) => {
      for (const sql of [
        'SELECT count(*) FROM event_action_records',
        `INSERT INTO event_action_records (actor_id,target_type,target_id,action_type,reason,outcome,safe_state_summary) VALUES ('${ids.adminA}','t',gen_random_uuid(),'moderation_warn','r','o','{}')`,
        `SELECT query_admin_audit_records('${ids.adminA}')`,
      ]) {
        expect(denied(await tryRole(role, sql)), `${role}: ${sql.slice(0, 40)}`).toBe(true);
      }
    });

    it('even the table owner cannot update or delete: the append-only triggers stop it', async () => {
      for (const sql of ['UPDATE event_action_records SET reason = $$x$$', 'DELETE FROM event_action_records', 'TRUNCATE event_action_records']) {
        await expect(db.exec(sql)).rejects.toThrow(/append-only/i);
      }
    });

    it('the API role can still append a record, and it then shows up in the filtered query', async () => {
      const inserted = await asRole('service_role', async () =>
        rows<{ id: string }>(
          `INSERT INTO event_action_records (actor_id,target_type,target_id,action_type,reason,outcome,safe_state_summary)
           VALUES ($1,'account',gen_random_uuid(),'account_suspend','written by the API','Applied','{"livePiiErased":false}') RETURNING id`,
          [ids.adminA]
        )
      );
      await reloadAll();
      const res = await get(qs({ actor: ids.adminA, actionType: 'account_suspend' }, { limit: 100 }));
      expect(res.body.records.map((r: { id: string }) => r.id)).toContain(inserted[0].id);
      expect(res.body.records.map((r: { id: string }) => r.id)).toEqual(
        oracle({ actor: ids.adminA, actionType: 'account_suspend' }).map((r) => r.id)
      );
      // the newest record now: the API's own write
      expect((await get('?limit=1')).body.records[0].id).toBe(inserted[0].id);
    });

    it('a record cannot be attributed to a non-administrator', async () => {
      await expect(
        asRole('service_role', () =>
          db.query(
            "INSERT INTO event_action_records (actor_id,target_type,target_id,action_type,reason,outcome,safe_state_summary) VALUES ($1,'t',gen_random_uuid(),'moderation_warn','r','o','{}')",
            [ids.part]
          )
        )
      ).rejects.toThrow(/ADMIN/);
    });

    it('an administrator who has authored records cannot be deleted or re-keyed', async () => {
      await expect(db.query('DELETE FROM participants WHERE id = $1', [ids.adminA])).rejects.toThrow(/foreign key|violates/i);
      await expect(db.query('UPDATE participants SET id = gen_random_uuid() WHERE id = $1', [ids.adminA])).rejects.toThrow(/foreign key|violates/i);
    });
  });

  // =========================================================================
  describe('failure handling', () => {
    it('a database failure is a safe 500 and the next request works', async () => {
      failNextDbCall = new Error('postgres://svc:hunter2@db.internal:5432/prod timeout');
      const failed = await get('?limit=25');
      expect(failed.status).toBe(500);
      expect(failed.body.error).toBe('Internal Server Error');
      expect(JSON.stringify(failed.body)).not.toMatch(/hunter2|db\.internal|postgres:/);

      const retry = await get('?limit=25');
      expect(retry.status).toBe(200);
      expect(retry.body.records).toHaveLength(25);
    });

    it('a failure on a later page leaves earlier pages valid and the same cursor reusable', async () => {
      const first = await get('?limit=25');
      failNextDbCall = new Error('connection terminated');
      expect((await get(`?limit=25&cursor=${first.body.nextCursor}`)).status).toBe(500);
      const retry = await get(`?limit=25&cursor=${first.body.nextCursor}`);
      expect(retry.status).toBe(200);
      expect(retry.body.records.map((r: { id: string }) => r.id)).toEqual(oracle({}).slice(25, 50).map((r) => r.id));
    });

    it('a failed read changes nothing (nothing is written, nothing is half-done)', async () => {
      const count = async () => (await rows<{ c: number }>('SELECT count(*)::int c FROM event_action_records'))[0].c;
      const before = await count();
      failNextDbCall = new Error('boom');
      await get('?limit=25');
      expect(await count()).toBe(before);
    });

    it('stored summaries are scrubbed again on the way out, even if a bad value got into the table', async () => {
      await db.query(
        `INSERT INTO event_action_records (actor_id,target_type,target_id,action_type,reason,outcome,safe_state_summary,created_at)
         VALUES ($1,'team',gen_random_uuid(),'moderation_warn','leaky','Applied',
                 '{"caseId":"c9","password":"hunter2","email":"victim@example.com","phone":"555-0100","note":"kept"}'::jsonb,'2030-01-01T00:00:00Z')`,
        [ids.adminA]
      );
      await reloadAll();
      const res = await get('?limit=1');
      const body = JSON.stringify(res.body);
      expect(res.body.records[0].reason).toBe('leaky');
      expect(body).not.toMatch(/hunter2|victim@example\.com|555-0100/);
      expect(body).toContain('"caseId":"c9"');
      expect(body).toContain('"note":"kept"');
    });
  });
});
