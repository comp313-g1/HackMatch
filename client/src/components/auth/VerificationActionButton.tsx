import React, { useState } from 'react';

export interface VerificationActionButtonProps {
  isVerified: boolean;
  actionName: string;
  onAction: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

/**
 * Accessible action button component enforcing US-001 AC 4, US-001-T5, and NR-018.
 * When unverified, attaches aria-disabled="true" and intercepts clicks to display
 * an accessible warning prompt without invoking the protected action.
 */
export function VerificationActionButton({
  isVerified,
  actionName,
  onAction,
  children,
  className = '',
  disabled = false,
  type = 'button',
}: VerificationActionButtonProps): React.JSX.Element {
  const [showPrompt, setShowPrompt] = useState<boolean>(false);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isVerified) {
      e.preventDefault();
      e.stopPropagation();
      setShowPrompt(true);
      return;
    }

    onAction();
  };

  const buttonStyle = !isVerified
    ? 'opacity-60 cursor-not-allowed bg-gray-300 text-gray-600'
    : '';

  return (
    <div className="inline-flex flex-col items-start">
      <button
        type={type}
        disabled={disabled}
        aria-disabled={!isVerified ? 'true' : undefined}
        aria-describedby={!isVerified ? 'verification-warning' : undefined}
        onClick={handleClick}
        className={`${className} ${buttonStyle}`.trim()}
      >
        {children}
      </button>

      {!isVerified && (
        <div
          id="verification-warning"
          role="alert"
          aria-live="polite"
          className={
            showPrompt
              ? 'mt-2 p-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-md shadow-sm'
              : 'sr-only'
          }
        >
          <span className="font-semibold">Email verification required:</span> Unverified accounts
          cannot {actionName.toLowerCase()}. Unverified accounts cannot declare availability, create teams, apply, or accept invitations.
        </div>
      )}
    </div>
  );
}
