import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import {
  completePasswordReset,
  describePasswordResetLinkError,
  validatePasswordResetLink,
} from './passwordResetConfirm';
import { PASSWORD_POLICY_MESSAGE } from './validation';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    verifyPasswordResetCode: vi.fn(),
    confirmPasswordReset: vi.fn(),
  };
});

const mockVerify = vi.mocked(verifyPasswordResetCode);
const mockConfirm = vi.mocked(confirmPasswordReset);

describe('passwordResetConfirm (US-005 AC 2–3 / FR-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validatePasswordResetLink returns email from Firebase', async () => {
    mockVerify.mockResolvedValueOnce('jane@example.com');
    await expect(validatePasswordResetLink('  valid-oob  ')).resolves.toBe('jane@example.com');
    expect(mockVerify).toHaveBeenCalledWith(expect.anything(), 'valid-oob');
  });

  it('maps expired and invalid action codes', () => {
    expect(
      describePasswordResetLinkError(
        Object.assign(new Error('expired'), { code: 'auth/expired-action-code' })
      ).kind
    ).toBe('expired');
    expect(
      describePasswordResetLinkError(
        Object.assign(new Error('used'), { code: 'auth/invalid-action-code' })
      ).kind
    ).toBe('invalid');
  });

  it('validatePasswordResetLink rejects expired codes', async () => {
    mockVerify.mockRejectedValueOnce(
      Object.assign(new Error('expired'), { code: 'auth/expired-action-code' })
    );
    await expect(validatePasswordResetLink('stale')).rejects.toMatchObject({
      kind: 'expired',
      code: 'auth/expired-action-code',
    });
  });

  it('completePasswordReset enforces policy before calling Firebase', async () => {
    await expect(completePasswordReset('oob', 'weak')).rejects.toMatchObject({
      kind: 'weak_password',
      message: PASSWORD_POLICY_MESSAGE,
    });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('completePasswordReset confirms a policy-compliant password', async () => {
    mockConfirm.mockResolvedValueOnce(undefined);
    await completePasswordReset('oob-code', 'Valid1@Password');
    expect(mockConfirm).toHaveBeenCalledWith(expect.anything(), 'oob-code', 'Valid1@Password');
  });

  it('completePasswordReset maps already-used codes after submit', async () => {
    mockConfirm.mockRejectedValueOnce(
      Object.assign(new Error('used'), { code: 'auth/invalid-action-code' })
    );
    await expect(completePasswordReset('oob', 'Valid1@Password')).rejects.toMatchObject({
      kind: 'invalid',
    });
  });
});
