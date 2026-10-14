import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signInWithPopup } from 'firebase/auth';
import { RegistrationForm } from './RegistrationForm';
import {
  validateRegistrationInput,
  assertNoPrivilegeEscalation,
  PROHIBITED_PRIVILEGE_KEYS,
} from './validation';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    signInWithPopup: vi.fn(),
  };
});

const mockSignInWithPopup = vi.mocked(signInWithPopup);
const mockFetch = vi.fn();

describe('assertNoPrivilegeEscalation helper', () => {
  it('returns true for clean payloads without privilege properties', () => {
    expect(
      assertNoPrivilegeEscalation({
        fullName: 'Alice',
        email: 'alice@example.com',
        password: 'SecretPassword1!',
      })
    ).toBe(true);
    expect(assertNoPrivilegeEscalation({})).toBe(true);
  });

  it('returns false when any prohibited privilege key is present', () => {
    for (const key of PROHIBITED_PRIVILEGE_KEYS) {
      expect(assertNoPrivilegeEscalation({ [key]: 'ADMIN' })).toBe(false);
      expect(assertNoPrivilegeEscalation({ [key]: true })).toBe(false);
      expect(assertNoPrivilegeEscalation({ [key]: {} })).toBe(false);
    }
  });
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

describe('RegistrationForm Component (Backend Integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', mockFetch);
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

  it('validates empty submission without calling backend API and displays field errors', async () => {
    render(<RegistrationForm />);

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Full name is required.')).toBeInTheDocument();
    expect(screen.getByText('Email address is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('validates password policy on client and displays field error without calling backend', async () => {
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
    expect(mockFetch).not.toHaveBeenCalled();
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

  it('handles HTTP 409 EMAIL_ALREADY_IN_USE by setting field error on email while preserving inputs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'An account with this email already exists.',
        code: 'EMAIL_ALREADY_IN_USE',
      }),
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

  it('handles network failure with a form-level error alert', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

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

  it('completes the full registration lifecycle via POST /api/auth/register and renders success view', async () => {
    const onSuccess = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        message: 'User registered successfully',
        user: {
          id: 'user-123',
          email: 'alice@example.com',
          fullName: 'Alice Smith',
          role: 'PART',
          isVerified: false,
        },
      }),
    });

    render(<RegistrationForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: 'Alice Smith',
          email: 'alice@example.com',
          password: 'Valid1@Password',
        }),
      });
    });

    // Success screen rendered
    // Note on R1: The UI informs the user that a verification link was sent,
    // which reflects the target design; actual email dispatch is pending S1-P1-03.
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /verify your email/i })).toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/important security note/i)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledWith('alice@example.com');
  });

  it('handles backend validation errors (HTTP 400 with field errors map)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Validation failed',
        errors: {
          email: 'Please provide a valid email address.',
        },
      }),
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

  it('handles HTTP 403 Forbidden with administrative privilege error alert', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'Public registration cannot grant administrative privileges.',
      }),
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Public registration cannot grant administrative privileges.');
    // NR-017: preserve valid field inputs on error
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Smith');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('alice@example.com');
  });

  it('submits strictly { fullName, email, password } without role or escalation properties', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        participant: {
          id: 'part-123',
          email: 'alice@example.com',
          role: 'PART',
        },
      }),
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const dispatchedBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(dispatchedBody).toEqual({
      fullName: 'Alice Smith',
      email: 'alice@example.com',
      password: 'Valid1@Password',
    });
    expect(dispatchedBody.role).toBeUndefined();
    expect(dispatchedBody.isAdmin).toBeUndefined();
  });

  it('handles HTTP 500 server error with form-level failure alert', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'Internal Server Error',
      }),
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Internal Server Error');
  });

  it('disables submit button and reflects loading state during submission', async () => {
    let resolveResponse: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveResponse = resolve;
    });

    mockFetch.mockReturnValueOnce(fetchPromise);

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    const submitBtn = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitBtn);

    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('Creating Account...');
    expect(submitBtn).toHaveAttribute('aria-busy', 'true');

    resolveResponse!({
      ok: true,
      status: 201,
      json: async () => ({
        message: 'User registered successfully',
        user: { id: 'u1' },
      }),
    });

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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ message: 'User registered successfully' }),
    });

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

  it('handles backend 400 INVALID_EMAIL error and maps to email field while preserving inputs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Invalid email address.',
        code: 'INVALID_EMAIL',
      }),
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@domain.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Invalid email address.')).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Smith');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('alice@domain.com');
    expect(screen.getByLabelText(/^password/i)).toHaveValue('Valid1@Password');
  });

  it('handles backend 400 WEAK_PASSWORD error and maps to password field while preserving inputs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Password does not meet security requirements.',
        code: 'WEAK_PASSWORD',
      }),
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('Password does not meet security requirements.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Smith');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('alice@example.com');
  });

  it('handles non-JSON error response (e.g. 502 Bad Gateway) with fallback error alert', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Registration failed. Please try again later.');
  });

  it('normalizes email to lowercase and trims full name when dispatching request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ message: 'User registered successfully' }),
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: '  Alice Smith  ' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: '  Alice@Example.COM  ' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Alice Smith',
          email: 'alice@example.com',
          password: 'Valid1@Password',
        }),
      });
    });
  });

  it('updates aria-invalid and aria-describedby on error, and clears error when user edits field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Validation failed',
        errors: { email: 'Please provide a valid email address.' },
      }),
    });

    render(<RegistrationForm />);

    const emailInput = screen.getByLabelText(/email address/i);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
    expect(emailInput).not.toHaveAttribute('aria-describedby');

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Please provide a valid email address.')).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby', 'email-error');

    // Editing the field clears the error and resets aria-invalid to false
    fireEvent.change(emailInput, { target: { value: 'alice.updated@example.com' } });
    expect(screen.queryByText('Please provide a valid email address.')).not.toBeInTheDocument();
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
    expect(emailInput).not.toHaveAttribute('aria-describedby');
  });

  it('blocks duplicate submissions while a request is pending', async () => {
    let resolveResponse: (value: unknown) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    const submitBtn = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveResponse!({
      ok: true,
      status: 201,
      json: async () => ({ message: 'User registered successfully' }),
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('displays server-side validation error when fullName exceeds 100 characters', async () => {
    const longName = 'a'.repeat(101);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Validation failed',
        errors: { fullName: 'Full name must not exceed 100 characters.' },
      }),
    });

    render(<RegistrationForm />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: longName } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Valid1@Password' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText('Full name must not exceed 100 characters.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/full name/i)).toHaveAttribute('aria-describedby', 'fullName-error');
  });

  it('invokes onNavigateToVerification callback with registeredEmail when replacement link button is clicked', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        message: 'User registered successfully',
        user: { id: 'u-123', email: 'registered@example.com' },
      }),
    });

    const onNavigateToVerification = vi.fn();
    render(<RegistrationForm onNavigateToVerification={onNavigateToVerification} />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'registered@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'StrongP@ssw0rd!' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const replacementBtn = await screen.findByRole('button', {
      name: /didn't receive the email\? request a replacement link/i,
    });
    fireEvent.click(replacementBtn);

    expect(onNavigateToVerification).toHaveBeenCalledWith('registered@example.com');
  });
});

describe('RegistrationForm · Federated OAuth Integration (US-002 AC 1, AC 2, AC 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('case 1: user types fullName, cancels provider popup -> fullName is preserved, alert is rendered, and no session is created (US-002 AC 1 / US-002-T2)', async () => {
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });

    render(<RegistrationForm />);

    const nameInput = screen.getByLabelText(/full name/i);
    fireEvent.change(nameInput, { target: { value: 'Bob Builder' } });
    expect(nameInput).toHaveValue('Bob Builder');

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/cancelled/i);

    // Full name input value is strictly preserved across provider cancellation (NR-010)
    expect(nameInput).toHaveValue('Bob Builder');

    // Zero-session invariant: storage and cookies remain completely empty
    expect(Object.keys(localStorage)).toHaveLength(0);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('case 2: provider with unverified email diverts to manual registration, pre-fills email, preserves fullName, and focuses password (US-002 AC 2 / US-002-T3)', async () => {
    mockSignInWithPopup.mockResolvedValueOnce({
      user: {
        email: 'unverified@github.com',
        emailVerified: false,
        getIdToken: vi.fn(),
      },
    } as never);

    render(<RegistrationForm />);

    const nameInput = screen.getByLabelText(/full name/i);
    fireEvent.change(nameInput, { target: { value: 'Alice Wonder' } });

    fireEvent.click(screen.getByRole('button', { name: /continue with github/i }));

    const diversionBanner = await screen.findByText(/your provider account email is unverified/i);
    expect(diversionBanner).toBeInTheDocument();
    expect(diversionBanner).toHaveTextContent(/create a password below/i);

    // Email field is pre-filled with provider email
    expect(screen.getByLabelText(/email address/i)).toHaveValue('unverified@github.com');
    // Full name is preserved
    expect(nameInput).toHaveValue('Alice Wonder');
    // Password input receives focus for immediate completion
    await waitFor(() => {
      expect(screen.getByLabelText(/^password/i)).toHaveFocus();
    });

    // Zero-session invariant
    expect(Object.keys(localStorage)).toHaveLength(0);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('case 3: provider with null email renders instructional notice, keeps email editable, and focuses email (US-002 AC 2)', async () => {
    mockSignInWithPopup.mockResolvedValueOnce({
      user: {
        email: null,
        emailVerified: false,
        getIdToken: vi.fn(),
      },
    } as never);

    render(<RegistrationForm />);

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    const diversionBanner = await screen.findByText(/your provider account did not share an email address/i);
    expect(diversionBanner).toBeInTheDocument();

    const emailInput = screen.getByLabelText(/email address/i);
    await waitFor(() => {
      expect(emailInput).toHaveFocus();
    });
    expect(emailInput).not.toBeDisabled();

    // Zero-session invariant
    expect(Object.keys(localStorage)).toHaveLength(0);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('case 4: server returns 409 LINKING_REAUTHENTICATION_REQUIRED -> actionable guidance appears without retry button (US-002 AC 4 / US-002-T5)', async () => {
    mockSignInWithPopup.mockResolvedValueOnce({
      user: {
        email: 'existing@example.com',
        emailVerified: true,
        getIdToken: vi.fn().mockResolvedValue('token-123'),
      },
    } as never);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'An account with this email already exists. Please sign in with your password to link your provider.',
        code: 'LINKING_REAUTHENTICATION_REQUIRED',
      }),
    });

    render(<RegistrationForm />);

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/password/i);
    // Non-retryable policy rejection suppresses the retry button
    expect(screen.queryByRole('button', { name: /try again with google/i })).toBeNull();

    // Zero-session invariant
    expect(Object.keys(localStorage)).toHaveLength(0);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('case 5: provider sign-in success calls onRequiresOtp without creating local session (US-002 AC 5)', async () => {
    mockSignInWithPopup.mockResolvedValueOnce({
      user: {
        email: 'verified@example.com',
        emailVerified: true,
        getIdToken: vi.fn().mockResolvedValue('token-verified'),
      },
    } as never);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requiresOtp: true,
        challengeId: 'challenge-xyz',
        email: 'v***@example.com',
        expiresInSeconds: 600,
        message: 'A 6-digit verification code has been sent to your email.',
      }),
    });

    const onRequiresOtp = vi.fn();
    render(<RegistrationForm onRequiresOtp={onRequiresOtp} />);

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() => {
      expect(onRequiresOtp).toHaveBeenCalledWith({
        challengeId: 'challenge-xyz',
        email: 'v***@example.com',
        expiresInSeconds: 600,
        message: 'A 6-digit verification code has been sent to your email.',
      });
    });

    // Zero-session invariant
    expect(Object.keys(localStorage)).toHaveLength(0);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('case 6: manual inputs and submit button are disabled while OAuth is loading', async () => {
    let resolvePopup!: (val: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePopup = resolve;
    });
    mockSignInWithPopup.mockReturnValueOnce(pendingPromise as never);

    render(<RegistrationForm />);

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/full name/i)).toBeDisabled();
    });
    expect(screen.getByLabelText(/email address/i)).toBeDisabled();
    expect(screen.getByLabelText(/^password/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();

    // Clean up pending promise to avoid unhandled async hang
    resolvePopup({
      user: {
        email: null,
        emailVerified: false,
        getIdToken: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create account/i })).not.toBeDisabled();
    });
  });
});

