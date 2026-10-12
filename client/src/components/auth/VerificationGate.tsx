import React from 'react';

export interface VerificationGateProps {
  isVerified: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  resendHref?: string;
}

/**
 * Accessible UI boundary gate component per US-001 AC 4, US-001-T5, and NR-018.
 * Conditionally renders protected child components when verified, or renders
 * an accessible warning alert banner with actionable resend guidance when unverified.
 */
export function VerificationGate({
  isVerified,
  children,
  fallback,
  resendHref = '/resend-verification',
}: VerificationGateProps): React.JSX.Element {
  if (isVerified) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <div
      id="verification-warning"
      role="alert"
      aria-live="polite"
      className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-md shadow-sm"
    >
      <div className="flex items-start">
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-amber-800">Email Verification Required</h4>
          <p className="mt-1 text-sm text-amber-700">
            Unverified accounts cannot declare availability, create teams, apply, or accept invitations.
            Please verify your email address to access team formation features.
          </p>
          <div className="mt-3">
            <a
              href={resendHref}
              className="text-sm font-medium text-amber-800 underline hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500 rounded"
            >
              Resend verification email
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
