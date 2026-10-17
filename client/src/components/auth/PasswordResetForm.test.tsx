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

describe('PasswordResetForm (US-005 S1-P1-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
    mockValidateLink.mockResolvedValue('jane@example.com');
    mockComplete.mockResolvedValue(undefined);
  });

  it('empty: missing oobCode shows reset-link required state', async () => {
    render(<PasswordResetForm actionCode={null} mode="resetPassword" />);

    expect(await screen.findByRole('heading', { name: /reset link required/i })).toBeInTheDocument();
    expect(screen.getByText(/open the password reset link from your email/i)).toBeInTheDocument();
    expect(mockValidateLink).not.toHaveBeenCalled();
  });

  it('loading: shows validating message while the link is checked', async () => {
    let resolveValidate: (email: string) => void = () => {};
    mockValidateLink.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveValidate = resolve;
      })
    );

    render(<PasswordResetForm actionCode="pending-oob" mode="resetPassword" />);

    expect(screen.getByRole('status')).toHaveTextContent(/checking reset link/i);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');

    resolveValidate('jane@example.com');
    expect(await screen.findByLabelText(/^new password$/i)).toBeInTheDocument();
  });

  it('ready: valid link shows email and password policy fields', async () => {
    render(<PasswordResetForm actionCode="valid-oob" mode="resetPassword" />);

    expect(await screen.findByText(/resetting password for/i)).toHaveTextContent('jane@example.com');
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('');
    expect(screen.getByText(/must be at least 8 characters/i)).toBeInTheDocument();
    expect(mockValidateLink).toHaveBeenCalledWith('valid-oob');
  });

  it('validation: weak password keeps typed values and shows field error', async () => {
    render(<PasswordResetForm actionCode="valid-oob" mode="resetPassword" />);
    await screen.findByLabelText(/^new password$/i);

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'weak' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'weak' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(PASSWORD_POLICY_MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('weak');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('weak');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('validation: mismatched confirm keeps values', async () => {
    render(<PasswordResetForm actionCode="valid-oob" mode="resetPassword" />);
    await screen.findByLabelText(/^new password$/i);

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'Valid1@Password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'Valid1@Other' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('Valid1@Password');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('Valid1@Other');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('success: confirms password and shows sign-in CTA without auto-login', async () => {
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
    expect(screen.getByText(/sign in with your new password/i)).toBeInTheDocument();
    expect(mockComplete).toHaveBeenCalledWith('valid-oob', 'Valid1@Password');

    fireEvent.click(screen.getByRole('button', { name: /continue to sign in/i }));
    expect(onNavigateToSignIn).toHaveBeenCalledTimes(1);
  });

  it('error: expired link shows request-new-link actions', async () => {
    mockValidateLink.mockRejectedValueOnce(
      Object.assign(new Error('expired'), {
        kind: 'expired',
        code: 'auth/expired-action-code',
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/has expired/i);
    fireEvent.click(screen.getByRole('button', { name: /request a new reset link/i }));
    expect(onNavigateToRecover).toHaveBeenCalledTimes(1);
  });

  it('error: network failure on submit preserves passwords', async () => {
    mockComplete.mockRejectedValueOnce(
      Object.assign(new Error('net'), {
        kind: 'network',
        code: 'auth/network-request-failed',
        message: 'Network error. Please check your internet connection and try again.',
      })
    );
    render(<PasswordResetForm actionCode="valid-oob" mode="resetPassword" />);
    await screen.findByLabelText(/^new password$/i);

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'Valid1@Password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'Valid1@Password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('Valid1@Password');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('Valid1@Password');
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
