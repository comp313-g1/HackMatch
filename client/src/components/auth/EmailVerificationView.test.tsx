import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyActionCode, checkActionCode } from 'firebase/auth';
import { EmailVerificationView } from './EmailVerificationView';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    applyActionCode: vi.fn(),
    checkActionCode: vi.fn(),
  };
});

describe('EmailVerificationView Component (US-001 AC 3, AC 5, US-001-T3, US-001-T4, NR-018)', () => {
  const mockApplyActionCode = vi.mocked(applyActionCode);
  const mockCheckActionCode = vi.mocked(checkActionCode);
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'verified' }),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  it('Test 1 (Loading state): renders loading spinner and announcement while verification is in-flight', () => {
    mockApplyActionCode.mockReturnValueOnce(new Promise(() => {})); // pending promise

    render(<EmailVerificationView actionCode="pending-code" mode="verifyEmail" />);

    const statusBanner = screen.getByRole('status');
    expect(statusBanner).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /verifying email address/i })).toBeInTheDocument();
    expect(screen.getByText(/please wait while we verify your email address\.\.\./i)).toBeInTheDocument();
  });

  it('Test 2 (Happy path / US-001-T3): valid action code marks verified, shows sign-in CTA, dispatches sync, and shows MFA notice (AC 5)', async () => {
    mockCheckActionCode.mockResolvedValueOnce({
      data: { email: 'verified@example.com' },
      operation: 'VERIFY_EMAIL',
    });
    mockApplyActionCode.mockResolvedValueOnce(undefined);

    const onSignIn = vi.fn();
    render(
      <EmailVerificationView
        actionCode="valid-oob-code"
        mode="verifyEmail"
        onNavigateToSignIn={onSignIn}
      />
    );

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: /email verified successfully/i,
    });
    expect(heading).toBeInTheDocument();

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(statusRegion).toHaveTextContent(/your email address has been verified/i);

    // AC 5 / FR-007 notice
    expect(screen.getByText(/security policy notice:/i)).toBeInTheDocument();
    expect(screen.getByText(/email verification does not automatically create an active session/i)).toBeInTheDocument();

    // Sign in CTA
    const signInBtn = screen.getByRole('button', { name: /proceed to sign in/i });
    expect(signInBtn).toBeInTheDocument();
    fireEvent.click(signInBtn);
    expect(onSignIn).toHaveBeenCalledTimes(1);

    // Backend sync dispatch
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/verify-email',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oobCode: 'valid-oob-code' }),
      })
    );
  });

  it('Test 3 (Expired link / US-001-T4): renders expired alert and embedded replacement-link form', async () => {
    mockCheckActionCode.mockResolvedValueOnce({
      data: { email: 'user@expired.com' },
      operation: 'VERIFY_EMAIL',
    });
    mockApplyActionCode.mockRejectedValueOnce({
      code: 'auth/expired-action-code',
      message: 'Action code expired',
    });

    render(<EmailVerificationView actionCode="expired-code" mode="verifyEmail" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/verification link expired/i);
    expect(alert).toHaveTextContent(/your verification link has expired/i);

    // ReplacementLinkForm embedded and pre-filled with recovered email
    expect(
      screen.getByRole('heading', { level: 3, name: /request replacement verification link/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue('user@expired.com');
  });

  it('Test 4 (Invalid / consumed link / US-001-T4): renders invalid alert and embedded replacement form', async () => {
    mockCheckActionCode.mockRejectedValueOnce(new Error('Invalid action code'));
    mockApplyActionCode.mockRejectedValueOnce({
      code: 'auth/invalid-action-code',
      message: 'Invalid code',
    });

    render(<EmailVerificationView actionCode="consumed-code" mode="verifyEmail" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/verification link invalid/i);
    expect(alert).toHaveTextContent(
      /this verification link is invalid or has already been used/i
    );

    expect(
      screen.getByRole('heading', { level: 3, name: /request replacement verification link/i })
    ).toBeInTheDocument();
  });

  it('Test 5 (Empty code state): renders informational empty state and replacement link form', () => {
    const onRegister = vi.fn();
    render(
      <EmailVerificationView
        actionCode={null}
        mode={null}
        onNavigateToRegister={onRegister}
      />
    );

    expect(
      screen.getByRole('heading', { level: 2, name: /email verification/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/no verification code was detected/i)).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { level: 3, name: /request replacement verification link/i })
    ).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: /back to registration/i });
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(onRegister).toHaveBeenCalledTimes(1);

    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  it('Test 6 (URL search params extraction): extracts oobCode and mode from window.location.search when props are omitted', async () => {
    window.history.pushState({}, '', '/?mode=verifyEmail&oobCode=url-query-code-99');
    mockApplyActionCode.mockResolvedValueOnce(undefined);

    render(<EmailVerificationView />);

    await waitFor(() => {
      expect(mockApplyActionCode).toHaveBeenCalledWith(expect.anything(), 'url-query-code-99');
    });

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /email verified successfully/i,
      })
    ).toBeInTheDocument();
  });

  it('Test 7 (Unrecognized action mode): blocks verification when mode is not verifyEmail', () => {
    render(<EmailVerificationView actionCode="some-code" mode="resetPassword" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Invalid action mode for email verification.'
    );
    expect(mockApplyActionCode).not.toHaveBeenCalled();
  });

  it('handles transient network failure with dedicated network_error state and retry capability', async () => {
    mockApplyActionCode.mockRejectedValueOnce({
      code: 'auth/network-request-failed',
      message: 'Network error',
    });

    const onRegister = vi.fn();
    render(
      <EmailVerificationView
        actionCode="retry-code"
        mode="verifyEmail"
        onNavigateToRegister={onRegister}
      />
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/connection issue/i);
    expect(alert).toHaveTextContent(/network error/i);

    const retryBtn = screen.getByRole('button', { name: /retry verification/i });
    expect(retryBtn).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: /back to registration/i });
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(onRegister).toHaveBeenCalledTimes(1);

    // Test retry
    mockApplyActionCode.mockResolvedValueOnce(undefined);
    fireEvent.click(retryBtn);

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /email verified successfully/i,
      })
    ).toBeInTheDocument();
  });

  it('scrubs oobCode parameter from browser address bar on mount', () => {
    window.history.pushState({}, '', '/?mode=verifyEmail&oobCode=secret-token-12345');
    mockApplyActionCode.mockReturnValueOnce(new Promise(() => {}));

    render(<EmailVerificationView />);

    expect(window.location.search).not.toContain('oobCode=secret-token-12345');
  });

  it('remains resilient when backend sync notification fails (non-blocking)', async () => {
    mockApplyActionCode.mockResolvedValueOnce(undefined);
    mockFetch.mockRejectedValueOnce(new Error('Sync endpoint down'));

    render(<EmailVerificationView actionCode="valid-code-sync-fail" mode="verifyEmail" />);

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /email verified successfully/i,
      })
    ).toBeInTheDocument();
  });

  it('handles unknown or string error rejections by falling back to invalid link state', async () => {
    mockApplyActionCode.mockRejectedValueOnce('raw string error');

    render(<EmailVerificationView actionCode="string-err-code" mode="verifyEmail" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/verification link invalid/i);
    expect(alert).toHaveTextContent(/authentication failed/i);
  });
});
