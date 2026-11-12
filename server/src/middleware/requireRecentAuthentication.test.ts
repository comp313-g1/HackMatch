import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireRecentAuthentication } from './requireRecentAuthentication.js';
import { securityConfig } from '../config/security.js';

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe('requireRecentAuthentication (US-029 / #266)', () => {
  it('accepts a primary authentication within the configured window', () => {
    const now = Math.floor(Date.now() / 1000);
    const req = { firebaseUser: { auth_time: now - 30 } } as unknown as Request;
    const res = response();
    const next = vi.fn() as unknown as NextFunction;

    requireRecentAuthentication(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['too old', Math.floor(Date.now() / 1000) - securityConfig.recentSignInSeconds - 1],
    ['future skew', Math.floor(Date.now() / 1000) + 31],
  ])('rejects %s auth_time with a safe reauthentication contract', (_label, authTime) => {
    const req = { firebaseUser: { auth_time: authTime } } as unknown as Request;
    const res = response();
    const next = vi.fn() as unknown as NextFunction;

    requireRecentAuthentication(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: 'Recent reauthentication is required to change authenticator settings. Please sign in again.',
      code: 'REAUTHENTICATION_REQUIRED',
    });
  });
});
