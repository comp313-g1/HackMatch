import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplacementLinkForm } from './ReplacementLinkForm';

describe('ReplacementLinkForm Component (US-001 AC 3, FR-081, FR-084, NR-017, NR-018)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Test 1: renders empty form with email input, submit button, and accessible labels', () => {
    render(<ReplacementLinkForm />);

    expect(
      screen.getByRole('heading', { level: 3, name: /request replacement verification link/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    expect(
      screen.getByRole('button', { name: /send verification link/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('Test 2: pre-fills email input when initialEmail prop is provided', () => {
    render(<ReplacementLinkForm initialEmail="alice@example.com" />);

    expect(screen.getByLabelText(/email address/i)).toHaveValue('alice@example.com');
  });

  it('handles whitespace-only initialEmail safely without setting cooldown', () => {
    render(<ReplacementLinkForm initialEmail="   " />);
    expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    expect(screen.queryByText(/please wait/i)).not.toBeInTheDocument();
  });

  it('updates email when initialEmail prop changes', () => {
    const { rerender } = render(<ReplacementLinkForm initialEmail="first@example.com" />);
    expect(screen.getByLabelText(/email address/i)).toHaveValue('first@example.com');

    rerender(<ReplacementLinkForm initialEmail="second@example.com" />);
    expect(screen.getByLabelText(/email address/i)).toHaveValue('second@example.com');
  });

  it('Test 3: validates empty submission: displays "Email address is required." in alert without calling backend', async () => {
    render(<ReplacementLinkForm />);

    fireEvent.click(screen.getByRole('button', { name: /send verification link/i }));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toHaveTextContent('Email address is required.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('Test 4: validates malformed email: displays "Please enter a valid email address." and preserves input per NR-017', async () => {
    render(<ReplacementLinkForm />);

    const input = screen.getByLabelText(/email address/i);
    fireEvent.change(input, { target: { value: 'invalid-email-format' } });
    fireEvent.click(screen.getByRole('button', { name: /send verification link/i }));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toHaveTextContent('Please enter a valid email address.');
    expect(input).toHaveValue('invalid-email-format');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('Test 5: successful submission displays generic confirmation banner (role="status") and disables submit button during cooldown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Verification link sent' }),
    });

    const onSuccess = vi.fn();
    render(<ReplacementLinkForm initialEmail="valid@example.com" onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: /send verification link/i }));

    expect(screen.getByRole('button', { name: /sending link\.\.\./i })).toBeDisabled();

    const statusBanner = await screen.findByRole('status');
    expect(statusBanner).toHaveAttribute('aria-live', 'polite');
    expect(statusBanner).toHaveTextContent(
      'If an account exists for this address, a new verification link has been sent. Please check your inbox and spam folder.'
    );

    expect(onSuccess).toHaveBeenCalledWith('valid@example.com');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/resend-verification',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'valid@example.com' }),
      })
    );

    // Verify button disabled during cooldown
    const cooldownButton = screen.getByRole('button', { name: /resend link/i });
    expect(cooldownButton).toBeDisabled();
    expect(screen.getByText(/please wait \d+ seconds before requesting another link/i)).toBeInTheDocument();

    // Verify sessionStorage has cooldown entry
    const savedExpiry = sessionStorage.getItem('hackmatch_resend_cooldown_valid@example.com');
    expect(savedExpiry).toBeTruthy();
    expect(Number(savedExpiry)).toBeGreaterThan(Date.now());
  });

  it('Test 6: simulates HTTP 429 Too Many Requests: displays rate-limit alert and initiates cooldown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many requests' }),
    });

    render(<ReplacementLinkForm initialEmail="rate.limited@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /send verification link/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many requests. Please wait a few minutes before trying again.');

    const submitBtn = screen.getByRole('button', { name: /resend link/i });
    expect(submitBtn).toBeDisabled();
  });

  it('Test 7: simulates network failure: displays accessible error alert and retains entered email per NR-017 and FR-084', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<ReplacementLinkForm />);

    const input = screen.getByLabelText(/email address/i);
    fireEvent.change(input, { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send verification link/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network error. Please check your internet connection.');
    expect(input).toHaveValue('user@example.com');
  });

  it('Test 8: calls onCancel callback when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ReplacementLinkForm onCancel={onCancel} />);

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    expect(cancelBtn).toBeInTheDocument();
    fireEvent.click(cancelBtn);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('displays backend delivery error response per FR-084', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Mail dispatch service unavailable' }),
    });

    render(<ReplacementLinkForm initialEmail="server.error@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /send verification link/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Mail dispatch service unavailable');
  });

  it('falls back to generic error message when backend returns non-ok without JSON payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Bad gateway');
      },
    });

    render(<ReplacementLinkForm initialEmail="bad.gateway@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /send verification link/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to send verification email. Please try again.');
  });

  it('restores active cooldown from sessionStorage on mount with initialEmail', () => {
    const email = 'active.cooldown@example.com';
    const futureExpiry = Date.now() + 30000;
    sessionStorage.setItem(`hackmatch_resend_cooldown_${email}`, String(futureExpiry));

    render(<ReplacementLinkForm initialEmail={email} />);

    const cooldownBtn = screen.getByRole('button', { name: /resend link/i });
    expect(cooldownBtn).toBeDisabled();
    expect(screen.getByText(/please wait \d+ seconds before requesting another link/i)).toBeInTheDocument();
  });

  it('removes expired cooldown from sessionStorage on mount', () => {
    const email = 'expired.cooldown@example.com';
    const pastExpiry = Date.now() - 5000;
    sessionStorage.setItem(`hackmatch_resend_cooldown_${email}`, String(pastExpiry));

    render(<ReplacementLinkForm initialEmail={email} />);

    const submitBtn = screen.getByRole('button', { name: /send verification link/i });
    expect(submitBtn).not.toBeDisabled();
    expect(sessionStorage.getItem(`hackmatch_resend_cooldown_${email}`)).toBeNull();
  });

  it('counts down cooldown seconds and re-enables submit button when timer reaches zero', () => {
    vi.useFakeTimers();

    const email = 'timer.test@example.com';
    const futureExpiry = Date.now() + 3000; // 3 seconds
    sessionStorage.setItem(`hackmatch_resend_cooldown_${email}`, String(futureExpiry));

    render(<ReplacementLinkForm initialEmail={email} />);

    expect(screen.getByRole('button', { name: /resend link \(3s\)/i })).toBeDisabled();

    // Advance 1s
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /resend link \(2s\)/i })).toBeDisabled();

    // Advance 1s
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /resend link \(1s\)/i })).toBeDisabled();

    // Advance 1s to reach 0
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const readyBtn = screen.getByRole('button', { name: /send verification link/i });
    expect(readyBtn).not.toBeDisabled();
    expect(screen.queryByText(/please wait/i)).not.toBeInTheDocument();
  });

  it('prevents submission when cooldown is active', () => {
    const email = 'blocked@example.com';
    const futureExpiry = Date.now() + 20000;
    sessionStorage.setItem(`hackmatch_resend_cooldown_${email}`, String(futureExpiry));

    render(<ReplacementLinkForm initialEmail={email} />);

    const form = screen.getByRole('button', { name: /resend link/i }).closest('form');
    if (form) {
      fireEvent.submit(form);
    }

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles sessionStorage access restriction gracefully without crashing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Verification link sent' }),
    });

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: Access denied');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError: Access denied');
    });

    render(<ReplacementLinkForm initialEmail="safe@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /send verification link/i }));

    const statusBanner = await screen.findByRole('status');
    expect(statusBanner).toBeInTheDocument();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});
