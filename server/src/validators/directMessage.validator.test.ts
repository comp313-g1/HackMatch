import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  validateDmThreadIdParam,
  validateOpenThreadBody,
  validateOpenThreadInput,
  validateSendMessageBody,
  validateSendMessageInput,
} from './directMessage.validator.js';

const VALID_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeMockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let jsonBody: unknown;
  const res = {
    setHeader: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      jsonBody = payload;
      return res;
    }),
  } as unknown as Response;

  return {
    res,
    getStatus: () => statusCode,
    getJson: () => jsonBody as Record<string, unknown>,
    getHeaders: () => headers,
  };
}

describe('directMessage.validator (US-032 / #391 / FR-089, FR-091, NR-017)', () => {
  describe('validateOpenThreadInput & validateOpenThreadBody', () => {
    it('accepts and trims a valid participantId UUID', () => {
      const result = validateOpenThreadInput({ participantId: `  ${VALID_UUID}  ` });
      expect(result.errors).toEqual({});
      expect(result.sanitized).toEqual({ participantId: VALID_UUID });
    });

    it.each([
      ['null payload', null, 'body'],
      ['array payload', [VALID_UUID], 'body'],
      ['primitive payload', 'not-an-object', 'body'],
      ['missing participantId', {}, 'participantId'],
      ['blank participantId', { participantId: '   ' }, 'participantId'],
      ['malformed UUID participantId', { participantId: '12345-not-uuid' }, 'participantId'],
      ['unknown field injection', { participantId: VALID_UUID, callerId: VALID_UUID }, 'callerId'],
    ])('rejects %s with field error on %s', (_label, input, expectedField) => {
      const result = validateOpenThreadInput(input);
      expect(result.errors[expectedField]).toBeDefined();
      expect(result.sanitized).toBeUndefined();
    });

    it('middleware returns 400 VALIDATION_ERROR with no-store and redacts credentials in submitted echo', () => {
      const req = {
        body: {
          participantId: 'invalid-uuid',
          password: 'MySecretPassword!',
          otp: '999888',
        },
      } as unknown as Request;
      const { res, getStatus, getJson, getHeaders } = makeMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateOpenThreadBody(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(getStatus()).toBe(400);
      expect(getHeaders()['cache-control']).toBe('no-store');
      expect(getJson()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: {
          participantId: 'participantId must be a valid UUID.',
          password: 'Unknown field "password".',
          otp: 'Unknown field "otp".',
        },
        submitted: {
          participantId: 'invalid-uuid',
          password: '[redacted]',
          otp: '[redacted]',
        },
      });
    });

    it('middleware mutates req.body with sanitized payload and calls next on valid input', () => {
      const req = { body: { participantId: ` ${VALID_UUID} ` } } as unknown as Request;
      const { res } = makeMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateOpenThreadBody(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.body).toEqual({ participantId: VALID_UUID });
    });
  });

  describe('validateDmThreadIdParam', () => {
    it('trims valid UUID threadId param and calls next', () => {
      const req = { params: { threadId: `  ${VALID_UUID}  ` } } as unknown as Request;
      const { res } = makeMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateDmThreadIdParam(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.params.threadId).toBe(VALID_UUID);
    });

    it('handles array threadId param when first element is valid UUID', () => {
      const req = { params: { threadId: [VALID_UUID, 'ignored'] } } as unknown as Request;
      const { res } = makeMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateDmThreadIdParam(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.params.threadId).toBe(VALID_UUID);
    });

    it.each([
      ['missing threadId', {}],
      ['empty threadId', { threadId: '   ' }],
      ['malformed UUID threadId', { threadId: 'not-a-valid-uuid' }],
    ])('rejects %s with 400 VALIDATION_ERROR', (_label, params) => {
      const req = { params } as unknown as Request;
      const { res, getStatus, getJson, getHeaders } = makeMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateDmThreadIdParam(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(getStatus()).toBe(400);
      expect(getHeaders()['cache-control']).toBe('no-store');
      expect(getJson()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: { threadId: 'threadId must be a valid UUID.' },
      });
    });
  });

  describe('validateSendMessageInput & validateSendMessageBody', () => {
    it('accepts minimum 1-character message body and trims surrounding whitespace', () => {
      const result = validateSendMessageInput({ body: '  a  ' });
      expect(result.errors).toEqual({});
      expect(result.sanitized).toEqual({ body: 'a' });
    });

    it('accepts exact 4000-character boundary message body', () => {
      const exact4000 = 'x'.repeat(4000);
      const result = validateSendMessageInput({ body: exact4000 });
      expect(result.errors).toEqual({});
      expect(result.sanitized).toEqual({ body: exact4000 });
    });

    it('rejects 4001-character over-boundary message body while preserving draft', () => {
      const over4001 = 'x'.repeat(4001);
      const result = validateSendMessageInput({ body: over4001 });
      expect(result.sanitized).toBeNull();
      expect(result.errors.body).toBe('body must be at most 4000 characters.');
      expect(result.submitted).toEqual({ body: over4001 });
    });

    it.each([
      ['empty string', { body: '' }, 'body is required.'],
      ['spaces and tabs only', { body: '   \t\n  ' }, 'body is required.'],
      ['missing body property', {}, 'body is required.'],
      ['non-string numeric body', { body: 42 }, 'body is required.'],
      ['null payload', null, 'Request body must be a JSON object.'],
      ['array payload', ['hello'], 'Request body must be a JSON object.'],
    ])('rejects %s with "%s"', (_label, input, expectedMessage) => {
      const result = validateSendMessageInput(input);
      expect(result.sanitized).toBeNull();
      expect(result.errors.body).toBe(expectedMessage);
    });

    it('rejects unknown fields alongside body and redacts sensitive keys in middleware response', () => {
      const req = {
        body: {
          body: '   ',
          authorId: VALID_UUID,
          accessToken: 'jwt-secret-token',
        },
      } as unknown as Request;
      const { res, getStatus, getJson, getHeaders } = makeMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateSendMessageBody(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(getStatus()).toBe(400);
      expect(getHeaders()['cache-control']).toBe('no-store');
      expect(getJson()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: {
          body: 'body is required.',
          authorId: 'Unknown field "authorId".',
          accessToken: 'Unknown field "accessToken".',
        },
        submitted: {
          body: '   ',
          authorId: VALID_UUID,
          accessToken: '[redacted]',
        },
      });
    });

    it('middleware normalizes valid body and calls next', () => {
      const req = { body: { body: '  Ready to team up?  ' } } as unknown as Request;
      const { res } = makeMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateSendMessageBody(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.body).toEqual({ body: 'Ready to team up?' });
    });
  });
});
