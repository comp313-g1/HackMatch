/**
 * US-028 / #261 — pagination of audit records through the real Express route, validator,
 * service and cursor encoding, over hundreds of records with heavy timestamp ties.
 *
 * Only the database call is replaced by an in-memory stand-in that follows the same keyset rule
 * as query_admin_audit_records() ((created_at, id) descending, one look-ahead row). The SQL itself
 * was verified on a real Postgres engine (2,503 records, ties, appends mid-walk) and by
 * migration.test.ts / auditRecords.db.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  auditRecordsRepository,
  type AuditQueryParams,
  type AuditQueryResult,
  type AuditRecordRow,
  type IAuditRecordsRepository,
} from '../db/auditRecords.repository.js';
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

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const AUTH = 'Bearer valid-mfa-token';
const URL = '/api/admin/audit-records';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const admin: Participant = {
  id: ADMIN_ID,
  firebase_uid: 'fb-admin-1',
  email: 'admin@example.com',
  full_name: 'Platform Admin',
  role: 'ADMIN',
  is_verified: true,
  is_suspended: false,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

const TOTAL = 253;

/** 253 records; every 10 consecutive records share a timestamp (heavy ties). */
function buildRecords(): AuditRecordRow[] {
  const types = ['moderation_warn', 'moderation_hide', 'account_suspend', 'event_approve'];
  const categories = ['moderation', 'moderation', 'account', 'event'] as const;
  return Array.from({ length: TOTAL }, (_, i) => {
    const g = i + 1;
    const seconds = String(Math.floor(g / 10)).padStart(2, '0').slice(-2);
    return {
      id: `00000000-0000-4000-8000-${String(g).padStart(12, '0')}`,
      actorId: ADMIN_ID,
      targetType: 'team',
      targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      actionType: types[g % 4],
      category: categories[g % 4],
      reason: `bulk ${g}`,
      outcome: 'Applied',
      safeStateSummary: {},
      createdAt: `2026-10-01T00:${String(Math.floor(g / 600)).padStart(2, '0')}:${seconds}.000000Z`,
    };
  });
}

/** Same ordering and cursor rule as the SQL function. */
function fakeQuery(all: AuditRecordRow[]): IAuditRecordsRepository['query'] {
  const newest = (a: AuditRecordRow, b: AuditRecordRow) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1;

  return async (_adminId: string, p: AuditQueryParams): Promise<AuditQueryResult> => {
    let rows = all.filter(
      (r) =>
        (!p.actorId || r.actorId === p.actorId) &&
        (!p.actionType || r.actionType === p.actionType) &&
        (!p.category || r.category === p.category) &&
        (!p.from || r.createdAt >= p.from) &&
        (!p.to || r.createdAt <= p.to)
    );
    rows = [...rows].sort(newest);
    if (p.cursor) {
      const { createdAt, id } = p.cursor;
      rows = rows.filter((r) => r.createdAt < createdAt || (r.createdAt === createdAt && r.id < id));
    }
    const page = rows.slice(0, p.limit + 1);
    const hasMore = page.length > p.limit;
    const visible = page.slice(0, p.limit);
    const last = visible[visible.length - 1];
    return {
      records: visible,
      hasMore,
      nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  };
}

describe('Audit records: paging through many results (US-028 / #261)', () => {
  let query: MockInstance<IAuditRecordsRepository['query']>;
  let all: AuditRecordRow[];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockVerifyIdToken.mockResolvedValue({
      uid: 'fb-admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      auth_time: AUTH_TIME,
      [MFA_CLAIM]: AUTH_TIME,
    } as unknown as DecodedIdToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(admin);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(admin);
    all = buildRecords();
    query = vi.spyOn(auditRecordsRepository, 'query').mockImplementation(fakeQuery(all));
  });

  const get = (qs = '') => request(app).get(`${URL}${qs}`).set('Authorization', AUTH);

  /** Follows nextCursor exactly as the React page does. */
  async function walk(limit: number, extra = '') {
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    let lastBody: { hasMore: boolean; nextCursor: string | null } | null = null;
    for (let i = 0; i < 100; i++) {
      const res = await get(`?limit=${limit}${extra}${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      ids.push(...res.body.records.map((r: { id: string }) => r.id));
      sizes.push(res.body.records.length);
      lastBody = res.body;
      if (!res.body.hasMore) break;
      cursor = res.body.nextCursor;
    }
    return { ids, sizes, lastBody };
  }

  it.each([25, 50, 100])('walks all %i-record pages: every record exactly once, newest first', async (limit) => {
    const { ids, sizes, lastBody } = await walk(limit);

    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
    const expectedPages = Math.ceil(TOTAL / limit);
    expect(sizes).toHaveLength(expectedPages);
    expect(sizes.slice(0, -1).every((n) => n === limit)).toBe(true);
    expect(sizes.at(-1)).toBe(TOTAL - limit * (expectedPages - 1));
    expect(lastBody).toMatchObject({ hasMore: false, nextCursor: null });

    const byId = new Map(all.map((r) => [r.id, r]));
    const ordered = ids.every((id, i) => {
      if (i === 0) return true;
      const prev = byId.get(ids[i - 1])!;
      const cur = byId.get(id)!;
      return cur.createdAt < prev.createdAt || (cur.createdAt === prev.createdAt && cur.id < prev.id);
    });
    expect(ordered).toBe(true);
  });

  it('every page size walks the identical sequence', async () => {
    const [a, b, c] = [await walk(25), await walk(50), await walk(100)];
    expect(b.ids).toEqual(a.ids);
    expect(c.ids).toEqual(a.ids);
  });

  it('the data really contains tied timestamps (so the id tie-break is exercised)', () => {
    const counts = new Map<string, number>();
    for (const r of all) counts.set(r.createdAt, (counts.get(r.createdAt) ?? 0) + 1);
    expect([...counts.values()].some((n) => n > 5)).toBe(true);
  });

  it('pages correctly with filters applied (category, action type, date range)', async () => {
    const moderation = all.filter((r) => r.category === 'moderation').length;
    const m = await walk(25, '&category=moderation');
    expect(m.ids).toHaveLength(moderation);
    expect(new Set(m.ids).size).toBe(moderation);

    const suspend = all.filter((r) => r.actionType === 'account_suspend').length;
    expect((await walk(50, '&actionType=account_suspend')).ids).toHaveLength(suspend);

    const from = '2026-10-01T00:00:05.000000Z';
    const to = '2026-10-01T00:00:15.000000Z';
    const inRange = all.filter((r) => r.createdAt >= from && r.createdAt <= to).length;
    expect(inRange).toBeGreaterThan(30);
    expect((await walk(25, `&from=${from}&to=${to}`)).ids).toHaveLength(inRange);
  });

  it('hasMore is false exactly when the last record has been returned (page-size boundaries)', async () => {
    for (const n of [25, 50, 100, 1, 26]) {
      const to = [...all].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[n - 1].createdAt;
      const total = all.filter((r) => r.createdAt <= to).length;
      const { ids, lastBody } = await walk(25, `&to=${to}`);
      expect(ids).toHaveLength(total);
      expect(lastBody?.hasMore).toBe(false);
    }
  });

  it('an empty result is a normal 200 with no cursor (no results)', async () => {
    const res = await get('?actionType=no_such_action');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ records: [], count: 0, hasMore: false, nextCursor: null });
  });

  it('a cursor past the oldest record yields an empty page, not an error or a wrap-around', async () => {
    const oldest = [...all].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
    const { encodeAuditCursor } = await import('../services/auditRecords.js');
    const cursor = encodeAuditCursor({ createdAt: oldest.createdAt, id: oldest.id });
    const res = await get(`?cursor=${cursor}`);
    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it('every request uses the session admin and never writes (only the read function is called)', async () => {
    await walk(100);
    for (const call of query.mock.calls) expect(call[0]).toBe(ADMIN_ID);
    expect(query.mock.calls.length).toBe(Math.ceil(TOTAL / 100));
  });

  describe('invalid paging input is rejected before the database', () => {
    it.each([
      ['limit=0'],
      ['limit=101'],
      ['limit=-5'],
      ['limit=25.5'],
      ['limit=abc'],
      ['limit=1&limit=2'],
      ['cursor=not-a-cursor'],
      ['cursor='],
      ['page=2'],
      ['offset=25'],
      ['pageSize=50'],
    ])('?%s -> 400', async (qs) => {
      const res = await get(`?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(query).not.toHaveBeenCalled();
    });

    it('a tampered or foreign cursor is refused, never silently mis-paged', async () => {
      const first = await get('?limit=25');
      const cursor: string = first.body.nextCursor;
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
      const tampered = Buffer.from(JSON.stringify([decoded[0].replace('2026', '2o26'), decoded[1]])).toString('base64url');
      expect((await get(`?cursor=${tampered}`)).status).toBe(400);
      const swapped = Buffer.from(JSON.stringify([decoded[1], decoded[0]])).toString('base64url');
      expect((await get(`?cursor=${swapped}`)).status).toBe(400);
    });

    it('accepts the three limits the UI offers and rejects just outside them', async () => {
      for (const limit of [25, 50, 100]) expect((await get(`?limit=${limit}`)).status).toBe(200);
      expect((await get('?limit=101')).status).toBe(400);
      expect((await get('?limit=0')).status).toBe(400);
    });
  });

  describe('unauthorized access', () => {
    it('denies a non-admin on every page request without reading records', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-admin-1',
        role: 'PART',
        auth_time: AUTH_TIME,
        [MFA_CLAIM]: AUTH_TIME,
      } as unknown as DecodedIdToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({ ...admin, role: 'PART' });
      for (const qs of ['', '?limit=100', '?cursor=abc']) {
        expect((await get(qs)).status).toBe(403);
      }
      expect(query).not.toHaveBeenCalled();
    });

    it('denies visitors with 401', async () => {
      expect((await request(app).get(`${URL}?limit=25`)).status).toBe(401);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('failure handling', () => {
    it('a database failure on a later page is a safe 500 and does not affect the next request', async () => {
      const first = await get('?limit=25');
      query.mockRejectedValueOnce(new Error('postgres://svc:hunter2@db.internal/prod'));
      const failed = await get(`?limit=25&cursor=${first.body.nextCursor}`);
      expect(failed.status).toBe(500);
      expect(JSON.stringify(failed.body)).not.toMatch(/hunter2|db\.internal/);

      const retry = await get(`?limit=25&cursor=${first.body.nextCursor}`);
      expect(retry.status).toBe(200);
      expect(retry.body.records).toHaveLength(25);
    });

    it('a database-reported invalid cursor becomes an explicit 400 with a cursor field error', async () => {
      query.mockRejectedValueOnce({
        message: 'VALIDATION_ERROR',
        details: JSON.stringify({ cursor: 'cursor is incomplete.' }),
      });
      const res = await get('?limit=25');
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toEqual({ cursor: 'cursor is incomplete.' });
    });
  });
});
