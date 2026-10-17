import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPasswordResetEmail } from 'firebase/auth';
import {
  GENERIC_PASSWORD_RECOVERY_CONFIRMATION,
  describePasswordRecoveryRequestError,
  requestPasswordReset,
} from './passwordRecoveryRequest';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    sendPasswordResetEmail: vi.fn(),
  };
});

const mockSend = vi.mocked(sendPasswordResetEmail);

describe('passwordRecoveryRequest (US-005 AC 1–2 / FR-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a single generic confirmation string for known and unknown addresses', () => {
    expect(GENERIC_PASSWORD_RECOVERY_CONFIRMATION).toMatch(/if an account exists/i);
    expect(GENERIC_PASSWORD_RECOVERY_CONFIRMATION).toMatch(/google or github/i);
  });

  it('happy path: calls Firebase sendPasswordResetEmail with normalized email', async () => {
    mockSend.mockResolvedValueOnce(undefined);

    await requestPasswordReset('  Jane@Example.com ');

    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      'jane@example.com',
      expect.objectContaining({
        url: expect.stringContaining('mode=resetPassword'),
        handleCodeInApp: false,
      })
    );
  });

  it('unknown address: auth/user-not-found is treated as success (generic confirmation)', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { code: 'auth/user-not-found' })
    );

    await expect(requestPasswordReset('ghost@example.com')).resolves.toBeUndefined();
  });

  it('maps network and throttle failures for the error state', () => {
    expect(
      describePasswordRecoveryRequestError(
        Object.assign(new Error('net'), { code: 'auth/network-request-failed' })
      ).kind
    ).toBe('network');
    expect(
      describePasswordRecoveryRequestError(
        Object.assign(new Error('limit'), { code: 'auth/too-many-requests' })
      ).kind
    ).toBe('throttled');
  });

  it('rethrows non-enumeration failures from requestPasswordReset', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('net'), { code: 'auth/network-request-failed' })
    );

    await expect(requestPasswordReset('jane@example.com')).rejects.toMatchObject({
      kind: 'network',
      code: 'auth/network-request-failed',
    });
  });
});
