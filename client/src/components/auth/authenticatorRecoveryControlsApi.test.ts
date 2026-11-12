import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../../config/authFetch';
import {
  AuthenticatorEnrollmentApiError,
  beginAuthenticatorReplacement,
  confirmAuthenticatorReplacement,
  disableAuthenticator,
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  parseGeneratedRecoveryCodes,
  parseRecoveryCodeStatus,
} from './authenticatorEnrollmentApi';

vi.mock('../../config/authFetch', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/authFetch')>();
  return { ...original, authFetch: vi.fn() };
});

const BATCH = '30000000-0000-4000-8000-00000000000a';
const CODES = Array.from({ length: 10 }, (_, index) => `ABCD-EFGH-JK${'MNPQRSTUVW'[index]}${index + 2 > 9 ? 9 : index + 2}`);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const replacementResponse = {
  authenticator: {
    status: 'pending',
    enrollmentId: 'replacement_123',
    expiresAt: '2026-11-11T18:10:00.000Z',
    issuer: 'HackMatch',
    accountLabel: 'HackMatch account',
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
  },
  setup: {
    otpauthUri: 'otpauth://totp/HackMatch%3Aaccount?secret=NEWDEVICE&issuer=HackMatch',
    manualEntryKey: 'NEWDEVICE',
  },
  currentAuthenticator: { status: 'active' },
  availableChallengeMethods: ['authenticator_totp', 'email_otp'],
  emailOtpFallback: true,
};

const generatedResponse = {
  recoveryCodes: {
    status: 'generated',
    batchId: BATCH,
    total: 10,
    remaining: 10,
    generatedAt: '2026-11-11T18:20:00.000Z',
    codes: CODES,
  },
};

describe('authenticator recovery-control API client (US-029 / #269)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts an owner-only replacement request and keeps the current factor active', async () => {
    vi.mocked(authFetch).mockResolvedValue(json(replacementResponse, 201));
    const result = await beginAuthenticatorReplacement();
    expect(authFetch).toHaveBeenCalledWith('/api/auth/mfa/authenticator/replacement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(result.currentAuthenticator).toEqual({ status: 'active' });
    expect(result.setup.manualEntryKey).toBe('NEWDEVICE');
    expect(result.availableChallengeMethods).toEqual(['authenticator_totp', 'email_otp']);
  });

  it('confirms a replacement through its own endpoint and validates the fresh code set', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({
        authenticator: { status: 'active', activatedAt: '2026-11-11T18:40:00.000Z' },
        ...generatedResponse,
        availableChallengeMethods: ['authenticator_totp', 'email_otp'],
        emailOtpFallback: true,
      })
    );
    const result = await confirmAuthenticatorReplacement('replacement_123', '123456');
    expect(authFetch).toHaveBeenCalledWith('/api/auth/mfa/authenticator/replacement/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentId: 'replacement_123', code: '123456' }),
    });
    expect(result.authenticator).toEqual({ status: 'active', activatedAt: '2026-11-11T18:40:00.000Z' });
    expect(result.recoveryCodes.codes).toEqual(CODES);
    expect(result.emailOtpFallback).toBe(true);

    // A success without a fresh set is not accepted as a completed replacement.
    vi.mocked(authFetch).mockResolvedValue(
      json({
        authenticator: { status: 'active', activatedAt: '2026-11-11T18:40:00.000Z' },
        availableChallengeMethods: ['authenticator_totp', 'email_otp'],
        emailOtpFallback: true,
      })
    );
    await expect(confirmAuthenticatorReplacement('replacement_123', '123456')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a replacement response that claims the old factor is gone', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({ ...replacementResponse, currentAuthenticator: { status: 'retired' } }, 201)
    );
    await expect(beginAuthenticatorReplacement()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('disables and requires email OTP to remain the fallback', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({
        authenticator: { status: 'not_enrolled' },
        disabledAt: '2026-11-11T18:30:00.000Z',
        recoveryCodes: { status: 'not_generated', total: 0, remaining: 0 },
        availableChallengeMethods: ['email_otp'],
        emailOtpFallback: true,
      })
    );
    await expect(disableAuthenticator()).resolves.toMatchObject({
      authenticator: { status: 'not_enrolled' },
      emailOtpFallback: true,
    });
    expect(authFetch).toHaveBeenCalledWith('/api/auth/mfa/authenticator/disable', expect.objectContaining({ method: 'POST', body: '{}' }));

    vi.mocked(authFetch).mockResolvedValue(
      json({
        authenticator: { status: 'not_enrolled' },
        disabledAt: '2026-11-11T18:30:00.000Z',
        availableChallengeMethods: [],
        emailOtpFallback: false,
      })
    );
    await expect(disableAuthenticator()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('sends only the expected batch id when generating and returns validated codes', async () => {
    vi.mocked(authFetch).mockResolvedValue(json(generatedResponse, 201));
    const result = await generateRecoveryCodes(null);
    expect(authFetch).toHaveBeenCalledWith('/api/auth/mfa/authenticator/recovery-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedBatchId: null }),
    });
    expect(result.codes).toEqual(CODES);
    expect(result.total).toBe(10);
  });

  it('rejects malformed, duplicated, or mismatched generated code sets', () => {
    const base = generatedResponse.recoveryCodes;
    expect(() => parseGeneratedRecoveryCodes({ recoveryCodes: { ...base, codes: ['lowercase-code'] , total: 1, remaining: 1 } })).toThrow(AuthenticatorEnrollmentApiError);
    expect(() => parseGeneratedRecoveryCodes({ recoveryCodes: { ...base, codes: [CODES[0], CODES[0]], total: 2, remaining: 2 } })).toThrow(AuthenticatorEnrollmentApiError);
    expect(() => parseGeneratedRecoveryCodes({ recoveryCodes: { ...base, total: 9 } })).toThrow(AuthenticatorEnrollmentApiError);
  });

  it('projects status without ever carrying raw codes', async () => {
    vi.mocked(authFetch).mockResolvedValue(json(generatedResponse));
    const status = await getRecoveryCodeStatus();
    expect(status).toEqual({
      status: 'generated',
      batchId: BATCH,
      total: 10,
      remaining: 10,
      generatedAt: '2026-11-11T18:20:00.000Z',
    });
    expect(JSON.stringify(status)).not.toContain('ABCD');
    expect(parseRecoveryCodeStatus({ recoveryCodes: { status: 'not_generated' } })).toEqual({
      status: 'not_generated',
      total: 0,
      remaining: 0,
    });
  });

  it('#270: never surfaces server internals (stack, SQL, raw network errors) to the UI', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      json(
        {
          error: 'Internal Server Error',
          message: 'relation "authenticator_recovery_codes" violates constraint',
          stack: 'Error: at replace_authenticator_recovery_codes (db.ts:12)',
          code_verifier: 'v'.repeat(43),
        },
        500
      )
    );
    const serverFailure = await generateRecoveryCodes(null).catch((error) => error);
    expect(serverFailure).toBeInstanceOf(AuthenticatorEnrollmentApiError);
    expect(serverFailure.message).toBe('Internal Server Error');
    expect(JSON.stringify({ ...serverFailure, message: serverFailure.message })).not.toMatch(
      /relation|constraint|stack|db\.ts|verifier|vvvv/
    );

    vi.mocked(authFetch).mockResolvedValueOnce(
      new Response('<html>502 upstream SELECT * FROM authenticator_enrollments</html>', { status: 502 })
    );
    const htmlFailure = await getRecoveryCodeStatus().catch((error) => error);
    expect(htmlFailure.message).toBe('Request failed with status 502.');

    vi.mocked(authFetch).mockRejectedValueOnce(new TypeError('fetch failed: ECONNRESET 10.0.0.5:5432'));
    const networkFailure = await disableAuthenticator().catch((error) => error);
    expect(networkFailure).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(networkFailure.message).not.toMatch(/ECONNRESET|10\.0\.0\.5|5432/);
  });

  it('#270: sends recovery and authenticator requests without secrets in the URL', async () => {
    vi.mocked(authFetch).mockResolvedValue(json(generatedResponse, 201));
    await generateRecoveryCodes(BATCH);
    const [url, init] = vi.mocked(authFetch).mock.calls[0]!;
    expect(url).toBe('/api/auth/mfa/authenticator/recovery-codes');
    expect(String(url)).not.toMatch(/[?#]|ABCD/);
    // The batch id travels only in the JSON body.
    expect(init?.body).toBe(JSON.stringify({ expectedBatchId: BATCH }));
  });

  it('surfaces the server reauthentication contract as a typed error', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({ error: 'Recent reauthentication is required.', code: 'REAUTHENTICATION_REQUIRED' }, 401)
    );
    await expect(generateRecoveryCodes(BATCH)).rejects.toMatchObject({
      status: 401,
      code: 'REAUTHENTICATION_REQUIRED',
    });
  });
});
