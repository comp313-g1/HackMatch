import React, { useState, useEffect, useCallback } from 'react';
import { validateEmail } from './validation';

export interface ReplacementLinkFormProps {
  initialEmail?: string;
  onSuccess?: (email: string) => void;
  onCancel?: () => void;
}

const COOLDOWN_DURATION_SECONDS = 60;

/**
 * Encapsulated replacement-link request form satisfying US-001 AC 3,
 * US-001-T4, FR-081, FR-084, NR-017 (data retention), and NR-018 (WCAG 2.1 AA).
 */
export function ReplacementLinkForm({
  initialEmail = '',
  onSuccess,
  onCancel,
}: ReplacementLinkFormProps): React.JSX.Element {
  const [email, setEmail] = useState<string>(initialEmail);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);

  // Sync with initialEmail prop when changed
  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  // Check remaining cooldown from sessionStorage for a given email
  const checkCooldown = useCallback((targetEmail: string) => {
    const normalized = targetEmail.trim().toLowerCase();
    if (!normalized) return;

    try {
      const storageKey = `hackmatch_resend_cooldown_${normalized}`;
      const savedExpiry = sessionStorage.getItem(storageKey);
      if (savedExpiry) {
        const remainingMs = Number(savedExpiry) - Date.now();
        if (remainingMs > 0) {
          setCooldownSeconds(Math.ceil(remainingMs / 1000));
        } else {
          sessionStorage.removeItem(storageKey);
          setCooldownSeconds(0);
        }
      }
    } catch {
      // Graceful fallback if sessionStorage is inaccessible (e.g. strict privacy mode)
    }
  }, []);

  // Check cooldown on mount or when initialEmail is provided
  useEffect(() => {
    if (initialEmail) {
      checkCooldown(initialEmail);
    }
  }, [initialEmail, checkCooldown]);

  // Countdown timer effect
  useEffect(() => {
    if (cooldownSeconds <= 0) return;

    const timer = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const startCooldown = (targetEmail: string) => {
    const normalized = targetEmail.trim().toLowerCase();
    setCooldownSeconds(COOLDOWN_DURATION_SECONDS);

    try {
      const storageKey = `hackmatch_resend_cooldown_${normalized}`;
      const expiry = Date.now() + COOLDOWN_DURATION_SECONDS * 1000;
      sessionStorage.setItem(storageKey, String(expiry));
    } catch {
      // Graceful fallback if sessionStorage is restricted
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);

    // 1. Validation (retaining entered email per NR-017)
    const error = validateEmail(email);
    if (error) {
      setFieldError(error);
      return;
    }

    if (cooldownSeconds > 0) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        setIsSuccess(true);
        startCooldown(normalizedEmail);
        if (onSuccess) {
          onSuccess(normalizedEmail);
        }
      } else if (response.status === 429) {
        setFormError('Too many requests. Please wait a few minutes before trying again.');
        startCooldown(normalizedEmail);
      } else {
        // FR-084: Authentication email delivery failure feedback
        setFormError(data?.error || 'Failed to send verification email. Please try again.');
      }
    } catch {
      // Transient network failure
      setFormError('Network error. Please check your internet connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">
        Request Replacement Verification Link
      </h3>
      <p className="text-sm text-ink-muted mb-4">
        Enter your registered email address to receive a new verification link.
      </p>

      {/* FR-081 Anti-enumeration confirmation message */}
      {isSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 text-sm rounded-md"
        >
          If an account exists for this address, a new verification link has been sent. Please check your inbox and spam folder.
        </div>
      )}

      {/* General form error alert (FR-084, network errors, rate limiting) */}
      {formError && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-md"
        >
          {formError}
        </div>
      )}

      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="replacement-email" className="block text-sm font-medium text-ink mb-1">
            Email Address
          </label>
          <input
            id="replacement-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? 'replacement-email-error' : undefined}
            className={`block w-full px-3 py-2 border rounded-md shadow-sm sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest ${
              fieldError ? 'border-red-300 text-red-900' : 'border-cream-200 text-ink'
            }`}
            placeholder="you@example.com"
          />
          {fieldError && (
            <div id="replacement-email-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldError}
            </div>
          )}
        </div>

        {/* Cooldown notice (not in aria-live to avoid screen-reader polling spam per NR-018) */}
        {cooldownSeconds > 0 && (
          <p className="text-xs text-ink-muted">
            Please wait {cooldownSeconds} second{cooldownSeconds === 1 ? '' : 's'} before requesting another link.
          </p>
        )}

        <div className="flex items-center space-x-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting || cooldownSeconds > 0}
            className="flex-1 py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? 'Sending Link...'
              : cooldownSeconds > 0
              ? `Resend Link (${cooldownSeconds}s)`
              : 'Send Verification Link'}
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="py-2 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
