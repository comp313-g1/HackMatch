import { describe, it, expect } from 'vitest';
import { sanitizePayload } from './requestLogger.js';

describe('Sanitized Logging Middleware (NR-021)', () => {
  it('redacts sensitive fields such as password, token, and otp', () => {
    const rawPayload = {
      email: 'user@example.com',
      password: 'SuperSecretPassword123!',
      otp: '123456',
      token: 'jwt.sample.token',
      role: 'PART',
    };

    const sanitized = sanitizePayload(rawPayload) as Record<string, unknown>;

    expect(sanitized.email).toBe('user@example.com');
    expect(sanitized.role).toBe('PART');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.otp).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
  });

  it('redacts email verification secrets per Invariant L41 (oobCode, actionCode, verificationToken)', () => {
    const verificationPayload = {
      email: 'user@example.com',
      oobCode: 'secret-action-code-xyz',
      actionCode: 'action-code-12345',
      verificationToken: 'token-secret-789',
    };

    const sanitized = sanitizePayload(verificationPayload) as Record<string, unknown>;

    expect(sanitized.email).toBe('user@example.com');
    expect(sanitized.oobCode).toBe('[REDACTED]');
    expect(sanitized.actionCode).toBe('[REDACTED]');
    expect(sanitized.verificationToken).toBe('[REDACTED]');
  });

  it('redacts nested objects and arrays with sensitive keys', () => {
    const nestedPayload = {
      user: {
        id: '123',
        secret: 'confidential',
      },
      items: [
        { name: 'item1', cookie: 'session_id_val' },
        { name: 'item2', authorization: 'Bearer xyz' },
      ],
    };

    const sanitized = sanitizePayload(nestedPayload) as {
      user: { id: string; secret: string };
      items: Array<{ name: string; cookie?: string; authorization?: string }>;
    };

    expect(sanitized.user.id).toBe('123');
    expect(sanitized.user.secret).toBe('[REDACTED]');
    expect(sanitized.items[0].cookie).toBe('[REDACTED]');
    expect(sanitized.items[1].authorization).toBe('[REDACTED]');
  });

  it('returns primitives unchanged', () => {
    expect(sanitizePayload(null)).toBeNull();
    expect(sanitizePayload(undefined)).toBeUndefined();
    expect(sanitizePayload(42)).toBe(42);
    expect(sanitizePayload('hello')).toBe('hello');
  });
});
