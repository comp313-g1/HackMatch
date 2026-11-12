import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { sanitizePayload } from './requestLogger.js';

/**
 * US-029 / #270 log-redaction regressions. Route-level tests run the real
 * Express stack (request logger + central error handler) with console spies;
 * NODE_ENV is switched off "test" only so the request logger actually writes.
 */

const SECRETS = {
  password: 'Primary-Pass-1!',
  newPassword: 'New-Primary-Pass-2!',
  confirmPassword: 'New-Primary-Pass-2!',
  totpCode: '482913',
  manualEntryKey: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/HackMatch%3AHackMatch%20account?secret=JBSWY3DPEHPK3PXP&issuer=HackMatch',
  recoveryCode: 'K7QM-2XHD-PW9C',
};

function captureConsole() {
  const lines: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => {
            if (arg instanceof Error) {
              // Mirror what Node prints for an Error: stack plus own enumerable props.
              return `${arg.stack ?? arg.message} ${JSON.stringify({ ...arg })}`;
            }
            return typeof arg === 'string' ? arg : JSON.stringify(arg);
          })
          .join(' ')
      );
    })
  );
  return { text: () => lines.join('\n'), restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

describe('sanitizePayload covers every US-029/auth secret field (unit)', () => {
  it('redacts password variants used by registration, reset, and reauthentication', () => {
    const sanitized = sanitizePayload({
      password: SECRETS.password,
      newPassword: SECRETS.newPassword,
      confirmPassword: SECRETS.confirmPassword,
      currentPassword: SECRETS.password,
      email: 'owner@example.com',
    });
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain(SECRETS.password);
    expect(text).not.toContain(SECRETS.newPassword);
    expect(sanitized).toMatchObject({
      email: 'owner@example.com',
      newPassword: '[REDACTED]',
      confirmPassword: '[REDACTED]',
      currentPassword: '[REDACTED]',
    });
  });

  it('redacts authenticator setup, TOTP, recovery, and storage material by key', () => {
    const sanitized = sanitizePayload({
      enrollmentId: 'enrollment_1234',
      code: SECRETS.totpCode,
      authenticatorCode: SECRETS.totpCode,
      setup: { otpauthUri: SECRETS.otpauthUri, manualEntryKey: SECRETS.manualEntryKey },
      recoveryCodes: { codes: [SECRETS.recoveryCode], batchId: 'batch-1' },
      recoveryCode: SECRETS.recoveryCode,
      secret_ciphertext: 'Y2lwaGVydGV4dA==',
      secret_iv: 'aXY=',
      secret_auth_tag: 'dGFn',
      encryption_key_version: 'v1',
      code_verifier: 'v'.repeat(43),
      idToken: 'header.payload.sig',
      Authorization: 'Bearer header.payload.sig',
    }) as Record<string, unknown>;
    const text = JSON.stringify(sanitized);
    for (const secret of [
      SECRETS.totpCode,
      SECRETS.otpauthUri,
      SECRETS.manualEntryKey,
      SECRETS.recoveryCode,
      'Y2lwaGVydGV4dA==',
      'aXY=',
      'dGFn',
      'v'.repeat(43),
      'header.payload.sig',
    ]) {
      expect(text).not.toContain(secret);
    }
    // Non-secret correlation context is preserved.
    expect(sanitized.enrollmentId).toBe('enrollment_1234');
  });

  it('redacts otpauth URIs by value even under an unexpected key', () => {
    const sanitized = sanitizePayload({ note: SECRETS.otpauthUri, list: [SECRETS.otpauthUri] });
    expect(JSON.stringify(sanitized)).not.toContain('otpauth://');
  });

  it('keeps ordinary operational fields readable', () => {
    expect(sanitizePayload({ role: 'PART', status: 'pending', count: 3, expectedBatchId: null })).toEqual({
      role: 'PART',
      status: 'pending',
      count: 3,
      expectedBatchId: null,
    });
  });
});

describe('request logging and error handling never write secrets (route, real Express stack)', () => {
  let originalEnv: string | undefined;
  let consoleCapture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    consoleCapture = captureConsole();
  });

  afterEach(() => {
    consoleCapture.restore();
    process.env.NODE_ENV = originalEnv;
  });

  it('does not log new/confirm passwords from the password-reset confirmation body', async () => {
    await request(app).post('/api/auth/password-reset/confirm').send({
      oobCode: 'reset-oob-code-123',
      newPassword: SECRETS.newPassword,
      confirmPassword: SECRETS.confirmPassword,
    });
    const logs = consoleCapture.text();
    expect(logs).toContain('/api/auth/password-reset/confirm');
    expect(logs).not.toContain(SECRETS.newPassword);
    expect(logs).not.toContain('reset-oob-code-123');
  });

  it('does not log the TOTP confirmation code or an otpauth URI sent to authenticator routes', async () => {
    await request(app)
      .post('/api/auth/mfa/authenticator/enrollment/confirm')
      .send({ enrollmentId: 'enrollment_1234', code: SECRETS.totpCode, note: SECRETS.otpauthUri });
    const logs = consoleCapture.text();
    expect(logs).toContain('/api/auth/mfa/authenticator/enrollment/confirm');
    expect(logs).not.toContain(SECRETS.totpCode);
    expect(logs).not.toContain('otpauth://');
  });

  it('does not log secrets placed in the query string via the logged path', async () => {
    await request(app).get(
      `/api/auth/mfa/authenticator/recovery-codes?code=${SECRETS.totpCode}&recoveryCode=${SECRETS.recoveryCode}`
    );
    const logs = consoleCapture.text();
    expect(logs).toContain('/api/auth/mfa/authenticator/recovery-codes');
    expect(logs).not.toContain(SECRETS.totpCode);
    expect(logs).not.toContain(SECRETS.recoveryCode);
  });

  it('does not log or echo the raw body of a malformed JSON request', async () => {
    const raw = `{"code":"${SECRETS.totpCode}","password":"${SECRETS.password}",`;
    const response = await request(app)
      .post('/api/auth/mfa/authenticator/enrollment/confirm')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain(SECRETS.totpCode);
    expect(JSON.stringify(response.body)).not.toContain(SECRETS.password);
    const logs = consoleCapture.text();
    expect(logs).toContain('[SERVER ERROR]');
    expect(logs).not.toContain(SECRETS.totpCode);
    expect(logs).not.toContain(SECRETS.password);
  });

  it('never logs the bearer token', async () => {
    await request(app)
      .get('/api/auth/mfa/authenticator/enrollment')
      .set('Authorization', 'Bearer header.secret-token-payload.sig');
    expect(consoleCapture.text()).not.toContain('secret-token-payload');
  });
});
