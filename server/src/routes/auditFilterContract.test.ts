/**
 * US-028 / #264 — the API side of the filter contract shared with the React app.
 * The same file drives client/src/components/audit/auditFilterContract.test.ts, so the two
 * validators must agree on every case.
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { auditRecordsRepository, type IAuditRecordsRepository } from '../db/auditRecords.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = { verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args), getUser: vi.fn(), setCustomUserClaims: vi.fn() };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

interface ValidCase {
  name: string;
  form: Record<string, string>;
  limit: number;
  query: string;
  serverParams: Record<string, unknown>;
}
interface InvalidCase {
  name: string;
  form: Record<string, string>;
  serverQuery: string;
  errorFields: string[];
}

const contract = JSON.parse(
  fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'auditFilterContract.json'), 'utf8')
) as { valid: ValidCase[]; invalid: InvalidCase[] };

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
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

describe('audit filter contract: API side (US-028 / #264)', () => {
  let query: MockInstance<IAuditRecordsRepository['query']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockVerifyIdToken.mockResolvedValue({ uid: 'fb-admin-1', role: 'ADMIN', auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME } as unknown as DecodedIdToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(admin);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(admin);
    query = vi.spyOn(auditRecordsRepository, 'query').mockResolvedValue({ records: [], hasMore: false, nextCursor: null });
  });

  const get = (qs: string) => request(app).get(`/api/admin/audit-records?${qs}`).set('Authorization', 'Bearer valid-mfa-token');

  it('the contract is substantial and its case names are unique', () => {
    expect(contract.valid.length).toBeGreaterThanOrEqual(10);
    expect(contract.invalid.length).toBeGreaterThanOrEqual(10);
    const names = [...contract.valid, ...contract.invalid].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  describe.each(contract.valid)('accepts: $name', (c) => {
    it('the exact query string the client sends is accepted and reaches the database as expected', async () => {
      const res = await get(c.query);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(ADMIN_ID, c.serverParams);
    });
  });

  describe.each(contract.invalid)('rejects: $name', (c) => {
    it('flags exactly the same fields the form flags, and never reaches the database', async () => {
      const res = await get(c.serverQuery);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual([...c.errorFields].sort());
      expect(query).not.toHaveBeenCalled();
    });
  });
});
