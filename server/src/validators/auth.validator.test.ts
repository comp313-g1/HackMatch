import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  isPasswordPolicyCompliant,
  validateRegisterPayload,
  validateResendVerificationPayload,
  validateVerifyEmailPayload,
  PRIVILEGE_ESCALATION_KEYS,
} from './auth.validator.js';

interface MockResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res;
}

describe('auth.validator unit tests (US-001 AC 1 / T2 / AC 4 / T6)', () => {
  describe('isPasswordPolicyCompliant', () => {
    it('returns true for an 8-character compliant password', () => {
      expect(isPasswordPolicyCompliant('Abcdef1!')).toBe(true);
    });

    it('returns false when password is fewer than 8 characters', () => {
      expect(isPasswordPolicyCompliant('Ab1!xyz')).toBe(false); // 7 chars
      expect(isPasswordPolicyCompliant('')).toBe(false);
    });

    it('returns false when missing uppercase character', () => {
      expect(isPasswordPolicyCompliant('abcdef1!')).toBe(false);
    });

    it('returns false when missing lowercase character', () => {
      expect(isPasswordPolicyCompliant('ABCDEF1!')).toBe(false);
    });

    it('returns false when missing digit', () => {
      expect(isPasswordPolicyCompliant('Abcdefg!')).toBe(false);
    });

    it('returns false when missing special character', () => {
      expect(isPasswordPolicyCompliant('Abcdefg1')).toBe(false);
    });

    it('returns false for non-string inputs', () => {
      expect(isPasswordPolicyCompliant(undefined as unknown as string)).toBe(false);
      expect(isPasswordPolicyCompliant(null as unknown as string)).toBe(false);
      expect(isPasswordPolicyCompliant(12345678 as unknown as string)).toBe(false);
    });

    it('pins current behavior: counts whitespace as a special character', () => {
      expect(isPasswordPolicyCompliant('Abcdefg1 ')).toBe(true);
    });
  });

  describe('validateRegisterPayload', () => {
    it('calls next() for valid payload and trims/normalizes fields', () => {
      const req = {
        body: {
          fullName: '  Alice Wonderland  ',
          email: '  Alice@Example.COM  ',
          password: 'Password123!',
        },
      } as unknown as Request;
      const res = createMockResponse();
      const next = vi.fn() as unknown as NextFunction;

      validateRegisterPayload(req, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.body.fullName).toBe('Alice Wonderland');
      expect(req.body.email).toBe('alice@example.com');
      expect(req.body.password).toBe('Password123!');
    });

    describe('Full Name boundaries', () => {
      it('accepts fullName of exactly 100 characters', () => {
        const name100 = 'a'.repeat(100);
        const req = {
          body: {
            fullName: name100,
            email: 'valid@example.com',
            password: 'Password123!',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.body.fullName).toBe(name100);
      });

      it('rejects fullName of 101 characters with 400', () => {
        const name101 = 'a'.repeat(101);
        const req = {
          body: {
            fullName: name101,
            email: 'valid@example.com',
            password: 'Password123!',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect((res.body as { errors: Record<string, string> }).errors.fullName).toBe(
          'Full name must not exceed 100 characters.'
        );
      });

      it('accepts fullName exceeding 100 characters before trimming if trimmed length is 100', () => {
        const paddedName100 = '   ' + 'a'.repeat(100) + '   ';
        const req = {
          body: {
            fullName: paddedName100,
            email: 'valid@example.com',
            password: 'Password123!',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.body.fullName).toBe('a'.repeat(100));
      });
    });

    describe('Email boundaries', () => {
      it('accepts email of exactly 255 valid characters', () => {
        // local part: 64 chars, domain: 186 chars, suffix: .com (4) -> 64 + 1 + 186 + 4 = 255
        const localPart = 'a'.repeat(64);
        const domainLabel = 'b'.repeat(186);
        const email255 = `${localPart}@${domainLabel}.com`;
        expect(email255.length).toBe(255);

        const req = {
          body: {
            fullName: 'Valid User',
            email: email255,
            password: 'Password123!',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.body.email).toBe(email255.toLowerCase());
      });

      it('rejects email of 256 characters with 400', () => {
        const localPart = 'a'.repeat(64);
        const domainLabel = 'b'.repeat(187);
        const email256 = `${localPart}@${domainLabel}.com`;
        expect(email256.length).toBe(256);

        const req = {
          body: {
            fullName: 'Valid User',
            email: email256,
            password: 'Password123!',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect((res.body as { errors: Record<string, string> }).errors.email).toBe(
          'Please provide a valid email address.'
        );
      });
    });

    describe('Role boundaries & ADMIN protection (AC 4 / T6 / FR-001)', () => {
      it('allows undefined role and defaults to PART flow', () => {
        const req = {
          body: {
            fullName: 'Valid User',
            email: 'valid@example.com',
            password: 'Password123!',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledOnce();
      });

      it('allows null role', () => {
        const req = {
          body: {
            fullName: 'Valid User',
            email: 'valid@example.com',
            password: 'Password123!',
            role: null,
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledOnce();
      });

      it('allows role: " part " with leading/trailing whitespace', () => {
        const req = {
          body: {
            fullName: 'Valid User',
            email: 'valid@example.com',
            password: 'Password123!',
            role: ' part ',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledOnce();
      });

      it('rejects role: "" (empty string) with 403', () => {
        const req = {
          body: {
            fullName: 'Valid User',
            email: 'valid@example.com',
            password: 'Password123!',
            role: '',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
      });

      it('rejects non-PART roles (LEAD, 0, false) with 403', () => {
        for (const badRole of ['LEAD', 0, false]) {
          const req = {
            body: {
              fullName: 'Valid User',
              email: 'valid@example.com',
              password: 'Password123!',
              role: badRole,
            },
          } as unknown as Request;
          const res = createMockResponse();
          const next = vi.fn() as unknown as NextFunction;

          validateRegisterPayload(req, res as unknown as Response, next);
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(403);
        }
      });

      it('enforces 403 role precedence before field validation runs', () => {
        const req = {
          body: {
            role: 'ADMIN',
            fullName: '',
            email: 'bad',
            password: 'short',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect((res.body as { error: string }).error).toBe(
          'Public registration cannot grant administrative privileges.'
        );
      });

      it('exports expected PRIVILEGE_ESCALATION_KEYS list', () => {
        expect(PRIVILEGE_ESCALATION_KEYS).toEqual([
          'isAdmin',
          'is_admin',
          'claims',
          'customClaims',
          'roles',
        ]);
      });

      it('rejects privilege escalation parameters (isAdmin, is_admin, claims, customClaims, roles) with 403', () => {
        const escalationPayloads = [
          { isAdmin: true },
          { isAdmin: false },
          { is_admin: true },
          { claims: { admin: true } },
          { customClaims: { role: 'ADMIN' } },
          { roles: ['ADMIN'] },
        ];

        for (const extra of escalationPayloads) {
          const req = {
            body: {
              fullName: 'Valid User',
              email: 'valid@example.com',
              password: 'Password123!',
              ...extra,
            },
          } as unknown as Request;
          const res = createMockResponse();
          const next = vi.fn() as unknown as NextFunction;

          validateRegisterPayload(req, res as unknown as Response, next);
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(403);
          expect((res.body as { error: string }).error).toBe(
            'Public registration cannot grant administrative privileges.'
          );
        }
      });

      it('sanitizes and whitelists req.body to only fullName, email, and password', () => {
        const req = {
          body: {
            fullName: '  Jane Doe  ',
            email: '  Jane.Doe@Example.com  ',
            password: 'Password123!',
            role: 'PART',
            extraneousField: 'should_be_stripped',
            anotherMeta: 12345,
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledOnce();
        expect(req.body).toEqual({
          fullName: 'Jane Doe',
          email: 'jane.doe@example.com',
          password: 'Password123!',
        });
        expect((req.body as Record<string, unknown>).role).toBeUndefined();
        expect((req.body as Record<string, unknown>).extraneousField).toBeUndefined();
      });
    });

    describe('Types, whitespace, and multi-error aggregation', () => {
      it('does not trim password with leading or trailing spaces', () => {
        const req = {
          body: {
            fullName: 'User Name',
            email: 'user@example.com',
            password: '  Password123!  ',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledOnce();
        expect(req.body.password).toBe('  Password123!  ');
      });

      it('returns "Password is required." when password is a number', () => {
        const req = {
          body: {
            fullName: 'User Name',
            email: 'user@example.com',
            password: 12345678,
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect((res.body as { errors: Record<string, string> }).errors.password).toBe(
          'Password is required.'
        );
      });

      it('aggregates errors across all fields when all are invalid', () => {
        const req = {
          body: {
            fullName: '',
            email: 'invalid-email',
            password: 'weak',
          },
        } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateRegisterPayload(req, res as unknown as Response, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        const errors = (res.body as { errors: Record<string, string> }).errors;
        expect(errors.fullName).toBe('Full name is required.');
        expect(errors.email).toBe('Please provide a valid email address.');
        expect(errors.password).toContain('Password must be at least 8 characters long');
      });

      it('returns 400 with all three field errors if body is null or undefined', () => {
        for (const emptyBody of [null, undefined, 'not-an-object']) {
          const req = { body: emptyBody } as unknown as Request;
          const res = createMockResponse();
          const next = vi.fn() as unknown as NextFunction;

          validateRegisterPayload(req, res as unknown as Response, next);
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(400);
          const errors = (res.body as { errors: Record<string, string> }).errors;
          expect(errors.fullName).toBe('Full name is required.');
          expect(errors.email).toBe('Email address is required.');
          expect(errors.password).toBe('Password is required.');
        }
      });
    });
  });

  describe('validateResendVerificationPayload unit tests (FR-081 / NR-010)', () => {
    it('calls next() and normalizes valid email to lowercase trimmed string', () => {
      const req = {
        body: { email: '  Alice.Smith@Example.COM  ' },
      } as unknown as Request;
      const res = createMockResponse();
      const next = vi.fn() as unknown as NextFunction;

      validateResendVerificationPayload(req, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(200);
      expect((req.body as { email: string }).email).toBe('alice.smith@example.com');
    });

    it('returns 400 when body is null, undefined, or not an object', () => {
      for (const invalidBody of [null, undefined, 'not-object']) {
        const req = { body: invalidBody } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateResendVerificationPayload(req, res as unknown as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          error: 'Validation failed',
          errors: { email: 'Email address is required.' },
        });
      }
    });

    it('returns 400 when email is empty string or whitespace only', () => {
      for (const emptyEmail of ['', '   ']) {
        const req = { body: { email: emptyEmail } } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateResendVerificationPayload(req, res as unknown as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          error: 'Validation failed',
          errors: { email: 'Email address is required.' },
        });
      }
    });

    it('returns 400 when email is not a string', () => {
      const req = { body: { email: 12345 } } as unknown as Request;
      const res = createMockResponse();
      const next = vi.fn() as unknown as NextFunction;

      validateResendVerificationPayload(req, res as unknown as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Validation failed',
        errors: { email: 'Email address is required.' },
      });
    });

    it('returns 400 when email fails format regex or exceeds 255 chars', () => {
      const invalidEmails = [
        'plainaddress',
        '@missingusername.com',
        'username@.com',
        'username@domain',
        'a'.repeat(250) + '@example.com', // > 255 chars
      ];

      for (const email of invalidEmails) {
        const req = { body: { email } } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateResendVerificationPayload(req, res as unknown as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          error: 'Validation failed',
          errors: { email: 'Please provide a valid email address.' },
        });
      }
    });
  });

  describe('validateVerifyEmailPayload unit tests (US-001 AC 3 / NR-010)', () => {
    it('calls next() and trims valid oobCode', () => {
      const req = {
        body: { oobCode: '   action-code-12345   ' },
      } as unknown as Request;
      const res = createMockResponse();
      const next = vi.fn() as unknown as NextFunction;

      validateVerifyEmailPayload(req, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(200);
      expect((req.body as { oobCode: string }).oobCode).toBe('action-code-12345');
    });

    it('returns 400 when body is null, undefined, or not an object', () => {
      for (const invalidBody of [null, undefined, 'not-object']) {
        const req = { body: invalidBody } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateVerifyEmailPayload(req, res as unknown as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          error: 'Validation failed',
          errors: { oobCode: 'Action code is required.' },
        });
      }
    });

    it('returns 400 when oobCode is missing, empty, or whitespace only', () => {
      for (const emptyCode of ['', '   ', undefined, null]) {
        const req = { body: { oobCode: emptyCode } } as unknown as Request;
        const res = createMockResponse();
        const next = vi.fn() as unknown as NextFunction;

        validateVerifyEmailPayload(req, res as unknown as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          error: 'Validation failed',
          errors: { oobCode: 'Action code is required.' },
        });
      }
    });

    it('returns 400 when oobCode is not a string', () => {
      const req = { body: { oobCode: 123456 } } as unknown as Request;
      const res = createMockResponse();
      const next = vi.fn() as unknown as NextFunction;

      validateVerifyEmailPayload(req, res as unknown as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Validation failed',
        errors: { oobCode: 'Action code is required.' },
      });
    });
  });
});
