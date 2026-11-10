/**
 * US-028 / #264 — the React side of the filter contract shared with the Express API.
 * server/src/routes/auditFilterContract.json drives this test and
 * server/src/routes/auditFilterContract.test.ts, so the form's validation and the API's
 * validation cannot drift apart: a rule changed on one side only fails a test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateAuditFilters } from './auditFilterValidation';
import { fetchAuditRecords } from './auditApi';
import type { AuditFilters } from './auditTypes';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>('../../config/authFetch');
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch } from '../../config/authFetch';

interface ValidCase {
  name: string;
  form: AuditFilters;
  limit: number;
  query: string;
}
interface InvalidCase {
  name: string;
  form: AuditFilters;
  errorFields: string[];
}

const CONTRACT = path.resolve(__dirname, '../../../../server/src/routes/auditFilterContract.json');
const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8')) as { valid: ValidCase[]; invalid: InvalidCase[] };

describe('audit filter contract: React side (US-028 / #264)', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset();
    vi.mocked(authFetch).mockImplementation(async () => new Response(JSON.stringify({ records: [] }), { status: 200 }));
  });

  it('finds the shared contract written for the API (so this cannot pass vacuously)', () => {
    expect(fs.existsSync(CONTRACT)).toBe(true);
    expect(contract.valid.length).toBeGreaterThanOrEqual(10);
    expect(contract.invalid.length).toBeGreaterThanOrEqual(10);
  });

  describe.each(contract.valid)('accepts: $name', (c) => {
    it('the form validates, and the request URL is exactly what the API contract expects', async () => {
      const result = validateAuditFilters(c.form);
      expect(result.errors).toEqual({});
      expect(result.filters).not.toBeNull();

      await fetchAuditRecords({ limit: c.limit, ...result.filters! });

      expect(authFetch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(authFetch).mock.calls[0][0]).toBe(`/api/admin/audit-records?${c.query}`);
    });
  });

  describe.each(contract.invalid)('rejects: $name', (c) => {
    it('the form flags exactly the same fields the API flags, and sends nothing', () => {
      const result = validateAuditFilters(c.form);
      expect(result.filters).toBeNull();
      expect(Object.keys(result.errors).sort()).toEqual([...c.errorFields].sort());
      expect(authFetch).not.toHaveBeenCalled();
    });
  });
});
