/**
 * US-003 login integration tests (React).
 *
 * Covers the password login UI path end-to-end with Firebase + account-status mocked:
 * happy path (T1 precursor), generic credential errors (T2), suspended block (T4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { signInWithEmailAndPassword, type UserCredential } from 'firebase/auth';
import { LoginForm } from './LoginForm';
import {
  GENERIC_CREDENTIALS_ERROR,
  ACCOUNT_SUSPENDED_ERROR,
  describeLoginError,
} from './loginErrors';
import { assertAccountActive } from './accountStatus';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    signInWithEmailAndPassword: vi.fn(),
  };
});

vi.mock('./accountStatus', () => ({
  assertAccountActive: vi.fn(),
}));

const mockSignIn = vi.mocked(signInWithEmailAndPassword);
const mockAssertAccountActive = vi.mocked(assertAccountActive);

const firebaseError = (code: string) => Object.assign(new Error(code), { code });

const fillAndSubmit = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
};

describe('US-003 login integration (LoginForm + account status)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccountActive.mockResolvedValue(undefined);
  });

  describe('US-003-T1 precursor: valid credentials + active account', () => {
    it('accepts the password, checks account status, and shows the next-step panel', async () => {
      const user = { uid: 'u1', email: 'jane@example.com' };
      mockSignIn.mockResolvedValueOnce({ user } as UserCredential);
      const onPrimaryAuthSuccess = vi.fn();

      render(<LoginForm onPrimaryAuthSuccess={onPrimaryAuthSuccess} />);
      fillAndSubmit('jane@example.com', 'Valid1@Password');

      expect(await screen.findByRole('status')).toHaveTextContent(/password accepted/i);
      expect(mockAssertAccountActive).toHaveBeenCalledWith(user);
      expect(onPrimaryAuthSuccess).toHaveBeenCalledWith({
        email: 'jane@example.com',
        user,
      });
    });
  });

  describe('US-003-T2: incorrect password shows a generic error', () => {
    it.each([
      'auth/wrong-password',
      'auth/user-not-found',
      'auth/invalid-credential',
      'auth/invalid-login-credentials',
    ])('maps %s to the same generic message without revealing account existence', async (code) => {
      mockSignIn.mockRejectedValueOnce(firebaseError(code));
      render(<LoginForm />);

      fillAndSubmit('jane@example.com', 'wrong-pass');

      expect(await screen.findByText(GENERIC_CREDENTIALS_ERROR)).toBeInTheDocument();
      expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/no user/i)).not.toBeInTheDocument();
      expect(mockAssertAccountActive).not.toHaveBeenCalled();
      expect(describeLoginError({ code }).message).toBe(GENERIC_CREDENTIALS_ERROR);
    });

    it('shows retry guidance when Firebase throttles attempts', async () => {
      mockSignIn.mockRejectedValueOnce(firebaseError('auth/too-many-requests'));
      render(<LoginForm />);

      fillAndSubmit('jane@example.com', 'wrong-pass');

      expect(await screen.findByText(/too many unsuccessful sign-in attempts/i)).toBeInTheDocument();
    });

    it('rejects empty submit with field errors and never calls Firebase', async () => {
      render(<LoginForm />);
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

      expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  describe('US-003-T4: suspended account is blocked after password acceptance', () => {
    it('shows the suspended message and never opens the success panel', async () => {
      const user = { uid: 'u1', email: 'jane@example.com' };
      mockSignIn.mockResolvedValueOnce({ user } as UserCredential);
      mockAssertAccountActive.mockRejectedValueOnce(
        Object.assign(new Error('ACCOUNT_SUSPENDED'), { code: 'ACCOUNT_SUSPENDED' })
      );
      const onPrimaryAuthSuccess = vi.fn();

      render(<LoginForm onPrimaryAuthSuccess={onPrimaryAuthSuccess} />);
      fillAndSubmit('jane@example.com', 'Valid1@Password');

      expect(await screen.findByText(ACCOUNT_SUSPENDED_ERROR)).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(onPrimaryAuthSuccess).not.toHaveBeenCalled();
    });

    it('shows the disabled message when Firebase has disabled the user', async () => {
      mockSignIn.mockRejectedValueOnce(firebaseError('auth/user-disabled'));
      render(<LoginForm />);

      fillAndSubmit('jane@example.com', 'Valid1@Password');

      expect(await screen.findByText(/cannot sign in right now/i)).toBeInTheDocument();
      await waitFor(() => expect(mockAssertAccountActive).not.toHaveBeenCalled());
    });
  });

  describe('Failure handling', () => {
    it('shows a network error and keeps the email', async () => {
      mockSignIn.mockRejectedValueOnce(firebaseError('auth/network-request-failed'));
      render(<LoginForm />);

      fillAndSubmit('jane@example.com', 'Valid1@Password');

      expect(await screen.findByText(/network error/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toHaveValue('jane@example.com');
    });

    it('blocks double submit while signing in', async () => {
      let resolveSignIn: (value: UserCredential) => void = () => {};
      mockSignIn.mockReturnValueOnce(
        new Promise<UserCredential>((resolve) => {
          resolveSignIn = resolve;
        })
      );
      render(<LoginForm />);

      fillAndSubmit('jane@example.com', 'Valid1@Password');
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /signing in/i }));
      expect(mockSignIn).toHaveBeenCalledTimes(1);

      resolveSignIn({ user: { uid: 'u1' } } as UserCredential);
      expect(await screen.findByRole('status')).toBeInTheDocument();
    });
  });
});
