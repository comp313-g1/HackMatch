import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistrationForm } from './RegistrationForm';
import { validateRegistrationInput } from './validation';
import * as firebaseAuth from 'firebase/auth';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    createUserWithEmailAndPassword: vi.fn(),
    updateProfile: vi.fn(),
    sendEmailVerification: vi.fn(),
    signOut: vi.fn(),
  };
});

describe('validateRegistrationInput helper', () => {
  it('detects missing or whitespace-only full name', () => {
    expect(validateRegistrationInput('', 'test@example.com', 'Valid1@pass').fullName).toBe(
      'Full name is required.'
    );
    expect(validateRegistrationInput('   ', 'test@example.com', 'Valid1@pass').fullName).toBe(
      'Full name is required.'
    );
  });

  it('detects missing or malformed email address', () => {
    expect(validateRegistrationInput('Alice Smith', '', 'Valid1@pass').email).toBe(
      'Email address is required.'
    );
    expect(validateRegistrationInput('Alice Smith', 'invalid-email', 'Valid1@pass').email).toBe(
      'Please enter a valid email address.'
    );
    expect(validateRegistrationInput('Alice Smith', 'test@', 'Valid1@pass').email).toBe(
      'Please enter a valid email address.'
    );
    expect(validateRegistrationInput('Alice Smith', '@example.com', 'Valid1@pass').email).toBe(
      'Please enter a valid email address.'
    );
  });

  it('permits non-academic email addresses per US-001 AC 1', () => {
    const errors = validateRegistrationInput('Alice Smith', 'alice@gmail.com', 'Valid1@pass');
    expect(errors.email).toBeUndefined();
  });

  it('detects missing password', () => {
    expect(validateRegistrationInput('Alice Smith', 'alice@example.com', '').password).toBe(
      'Password is required.'
    );
  });

  it('detects passwords failing policy (at least 8 chars, mixed case, digit, special char)', () => {
    // Under 8 characters
    expect(validateRegistrationInput('Alice', 'alice@example.com', 'V1@pass').password).toBeDefined();
    // Missing uppercase
    expect(
      validateRegistrationInput('Alice', 'alice@example.com', 'valid1@pass').password
    ).toBeDefined();
    // Missing lowercase
    expect(
      validateRegistrationInput('Alice', 'alice@example.com', 'VALID1@PASS').password
    ).toBeDefined();
    // Missing digit
    expect(
      validateRegistrationInput('Alice', 'alice@example.com', 'Valid!@pass').password
    ).toBeDefined();
    // Missing special character
    expect(
      validateRegistrationInput('Alice', 'alice@example.com', 'Valid12345').password
    ).toBeDefined();
  });

  it('validates password length boundary: 7 characters fails, 8 characters with all classes passes', () => {
    // 7 characters (boundary failure)
    expect(
      validateRegistrationInput('Alice', 'alice@example.com', 'Pass12!').password
    ).toBeDefined();
    // 8 characters (boundary success)
    expect(
      validateRegistrationInput('Alice', 'alice@example.com', 'Pass123!').password
    ).toBeUndefined();
  });

  it('returns empty error object for fully valid inputs', () => {
    const errors = validateRegistrationInput('Alice Smith', 'alice@example.com', 'StrongP@ssw0rd!');
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

describe('RegistrationForm Component', () => {
  const mockUser = { uid: 'user-123', email: 'alice@example.com' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockResolvedValue({
      user: mockUser,
    } as unknown as firebaseAuth.UserCredential);
    vi.mocked(firebaseAuth.updateProfile).mockResolvedValue();
    vi.mocked(firebaseAuth.sendEmailVerification).mockResolvedValue();
    vi.mocked(firebaseAuth.signOut).mockResolvedValue();
  });

  it('renders initial empty form with labels, placeholders, hint, and button', () => {
    render(<RegistrationForm />);

    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue('');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    expect(screen.getByLabelText(/^password/i)).toHaveValue('');
    expect(screen.getByText(/must be at least 8 characters with uppercase/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('validates empty submission without calling Firebase and displays field errors', async () => {
    render(<RegistrationForm />);

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Full name is required.')).toBeInTheDocument();
    expect(screen.getByText('Email address is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();

    expect(firebaseAuth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('validates password policy and displays field error', async () => {
    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'weakpass' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText(
        'Password must be at least 8 characters long and include uppercase, lowercase, a number, and a special character.'
      )
    ).toBeInTheDocument();
    expect(firebaseAuth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('preserves valid entered inputs when validation fails (NR-017)', async () => {
    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Preserved Name' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'preserved@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'short' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    // Inputs must retain previously entered values
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Preserved Name');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('preserved@example.com');
  });

  it('handles auth/email-already-in-use by setting field error on email input while preserving inputs', async () => {
    vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockRejectedValueOnce({
      code: 'auth/email-already-in-use',
      message: 'The email address is already in use by another account.',
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Duplicate User' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'taken@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('An account with this email already exists.')
    ).toBeInTheDocument();

    // Data preservation check
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Duplicate User');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('taken@example.com');
  });

  it('handles auth/network-request-failed with a form-level error alert', async () => {
    vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockRejectedValueOnce({
      code: 'auth/network-request-failed',
      message: 'Network error.',
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network error. Please check your internet connection.');

    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Smith');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('alice@example.com');
  });

  it('completes the full registration lifecycle, calls signOut, and renders the success view', async () => {
    const onSuccess = vi.fn();
    render(<RegistrationForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(firebaseAuth.createUserWithEmailAndPassword).toHaveBeenCalledWith(
        expect.anything(),
        'alice@example.com',
        'Valid1@Password'
      );
    });

    expect(firebaseAuth.updateProfile).toHaveBeenCalledWith(mockUser, {
      displayName: 'Alice Smith',
    });

    expect(firebaseAuth.sendEmailVerification).toHaveBeenCalledWith(mockUser);

    // Verifies pre-auth session security invariant: unverified session must be terminated immediately
    expect(firebaseAuth.signOut).toHaveBeenCalled();

    // Success screen rendered
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /verify your email/i })).toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/important security note/i)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledWith('alice@example.com');
  });

  it('handles auth/invalid-email by setting field error on email input while preserving inputs', async () => {
    vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockRejectedValueOnce({
      code: 'auth/invalid-email',
      message: 'The email address is badly formatted.',
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@rejected.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('Please provide a valid email address.')
    ).toBeInTheDocument();

    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Smith');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('alice@rejected.com');
  });

  it('handles auth/weak-password by setting field error on password input while preserving inputs', async () => {
    vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockRejectedValueOnce({
      code: 'auth/weak-password',
      message: 'Password should be at least 6 characters.',
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Weak123!' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('Password does not meet security requirements.')
    ).toBeInTheDocument();

    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Smith');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('alice@example.com');
  });

  it('guarantees signOut is called even when post-creation sendEmailVerification fails (FR-007, US-001 AC 5)', async () => {
    vi.mocked(firebaseAuth.sendEmailVerification).mockRejectedValueOnce(
      new Error('Failed to dispatch verification email.')
    );

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Account created, but failed to send verification email. Please try signing in or requesting a replacement verification link.'
    );

    // Critical security check: signOut must have been called despite the failure
    expect(firebaseAuth.signOut).toHaveBeenCalled();
  });

  it('disables submit button and reflects loading state during submission', async () => {
    let resolveAuth: (value: unknown) => void;
    const authPromise = new Promise((resolve) => {
      resolveAuth = resolve;
    });

    vi.mocked(firebaseAuth.createUserWithEmailAndPassword).mockImplementationOnce(
      () => authPromise as unknown as Promise<firebaseAuth.UserCredential>
    );

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    const submitBtn = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitBtn);

    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('Creating Account...');
    expect(submitBtn).toHaveAttribute('aria-busy', 'true');

    resolveAuth!({ user: mockUser });
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('does not expose role selection or administrative controls (US-001 AC 4 / US-001-T6)', () => {
    render(<RegistrationForm />);

    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('allows registering another account after success reset', async () => {
    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('status')).toBeInTheDocument();

    const resetButton = screen.getByRole('button', { name: /register another account/i });
    fireEvent.click(resetButton);

    // Form is restored to empty initial state
    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue('');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    expect(screen.getByLabelText(/^password/i)).toHaveValue('');
  });
});
