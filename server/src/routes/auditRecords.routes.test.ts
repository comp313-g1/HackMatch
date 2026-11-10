/**
 * US-028 / #258 — append-only audit-record query endpoint (GET /api/admin/audit-records).
 *
 * Evidence matrix: permissions (every method, every denied caller), happy path,
 * filters, empty state, invalid input, boundaries, append-only (no write API),
 * privacy scrubbing, and failure handling. The SQL itself is covered by
 * migration.test.ts and auditRecords.db.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  auditRecordsRepository,
  type AuditQueryResult,
  type AuditRecordRow,
  type IAuditRecordsRepository,
} from '../db/auditRecords.repository.js';
import { encodeAuditCursor } from '../services/auditRecords.js';
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
const ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECORD_ID = '11111111-1111-4111-8111-111111111111';
const CREATED = '2026-11-03T10:00:00.123456Z';

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

const decoded = (extra: Record<string, unknown> = {}) =>
  ({
    uid: 'fb-admin-1',
    email: 'admin@example.com',
    role: 'ADMIN',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
    ...extra,
  }) as unknown as DecodedIdToken;

function row(overrides: Partial<AuditRecordRow> = {}): AuditRecordRow {
  return {
    id: RECORD_ID,
    actorId: ADMIN_ID,
    targetType: 'team',
    targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    actionType: 'moderation_warn',
    category: 'moderation',
    reason: 'Repeated spam',
    outcome: 'Applied',
    safeStateSummary: { caseId: 'x', status: 'Resolved' },
    createdAt: CREATED,
    ...overrides,
  };
}

const page = (records: AuditRecordRow[], extra: Partial<AuditQueryResult> = {}): AuditQueryResult => ({
  records,
  hasMore: false,
  nextCursor: null,
  ...extra,
});

describe('Audit records endpoint (US-028 / #258)', () => {
  let query: MockInstance<IAuditRecordsRepository['query']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockVerifyIdToken.mockResolvedValue(decoded());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(admin);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(admin);
    query = vi.spyOn(auditRecordsRepository, 'query').mockResolvedValue(page([]));
  });

  const get = (qs = '') => request(app).get(`${URL}${qs}`).set('Authorization', AUTH);

  // ---------------------------------------------------------------------------
  describe('permissions (AC 3) - every method, nothing reaches the database', () => {
    const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

    describe.each(METHODS)('%s', (method) => {
      const call = (auth?: string) => {
        const r = request(app)[method](URL);
        return auth ? r.set('Authorization', auth) : r;
      };

      it('401 for Visitors and malformed credentials', async () => {
        expect((await call()).status).toBe(401);
        expect((await call('Basic abc')).status).toBe(401);
        expect((await call('Bearer')).status).toBe(401);
        expect(query).not.toHaveBeenCalled();
      });

      it('401 for invalid, expired and revoked tokens', async () => {
        for (const [code, expected] of [
          ['auth/argument-error', 'INVALID_TOKEN'],
          ['auth/id-token-expired', 'TOKEN_EXPIRED'],
          ['auth/id-token-revoked', 'TOKEN_REVOKED'],
        ] as const) {
          mockVerifyIdToken.mockRejectedValue({ code });
          const res = await call(AUTH);
          expect(res.status).toBe(401);
          expect(res.body.code).toBe(expected);
        }
        expect(query).not.toHaveBeenCalled();
      });

      it('403 MFA_REQUIRED when the email code step is not completed', async () => {
        mockVerifyIdToken.mockResolvedValue(decoded({ [MFA_CLAIM]: undefined }));
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('MFA_REQUIRED');
        expect(query).not.toHaveBeenCalled();
      });

      it('403 for a PART participant', async () => {
        mockVerifyIdToken.mockResolvedValue(decoded({ role: 'PART' }));
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({ ...admin, role: 'PART' });
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expect(query).not.toHaveBeenCalled();
      });

      it('403 for a forged ADMIN claim on a PART account', async () => {
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({ ...admin, role: 'PART' });
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expect(query).not.toHaveBeenCalled();
      });

      it('403 ACCOUNT_SUSPENDED for a suspended ADMIN', async () => {
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({ ...admin, is_suspended: true });
        const res = await call(AUTH);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
        expect(query).not.toHaveBeenCalled();
      });

      it('denials never expose record content', async () => {
        query.mockResolvedValue(page([row({ reason: 'TOP-SECRET-REASON' })]));
        mockVerifyIdToken.mockResolvedValue(decoded({ role: 'PART' }));
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({ ...admin, role: 'PART' });
        const res = await call(AUTH);
        expect(JSON.stringify(res.body)).not.toContain('TOP-SECRET-REASON');
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('append-only (AC 3): no write API', () => {
    it.each([
      ['post', URL],
      ['put', URL],
      ['patch', URL],
      ['delete', URL],
      ['put', `${URL}/${RECORD_ID}`],
      ['patch', `${URL}/${RECORD_ID}`],
      ['delete', `${URL}/${RECORD_ID}`],
      ['post', `${URL}/${RECORD_ID}/redact`],
    ] as const)('%s %s -> 405 AUDIT_RECORDS_READ_ONLY for an ADMIN', async (method, path) => {
      const res = await request(app)[method](path).set('Authorization', AUTH).send({ reason: 'tamper' });
      expect(res.status).toBe(405);
      expect(res.body.code).toBe('AUDIT_RECORDS_READ_ONLY');
      expect(res.headers.allow).toMatch(/GET/);
      expect(query).not.toHaveBeenCalled();
    });

    it('answers 404 (not 405) for unknown GET sub-paths', async () => {
      const res = await request(app).get(`${URL}/${RECORD_ID}`).set('Authorization', AUTH);
      expect(res.status).toBe(404);
    });

    it('a method-override header cannot turn a write into a read (or the reverse)', async () => {
      for (const header of ['X-HTTP-Method-Override', 'X-Method-Override', 'X-HTTP-Method']) {
        const res = await request(app).post(URL).set('Authorization', AUTH).set(header, 'GET');
        expect(res.status, header).toBe(405);
      }
      const del = await request(app).get(URL).set('Authorization', AUTH).set('X-HTTP-Method-Override', 'DELETE');
      expect(del.status).toBe(200); // still just a read: the header is ignored
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('a request body cannot smuggle a change into the read endpoint', async () => {
      const res = await request(app)
        .get(URL)
        .set('Authorization', AUTH)
        .send({ action: 'delete', id: RECORD_ID, reason: 'tamper' });
      expect(res.status).toBe(200);
      // Only the validated query parameters ever reach the database call.
      expect(Object.keys(query.mock.calls[0][1]).sort()).toEqual(
        ['actionType', 'actorId', 'category', 'cursor', 'from', 'limit', 'to']
      );
    });

    it('refuses unusual HTTP verbs for an ADMIN, and asks non-admins for credentials first', async () => {
      const server = app.listen(0);
      const { port } = server.address() as AddressInfo;
      const call = (method: string, auth?: string) =>
        new Promise<{ status: number; allow?: string }>((resolve, reject) => {
          const req = http.request(
            { port, path: URL, method, headers: auth ? { Authorization: auth } : {} },
            (res) => {
              res.resume();
              res.on('end', () => resolve({ status: res.statusCode ?? 0, allow: res.headers.allow as string | undefined }));
            }
          );
          req.on('error', reject);
          req.end();
        });
      try {
        for (const method of ['PROPFIND', 'PURGE', 'MKCOL', 'MOVE', 'COPY', 'LOCK']) {
          const asAdmin = await call(method, AUTH);
          expect(asAdmin.status, method).toBe(405);
          expect(asAdmin.allow).toMatch(/GET/);
          expect((await call(method)).status, `${method} without credentials`).toBe(401);
        }
        expect(query).not.toHaveBeenCalled();
      } finally {
        server.closeAllConnections?.();
        await new Promise((r) => server.close(r));
      }
    });

    it('HEAD and OPTIONS stay harmless: they never read records and are never treated as writes', async () => {
      const head = await request(app).head(URL).set('Authorization', AUTH);
      expect(head.status).toBe(200);
      expect(head.text ?? '').toBe('');
      const options = await request(app).options(URL).set('Authorization', AUTH);
      expect(options.status).not.toBe(405);
      expect(options.status).toBeLessThan(500);
    });
  });

  // ---------------------------------------------------------------------------
  describe('happy path (AC 1, 2)', () => {
    it('returns event, moderation and account records with every AC 2 field', async () => {
      query.mockResolvedValue(
        page([
          row({ id: 'r3', actionType: 'account_suspend', category: 'account', targetType: 'participant' }),
          row({ id: 'r2', actionType: 'event_approve', category: 'event', targetType: 'event' }),
          row({ id: 'r1' }),
        ])
      );
      const res = await get();

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ status: 'ok', count: 3, hasMore: false, nextCursor: null });
      expect(res.body.records.map((r: { category: string }) => r.category)).toEqual(['account', 'event', 'moderation']);
      expect(res.body.records[2]).toEqual({
        id: 'r1',
        actorId: ADMIN_ID,
        actionType: 'moderation_warn',
        category: 'moderation',
        targetType: 'team',
        targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        reason: 'Repeated spam',
        outcome: 'Applied',
        safeStateSummary: { caseId: 'x', status: 'Resolved' },
        createdAt: CREATED,
      });
    });

    it('identifies the caller from the session and applies default paging', async () => {
      await get();
      expect(query).toHaveBeenCalledWith(ADMIN_ID, {
        actorId: null,
        actionType: null,
        category: null,
        from: null,
        to: null,
        limit: 25,
        cursor: null,
      });
    });

    it('exposes the actor by id only (no email or name)', async () => {
      query.mockResolvedValue(page([row()]));
      const res = await get();
      expect(JSON.stringify(res.body)).not.toMatch(/admin@example\.com|Platform Admin|full_name|email/);
    });

    it('returns UTC timestamps', async () => {
      query.mockResolvedValue(page([row()]));
      expect((await get()).body.records[0].createdAt).toMatch(/Z$/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('filters (AC 4)', () => {
    it('passes actor, action type, category and date filters to the database and echoes them', async () => {
      const res = await get(
        `?actor=${ACTOR.toUpperCase()}&actionType=account_suspend&category=account&from=2026-11-01&to=2026-11-03`
      );
      expect(res.status).toBe(200);
      // The `actor` filter selects whose records to show; it must never become the caller.
      expect(query.mock.calls[0][0]).toBe(ADMIN_ID);
      expect(query.mock.calls[0][1]).toMatchObject({
        actorId: ACTOR,
        actionType: 'account_suspend',
        category: 'account',
        from: '2026-11-01T00:00:00.000000Z',
        to: '2026-11-03T23:59:59.999999Z',
      });
      expect(res.body.filters).toEqual({
        actor: ACTOR,
        actionType: 'account_suspend',
        category: 'account',
        from: '2026-11-01T00:00:00.000000Z',
        to: '2026-11-03T23:59:59.999999Z',
      });
    });

    it('accepts full timestamps with an offset unchanged', async () => {
      await get('?from=2026-11-01T10:00:00.5-05:00&to=2026-11-02T10:00:00Z');
      expect(query.mock.calls[0][1]).toMatchObject({
        from: '2026-11-01T10:00:00.5-05:00',
        to: '2026-11-02T10:00:00Z',
      });
    });

    it('returns an explicit empty result (not an error) when nothing matches', async () => {
      const res = await get('?actionType=no_such_action');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', records: [], count: 0, hasMore: false, nextCursor: null });
    });
  });

  // ---------------------------------------------------------------------------
  describe('pagination and boundaries', () => {
    it.each(['1', '25', '100'])('accepts limit=%s', async (limit) => {
      const res = await get(`?limit=${limit}`);
      expect(res.status).toBe(200);
      expect(query.mock.calls[0][1]).toMatchObject({ limit: Number(limit) });
    });

    it('returns an opaque nextCursor that round-trips into the next request', async () => {
      query.mockResolvedValueOnce(
        page([row()], { hasMore: true, nextCursor: { createdAt: CREATED, id: RECORD_ID } })
      );
      const first = await get('?limit=1');
      expect(first.body.hasMore).toBe(true);
      expect(first.body.nextCursor).toBe(encodeAuditCursor({ createdAt: CREATED, id: RECORD_ID }));

      await get(`?limit=1&cursor=${first.body.nextCursor}`);
      expect(query.mock.calls[1][1].cursor).toEqual({ createdAt: CREATED, id: RECORD_ID });
    });

    it('accepts a 50-character action type and a leap-day date', async () => {
      expect((await get(`?actionType=${'a'.repeat(50)}`)).status).toBe(200);
      expect((await get('?from=2028-02-29&to=2028-02-29')).status).toBe(200);
    });

    it('accepts from == to (single instant)', async () => {
      expect((await get('?from=2026-11-03T10:00:00Z&to=2026-11-03T10:00:00Z')).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  describe('invalid input -> 400 before any database access', () => {
    it.each([
      ['limit=0', 'limit'],
      ['limit=101', 'limit'],
      ['limit=-1', 'limit'],
      ['limit=2.5', 'limit'],
      ['limit=', 'limit'],
      ['limit=1&limit=2', 'limit'],
      ['actor=not-a-uuid', 'actor'],
      ['actor=', 'actor'],
      ['actionType=Account_Suspend', 'actionType'],
      ['actionType=a-b', 'actionType'],
      ['actionType=1abc', 'actionType'],
      ['actionType=', 'actionType'],
      ['actionType=moderation_%25', 'actionType'],
      ["actionType=x'%3B--", 'actionType'],
      [`actionType=${'a'.repeat(51)}`, 'actionType'],
      ['category=Moderation', 'category'],
      ['category=other', 'category'],
      ['from=2026-02-30', 'from'],
      ['from=2026-13-01', 'from'],
      ['from=yesterday', 'from'],
      ['from=2026-11-03T25:00:00Z', 'from'],
      ['from=2026-11-03T10:00:00', 'from'],
      ['to=11/03/2026', 'to'],
      ['to=2026-11-03T10:00:00+25:00', 'to'],
      ['cursor=', 'cursor'],
      ['cursor=!!!', 'cursor'],
      ['sort=asc', 'sort'],
      ['offset=5', 'offset'],
      ['q=anything', 'q'],
    ])('?%s -> 400 on "%s"', async (qs, field) => {
      const res = await get(`?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.fieldErrors[field]).toBeTruthy();
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects from after to', async () => {
      const res = await get('?from=2026-11-04&to=2026-11-03');
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.from).toMatch(/not be after/i);
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects cursors that are malformed, forged, or oversized', async () => {
      const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
      for (const cursor of [
        enc({ a: 1 }),
        enc([CREATED]),
        enc([CREATED, 'nope']),
        enc(['2026-11-03', RECORD_ID]),
        enc([`${CREATED}",id.gt.0,x.eq."`, RECORD_ID]),
        'A'.repeat(500),
      ]) {
        const res = await get(`?cursor=${cursor}`);
        expect(res.status, cursor.slice(0, 20)).toBe(400);
      }
      expect(query).not.toHaveBeenCalled();
    });

    it('reports every invalid field at once and echoes the submitted query', async () => {
      const res = await get('?limit=0&category=x&actor=bad');
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(['actor', 'category', 'limit']);
      expect(res.body.submitted).toEqual({ limit: '0', category: 'x', actor: 'bad' });
    });
  });

  // ---------------------------------------------------------------------------
  describe('privacy (NR-023 / FR-079)', () => {
    it('scrubs credentials and private contacts from summaries on read', async () => {
      query.mockResolvedValue(
        page([
          row({
            safeStateSummary: {
              caseId: 'c1',
              password: 'hunter2',
              email: 'victim@example.com',
              nested: { otp: '987654', note: 'kept' },
            },
          }),
          row({
            id: 'acct',
            category: 'account',
            actionType: 'account_suspend',
            safeStateSummary: {
              status: 'Suspended',
              idToken: 'eyJhbGci',
              password: 'hunter2',
              email: 'target@example.com',
              phone: '555-0100',
              contacts: [{ phoneNumber: '555-0199', label: 'kept-label' }],
            },
          }),
        ])
      );
      const body = JSON.stringify((await get()).body);
      expect(body).not.toMatch(/hunter2|victim@example\.com|target@example\.com|987654|eyJhbGci|555-01/);
      expect(body).toContain('"caseId":"c1"');
      expect(body).toContain('"note":"kept"');
      expect(body).toContain('"status":"Suspended"');
      expect(body).toContain('kept-label');
    });

    it('treats a null summary as an empty object', async () => {
      query.mockResolvedValue(page([row({ safeStateSummary: null })]));
      expect((await get()).body.records[0].safeStateSummary).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  describe('failure handling', () => {
    const SECRET = 'postgres://svc:hunter2@db.internal:5432/prod';

    it('maps a database FORBIDDEN_NOT_ADMIN (defense in depth) to an explicit 403', async () => {
      query.mockRejectedValue({ message: 'FORBIDDEN_NOT_ADMIN', code: 'P0001' });
      const res = await get();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_ADMIN');
    });

    it('maps a database VALIDATION_ERROR to a 400 with the failing fields', async () => {
      query.mockRejectedValue({
        message: 'VALIDATION_ERROR',
        code: 'P0001',
        details: JSON.stringify({ limit: 'limit must be between 1 and 100.' }),
      });
      const res = await get();
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toEqual({ limit: 'limit must be between 1 and 100.' });
    });

    it('survives a non-JSON error detail', async () => {
      query.mockRejectedValue({ message: 'VALIDATION_ERROR', details: 'oops' });
      const res = await get();
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toBeUndefined();
    });

    it('returns a safe 500 for unexpected failures without leaking details', async () => {
      query.mockRejectedValue(new Error(SECRET));
      const res = await get();
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|db\.internal|stack/);
    });

    it('fails closed when the account lookup itself fails', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockRejectedValue(new Error(SECRET));
      const res = await get();
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
      expect(query).not.toHaveBeenCalled();
    });

    it('a failed read has no side effects and the next request succeeds', async () => {
      query.mockRejectedValueOnce(new Error('timeout'));
      expect((await get()).status).toBe(500);
      query.mockResolvedValueOnce(page([row()]));
      const retry = await get();
      expect(retry.status).toBe(200);
      expect(retry.body.count).toBe(1);
    });
  });
});
