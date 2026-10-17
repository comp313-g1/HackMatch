import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyActionCode } from 'firebase/auth';
import App from './App';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    applyActionCode: vi.fn(),
    checkActionCode: vi.fn(),
    onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: null) => void) => {
      cb(null);
      return () => {};
    }),
  };
});

describe('App Component (View Routing and Integration)', () => {
  const mockApplyActionCode = vi.mocked(applyActionCode);

  const primaryNav = () => screen.getByRole('navigation', { name: /primary/i });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('renders the header with HackMatch branding', () => {
    render(<App />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent('HackMatch');
  });

  it('renders the accessible skip-to-content link', () => {
    render(<App />);
    const skipLink = screen.getByText(/skip to main content/i);
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');
  });

  it('renders the main landmark and health probe button', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /probe \/api\/health/i })).toBeInTheDocument();
  });

  it('renders RegistrationForm by default when URL has no verification parameters', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /email verification/i })).not.toBeInTheDocument();
  });

  it('renders EmailVerificationView when URL contains mode=verifyEmail', async () => {
    window.history.pushState({}, '', '/?mode=verifyEmail&oobCode=url-test-code');
    mockApplyActionCode.mockResolvedValueOnce(undefined);

    render(<App />);

    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: /email verified successfully/i })
    ).toBeInTheDocument();
  });

  it('renders EmailVerificationView when URL contains view=verify', () => {
    window.history.pushState({}, '', '/?view=verify');

    render(<App />);

    expect(
      screen.getByRole('heading', { level: 2, name: /email verification/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();
  });

  it('renders PasswordRecoveryRequestForm when URL contains view=recover', () => {
    window.history.pushState({}, '', '/?view=recover');

    render(<App />);

    expect(screen.getByRole('heading', { level: 2, name: /reset password/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();
  });

  it('switches to verification view when RegistrationForm requests replacement link', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        message: 'User registered successfully',
        user: { id: 'test-id', email: 'registered@example.com' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    const main = screen.getByRole('main');
    // Fill and submit registration form
    fireEvent.change(within(main).getByLabelText(/full name/i), { target: { value: 'Test User' } });
    fireEvent.change(within(main).getByLabelText(/email address/i), {
      target: { value: 'registered@example.com' },
    });
    fireEvent.change(within(main).getByLabelText(/^password/i), {
      target: { value: 'Valid1@password' },
    });
    fireEvent.click(within(main).getByRole('button', { name: /create account/i }));

    // Wait for registration success view
    const replacementBtn = await screen.findByRole('button', {
      name: /didn't receive the email\? request a replacement link/i,
    });
    expect(replacementBtn).toBeInTheDocument();

    // Click replacement button
    fireEvent.click(replacementBtn);

    // Verify view transitioned to verification view and email is prefilled
    expect(
      await screen.findByRole('heading', { level: 2, name: /email verification/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue('registered@example.com');
  });

  it('navigates from EmailVerificationView to the sign-in form with status notice', async () => {
    window.history.pushState({}, '', '/?mode=verifyEmail&oobCode=sign-in-code');
    mockApplyActionCode.mockResolvedValueOnce(undefined);

    render(<App />);

    const signInBtn = await screen.findByRole('button', { name: /proceed to sign in/i });
    fireEvent.click(signInBtn);

    expect(within(primaryNav()).getByRole('button', { name: /^sign in$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByText(/participant account verified! you can now sign in/i)).toBeInTheDocument();
  });

  it('switches between create account and sign in via header nav', () => {
    render(<App />);

    expect(within(primaryNav()).getByRole('button', { name: /create account/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();

    fireEvent.click(within(primaryNav()).getByRole('button', { name: /^sign in$/i }));
    expect(within(primaryNav()).getByRole('button', { name: /^sign in$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(screen.getByRole('main')).getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();

    fireEvent.click(within(primaryNav()).getByRole('button', { name: /create account/i }));
    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();
  });

  it('does not show the account area to a signed-out visitor and links back to sign in', async () => {
    window.history.pushState({}, '', '/?view=account');

    render(<App />);

    expect(await screen.findByText(/you are not signed in/i)).toBeInTheDocument();
    expect(screen.queryByText(/you are signed in/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /go to sign in/i }));
    expect(within(primaryNav()).getByRole('button', { name: /^sign in$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('opens the sign-in form directly when ?view=login is in the URL', () => {
    window.history.pushState({}, '', '/?view=login');

    render(<App />);

    expect(within(primaryNav()).getByRole('button', { name: /^sign in$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(screen.getByRole('main')).getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('navigates from empty code verification view back to registration view when clicking back button', () => {
    window.history.pushState({}, '', '/?view=verify');

    render(<App />);

    const backBtn = screen.getByRole('button', { name: /back to registration/i });
    fireEvent.click(backBtn);

    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();
  });
});
