import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { signInWithEmailAndPassword, type UserCredential } from 'firebase/auth';
import { LoginForm } from './LoginForm';
import { GENERIC_CREDENTIALS_ERROR } from './loginErrors';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    signInWithEmailAndPassword: vi.fn(),
  };
});

const mockSignIn = vi.mocked(signInWithEmailAndPassword);

const firebaseError = (code: string) => Object.assign(new Error(code), { code });

const fillAndSubmit = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
};

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email and password fields with a sign in button', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email address/i)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it('shows required-field errors on empty submit without calling Firebase', () => {
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('rejects an invalid email and preserves the entered values', () => {
    render(<LoginForm />);

    fillAndSubmit('not-an-email', 'secret123');

    expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue('not-an-email');
    expect(screen.getByLabelText(/password/i)).toHaveValue('secret123');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('clears a field error once the user edits that field', () => {
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'x' } });
    expect(screen.queryByText(/password is required/i)).not.toBeInTheDocument();
    expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
  });

  it('shows a loading state and blocks double submits while signing in', async () => {
    let resolveSignIn: (value: UserCredential) => void = () => {};
    mockSignIn.mockReturnValueOnce(
      new Promise<UserCredential>((resolve) => {
        resolveSignIn = resolve;
      })
    );
    render(<LoginForm />);

    fillAndSubmit('jane@example.com', 'secret123');

    const button = screen.getByRole('button', { name: /signing in/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText(/email address/i)).toBeDisabled();
    expect(screen.getByLabelText(/password/i)).toBeDisabled();

    fireEvent.submit(button.closest('form') as HTMLFormElement);
    expect(mockSignIn).toHaveBeenCalledTimes(1);

    resolveSignIn({ user: { uid: 'u1' } } as UserCredential);
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('signs in with a normalized email and shows the next-step success panel', async () => {
    const user = { uid: 'u1', email: 'jane@example.com' };
    mockSignIn.mockResolvedValueOnce({ user } as UserCredential);
    const onPrimaryAuthSuccess = vi.fn();
    render(<LoginForm onPrimaryAuthSuccess={onPrimaryAuthSuccess} />);

    fillAndSubmit('  Jane@Example.com ', 'secret123');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/password accepted/i);
    expect(status).toHaveTextContent('jane@example.com');
    expect(status).toHaveTextContent(/one-time code/i);
    expect(mockSignIn).toHaveBeenCalledWith(expect.anything(), 'jane@example.com', 'secret123');
    expect(onPrimaryAuthSuccess).toHaveBeenCalledWith({ email: 'jane@example.com', user });
  });

  it('returns to an empty form when choosing a different account', async () => {
    mockSignIn.mockResolvedValueOnce({ user: { uid: 'u1' } } as UserCredential);
    render(<LoginForm />);

    fillAndSubmit('jane@example.com', 'secret123');
    fireEvent.click(await screen.findByRole('button', { name: /use a different account/i }));

    expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    expect(screen.getByLabelText(/password/i)).toHaveValue('');
  });

  it.each([
    'auth/invalid-credential',
    'auth/wrong-password',
    'auth/user-not-found',
    'auth/invalid-login-credentials',
  ])('shows the same generic message for %s and keeps the email', async (code) => {
    mockSignIn.mockRejectedValueOnce(firebaseError(code));
    render(<LoginForm />);

    fillAndSubmit('jane@example.com', 'wrong-pass');

    expect(await screen.findByText(GENERIC_CREDENTIALS_ERROR)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue('jane@example.com');
    expect(screen.getByLabelText(/password/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it.each([
    ['auth/too-many-requests', /too many unsuccessful sign-in attempts/i],
    ['auth/user-disabled', /this account cannot sign in right now/i],
    ['auth/network-request-failed', /network error/i],
    ['auth/internal-error', /sign-in failed\. please try again/i],
  ])('shows a clear message for %s and keeps the entered values', async (code, message) => {
    mockSignIn.mockRejectedValueOnce(firebaseError(code));
    render(<LoginForm />);

    fillAndSubmit('jane@example.com', 'secret123');

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue('jane@example.com');
    expect(screen.getByLabelText(/password/i)).toHaveValue('secret123');
  });

  it('clears the previous error when the user submits again', async () => {
    mockSignIn
      .mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
      .mockResolvedValueOnce({ user: { uid: 'u1' } } as UserCredential);
    render(<LoginForm />);

    fillAndSubmit('jane@example.com', 'secret123');
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.queryByText(/network error/i)).not.toBeInTheDocument());
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('offers a link to create an account when provided', () => {
    const onNavigateToRegister = vi.fn();
    render(<LoginForm onNavigateToRegister={onNavigateToRegister} />);

    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    expect(onNavigateToRegister).toHaveBeenCalledTimes(1);
  });
});
