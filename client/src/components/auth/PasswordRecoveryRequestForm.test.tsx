import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordRecoveryRequestForm } from './PasswordRecoveryRequestForm';
import {
  GENERIC_PASSWORD_RECOVERY_CONFIRMATION,
  requestPasswordReset,
} from './passwordRecoveryRequest';

vi.mock('./passwordRecoveryRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./passwordRecoveryRequest')>();
  return {
    ...actual,
    requestPasswordReset: vi.fn(),
  };
});

const mockRequest = vi.mocked(requestPasswordReset);

const fillEmail = (value: string) => {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value } });
};

describe('PasswordRecoveryRequestForm (US-005 S1-P1-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue(undefined);
  });

  it('empty: shows email field, hint, and send button', () => {
    render(<PasswordRecoveryRequestForm />);

    expect(screen.getByRole('heading', { level: 2, name: /reset password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    expect(screen.getByText(/enter the email you use to sign in/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeEnabled();
  });

  it('validation: empty submit shows field error and preserves empty field', async () => {
    render(<PasswordRecoveryRequestForm />);

    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/email address is required/i);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('validation: invalid email keeps the typed value', async () => {
    render(<PasswordRecoveryRequestForm />);

    fillEmail('not-an-email');
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(screen.getByLabelText(/email address/i)).toHaveValue('not-an-email');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('loading: disables controls and shows Sending…', async () => {
    let resolveRequest: () => void = () => {};
    mockRequest.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRequest = resolve;
      })
    );
    render(<PasswordRecoveryRequestForm />);

    fillEmail('jane@example.com');
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    const busy = await screen.findByRole('button', { name: /sending/i });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText(/email address/i)).toBeDisabled();

    resolveRequest();
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('success: shows the same generic confirmation for any submitted address', async () => {
    render(<PasswordRecoveryRequestForm />);

    fillEmail('jane@example.com');
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/check your email/i);
    expect(status).toHaveTextContent(GENERIC_PASSWORD_RECOVERY_CONFIRMATION);
    expect(status).toHaveTextContent('jane@example.com');
    expect(mockRequest).toHaveBeenCalledWith('jane@example.com');
  });

  it('success: unknown address still shows generic confirmation (enumeration-safe)', async () => {
    // Helper already maps user-not-found → resolve; form only sees success.
    mockRequest.mockResolvedValueOnce(undefined);
    render(<PasswordRecoveryRequestForm />);

    fillEmail('unknown@example.com');
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(GENERIC_PASSWORD_RECOVERY_CONFIRMATION);
  });

  it('error: network failure keeps email and offers try again', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('Network error. Please check your internet connection and try again.'), {
        kind: 'network',
        code: 'auth/network-request-failed',
      })
    );
    render(<PasswordRecoveryRequestForm />);

    fillEmail('jane@example.com');
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(screen.getByLabelText(/email address/i)).toHaveValue('jane@example.com');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('navigates back to sign in from success and from the form link', async () => {
    const onNavigateToSignIn = vi.fn();
    render(<PasswordRecoveryRequestForm onNavigateToSignIn={onNavigateToSignIn} />);

    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(onNavigateToSignIn).toHaveBeenCalledTimes(1);

    fillEmail('jane@example.com');
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    fireEvent.click(await screen.findByRole('button', { name: /back to sign in/i }));
    expect(onNavigateToSignIn).toHaveBeenCalledTimes(2);
  });

  it('prefills initialEmail from sign-in hand-off', () => {
    render(<PasswordRecoveryRequestForm initialEmail="prefill@example.com" />);
    expect(screen.getByLabelText(/email address/i)).toHaveValue('prefill@example.com');
  });
});
