import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  validateBeginAuthenticatorEnrollment,
  validateConfirmAuthenticatorEnrollment,
} from './authenticatorEnrollment.validator.js';

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
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

describe('authenticator enrollment validators (US-029 / #266)', () => {
  it('accepts an empty begin request', () => {
    const req = { body: {} } as Request;
    const res = response();
    const next = vi.fn() as unknown as NextFunction;

    validateBeginAuthenticatorEnrollment(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({});
  });

  it('rejects arbitrary target-account fields without echoing their values', () => {
    const req = { body: { participantId: 'another-account', secret: 'do-not-echo' } } as Request;
    const res = response();
    const next = vi.fn() as unknown as NextFunction;

    validateBeginAuthenticatorEnrollment(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(JSON.stringify(res.body)).not.toContain('another-account');
    expect(JSON.stringify(res.body)).not.toContain('do-not-echo');
  });

  it('normalizes a valid opaque enrollment id and six-digit code', () => {
    const req = {
      body: { enrollmentId: '  enrollment_123  ', code: '  012345  ' },
    } as Request;
    const res = response();
    const next = vi.fn() as unknown as NextFunction;

    validateConfirmAuthenticatorEnrollment(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ enrollmentId: 'enrollment_123', code: '012345' });
  });

  it.each(['12345', '1234567', '123 56', 'abcdef', 123456, '', undefined])(
    'rejects malformed authenticator code %j',
    (code) => {
      const req = { body: { enrollmentId: 'enrollment_123', code } } as Request;
      const res = response();
      const next = vi.fn() as unknown as NextFunction;

      validateConfirmAuthenticatorEnrollment(req, res as unknown as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: { code: 'A 6-digit authenticator code is required.' },
      });
      if (typeof code === 'string' && code.length > 0) {
        expect(JSON.stringify(res.body)).not.toContain(code);
      }
    }
  );

  it('rejects unapproved fields and never echoes a submitted code', () => {
    const req = {
      body: { enrollmentId: 'enrollment_123', code: '654321', participantId: 'other' },
    } as Request;
    const res = response();
    const next = vi.fn() as unknown as NextFunction;

    validateConfirmAuthenticatorEnrollment(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: { request: 'Only enrollmentId and code are accepted.' },
    });
    expect(JSON.stringify(res.body)).not.toContain('654321');
  });
});
