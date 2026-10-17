import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PasswordResetForm } from './PasswordResetForm';
import {
  completePasswordReset,
  validatePasswordResetLink,
} from './passwordResetConfirm';
import { PASSWORD_POLICY_MESSAGE } from './validation';

vi.mock('./passwordResetConfirm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./passwordResetConfirm')>();
  return {
    ...actual,
    validatePasswordResetLink: vi.fn(),
    completePasswordReset: vi.fn(),
  };
});

const mockValidateLink = vi.mocked(validatePasswordResetLink);
const mockComplete = vi.mocked(completePasswordReset);

describe('PasswordResetForm (US-005 S1-P1-14 / S1-P2-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
    mockValidateLink.mockResolvedValue({
      state: 'valid',
      email: 'jane@example.com',
      accountType: 'credential',
    });
    mockComplete.mockResolvedValue({
      signedIn: false,
      sessionIssued: false,
      requiresMfa: true,
    });
  });

  it('empty: missing oobCode shows reset-link required state', async () => {
    render(<PasswordResetForm actionCode={null} mode="resetPassword" />);

    expect(await screen.findByRole('heading', { name: /reset link required/i })).toBeInTheDocument();
    expect(mockValidateLink).not.toHaveBeenCalled();
  });

  it('ready: valid link shows email and password policy fields', async () => {
    render(<PasswordResetForm actionCode="valid-oob" mode="resetPassword" />);

    expect(await screen.findByText(/resetting password for/i)).toHaveTextContent('jane@example.com');
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
  });

  it('validation: weak password keeps typed values', async () => {
    render(<PasswordResetForm actionCode="valid-oob" mode="resetPassword" />);
    await screen.findByLabelText(/^new password$/i);

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'weak' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'weak' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(PASSWORD_POLICY_MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('weak');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('success: confirms password and shows sign-in CTA', async () => {
    const onNavigateToSignIn = vi.fn();
    render(
      <PasswordResetForm
        actionCode="valid-oob"
        mode="resetPassword"
        onNavigateToSignIn={onNavigateToSignIn}
      />
    );
    await screen.findByLabelText(/^new password$/i);

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'Valid1@Password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'Valid1@Password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/password updated/i);
    fireEvent.click(screen.getByRole('button', { name: /continue to sign in/i }));
    expect(onNavigateToSignIn).toHaveBeenCalled();
  });

  it('expired state: distinct heading and recover CTA', async () => {
    mockValidateLink.mockRejectedValueOnce(
      Object.assign(new Error('expired'), {
        kind: 'expired',
        code: 'EXPIRED_ACTION_CODE',
        message: 'This password reset link has expired. Please request a new link to continue.',
      })
    );
    const onNavigateToRecover = vi.fn();
    render(
      <PasswordResetForm
        actionCode="expired-oob"
        mode="resetPassword"
        onNavigateToRecover={onNavigateToRecover}
      />
    );

    expect(await screen.findByRole('heading', { name: /reset link expired/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /request a new reset link/i }));
    expect(onNavigateToRecover).toHaveBeenCalled();
  });

  it('invalid state: distinct tampered-link messaging', async () => {
    mockValidateLink.mockRejectedValueOnce(
      Object.assign(new Error('bad'), {
        kind: 'invalid',
        code: 'INVALID_ACTION_CODE',
        message: 'This password reset link is invalid or has been tampered with.',
      })
    );
    render(<PasswordResetForm actionCode="bad-oob" mode="resetPassword" />);

    expect(await screen.findByRole('heading', { name: /reset link invalid/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/tampered/i);
  });

  it('used state: already-used messaging', async () => {
    mockValidateLink.mockRejectedValueOnce(
      Object.assign(new Error('used'), {
        kind: 'used',
        code: 'USED_ACTION_CODE',
        message: 'This password reset link has already been used.',
      })
    );
    render(<PasswordResetForm actionCode="used-oob" mode="resetPassword" />);

    expect(
      await screen.findByRole('heading', { name: /reset link already used/i })
    ).toBeInTheDocument();
  });

  it('oauth recovery state: provider guidance without password form', async () => {
    mockValidateLink.mockRejectedValueOnce(
      Object.assign(new Error('oauth'), {
        kind: 'oauth',
        code: 'OAUTH_RECOVERY_REQUIRED',
        message: 'This account signs in with Google or GitHub.',
      })
    );
    const onNavigateToSignIn = vi.fn();
    render(
      <PasswordResetForm
        actionCode="oauth-oob"
        mode="resetPassword"
        onNavigateToSignIn={onNavigateToSignIn}
      />
    );

    expect(await screen.findByRole('heading', { name: /use your sign-in provider/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign in with google or github/i }));
    expect(onNavigateToSignIn).toHaveBeenCalled();
  });

  it('scrubs oobCode from the address bar after reading it', async () => {
    window.history.pushState({}, '', '/?mode=resetPassword&oobCode=secret-token-99');
    render(<PasswordResetForm />);

    await waitFor(() => {
      expect(window.location.search).not.toContain('oobCode=secret-token-99');
    });
    expect(mockValidateLink).toHaveBeenCalledWith('secret-token-99');
  });
});
