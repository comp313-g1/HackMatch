import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  MAX_ACCOUNTS_LIST_LIMIT,
  parseAccountsListQuery,
  validateAccountIdParam,
  validateAccountsListQuery,
} from './accounts.validator.js';

describe('parseAccountsListQuery (US-027 / #248)', () => {
  it('accepts empty query with default limit', () => {
    const result = parseAccountsListQuery({});
    expect(result.errors).toEqual({});
    expect(result.sanitized).toEqual({ limit: 50 });
  });

  it('accepts role, state, q, and limit filters', () => {
    const result = parseAccountsListQuery({
      role: 'PART',
      state: 'Suspended',
      q: 'ada',
      limit: '25',
    });
    expect(result.errors).toEqual({});
    expect(result.sanitized).toEqual({
      role: 'PART',
      state: 'Suspended',
      q: 'ada',
      limit: 25,
    });
  });

  it('rejects invalid state and echoes submitted values', () => {
    const result = parseAccountsListQuery({ state: 'Banned', limit: '10' });
    expect(result.sanitized).toBeNull();
    expect(result.errors.state).toMatch(/Active, Suspended, or Deactivated/);
    expect(result.submitted.state).toBe('Banned');
  });

  it(`rejects limit above ${MAX_ACCOUNTS_LIST_LIMIT}`, () => {
    const result = parseAccountsListQuery({ limit: String(MAX_ACCOUNTS_LIST_LIMIT + 1) });
    expect(result.errors.limit).toMatch(/between 1 and/);
    expect(result.submitted.limit).toBe(String(MAX_ACCOUNTS_LIST_LIMIT + 1));
  });
});

describe('accounts validator middleware (US-027 / #248)', () => {
  it('validateAccountsListQuery responds 400 with submitted draft', () => {
    const req = { query: { role: 'SUPER' } } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = {
      setHeader: vi.fn(),
      status,
      locals: {},
    } as unknown as Response;
    const next = vi.fn();

    validateAccountsListQuery(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        submitted: expect.objectContaining({ role: 'SUPER' }),
      })
    );
  });

  it('validateAccountIdParam rejects non-UUID and preserves submitted value', () => {
    const req = { params: { accountId: 'not-a-uuid' } } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { setHeader: vi.fn(), status } as unknown as Response;
    const next = vi.fn();

    validateAccountIdParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        submitted: { accountId: 'not-a-uuid' },
      })
    );
  });
});
