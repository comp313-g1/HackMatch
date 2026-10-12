import React from 'react';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VerificationGate } from './VerificationGate';
import { VerificationActionButton } from './VerificationActionButton';
import { useVerificationGuard } from '../../hooks/useVerificationGuard';

describe('VerificationGate UI Component (US-001 AC 4, NR-018)', () => {
  it('renders children when participant is verified (isVerified = true)', () => {
    render(
      <VerificationGate isVerified={true}>
        <div data-testid="protected-content">Protected recruitment workspace</div>
      </VerificationGate>
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders accessible alert banner and suppresses children when isVerified = false', () => {
    render(
      <VerificationGate isVerified={false}>
        <div data-testid="protected-content">Protected recruitment workspace</div>
      </VerificationGate>
    );

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute('aria-live', 'polite');
    expect(alert).toHaveTextContent(/Email Verification Required/i);
    expect(alert).toHaveTextContent(
      /Unverified accounts cannot declare availability, create teams, apply, or accept invitations/i
    );

    const resendLink = screen.getByRole('link', { name: /resend verification email/i });
    expect(resendLink).toHaveAttribute('href', '/resend-verification');
  });

  it('honors custom resendHref prop when provided', () => {
    render(
      <VerificationGate isVerified={false} resendHref="/custom-resend-link">
        <div>Protected</div>
      </VerificationGate>
    );

    const resendLink = screen.getByRole('link', { name: /resend verification email/i });
    expect(resendLink).toHaveAttribute('href', '/custom-resend-link');
  });

  it('renders custom fallback when provided and isVerified = false', () => {
    render(
      <VerificationGate
        isVerified={false}
        fallback={<div data-testid="custom-fallback">Custom fallback banner</div>}
      >
        <div data-testid="protected-content">Protected</div>
      </VerificationGate>
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});

describe('VerificationActionButton UI Component (US-001 AC 4, US-001-T5, NR-018)', () => {
  const actions = [
    { label: 'Create Team', name: 'Create Team' },
    { label: 'Declare Availability', name: 'Declare Availability' },
    { label: 'Apply to Vacancy', name: 'Apply' },
    { label: 'Accept Invitation', name: 'Accept Invitation' },
  ];

  it('invokes onAction handler on click when participant is verified', () => {
    const handleAction = vi.fn();
    render(
      <VerificationActionButton isVerified={true} actionName="Create Team" onAction={handleAction}>
        Create Team
      </VerificationActionButton>
    );

    const button = screen.getByRole('button', { name: /create team/i });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-describedby');

    fireEvent.click(button);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it('renders with aria-disabled="true" and intercepts clicks when participant is unverified', () => {
    const handleAction = vi.fn();
    render(
      <VerificationActionButton isVerified={false} actionName="Create Team" onAction={handleAction}>
        Create Team
      </VerificationActionButton>
    );

    const button = screen.getByRole('button', { name: /create team/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-describedby', 'verification-warning');

    // Click must be intercepted: onAction must NOT be called
    fireEvent.click(button);
    expect(handleAction).not.toHaveBeenCalled();

    // Verification prompt must be displayed with actionable guidance
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/Email verification required/i);
    expect(alert).toHaveTextContent(
      /Unverified accounts cannot declare availability, create teams, apply, or accept invitations/i
    );
  });

  for (const { label, name } of actions) {
    it(`blocks unverified action and explains limitation for '${name}'`, () => {
      const handleAction = vi.fn();
      render(
        <VerificationActionButton isVerified={false} actionName={name} onAction={handleAction}>
          {label}
        </VerificationActionButton>
      );

      const button = screen.getByRole('button', { name: new RegExp(label, 'i') });
      fireEvent.click(button);

      expect(handleAction).not.toHaveBeenCalled();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(new RegExp(name, 'i'));
    });
  }

  it('does not invoke onAction when disabled prop is true even if verified', () => {
    const handleAction = vi.fn();
    render(
      <VerificationActionButton
        isVerified={true}
        actionName="Create Team"
        onAction={handleAction}
        disabled={true}
      >
        Create Team
      </VerificationActionButton>
    );

    const button = screen.getByRole('button', { name: /create team/i });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(handleAction).not.toHaveBeenCalled();
  });
});

describe('useVerificationGuard Hook', () => {
  it('permits actions and keeps prompt closed when isVerified = true', () => {
    const { result } = renderHook(() => useVerificationGuard(true));

    expect(result.current.isVerified).toBe(true);
    expect(result.current.isPromptOpen).toBe(false);

    let allowed = false;
    act(() => {
      allowed = result.current.checkActionAllowed();
    });

    expect(allowed).toBe(true);
    expect(result.current.isPromptOpen).toBe(false);
  });

  it('blocks actions and opens prompt alert when isVerified = false', () => {
    const { result } = renderHook(() => useVerificationGuard(false));

    expect(result.current.isVerified).toBe(false);
    expect(result.current.isPromptOpen).toBe(false);

    let allowed = true;
    act(() => {
      allowed = result.current.checkActionAllowed();
    });

    expect(allowed).toBe(false);
    expect(result.current.isPromptOpen).toBe(true);

    act(() => {
      result.current.dismissPrompt();
    });
    expect(result.current.isPromptOpen).toBe(false);
  });

  it('accepts options object with customMessage', () => {
    const custom = 'Custom verification required notice.';
    const { result } = renderHook(() =>
      useVerificationGuard({ isVerified: false, customMessage: custom })
    );

    expect(result.current.verificationMessage).toBe(custom);
  });

  it('allows manual triggerPrompt and dismissPrompt invocation', () => {
    const { result } = renderHook(() => useVerificationGuard(true));

    expect(result.current.isPromptOpen).toBe(false);
    act(() => {
      result.current.triggerPrompt();
    });
    expect(result.current.isPromptOpen).toBe(true);

    act(() => {
      result.current.dismissPrompt();
    });
    expect(result.current.isPromptOpen).toBe(false);
  });
});
