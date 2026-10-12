import { useState, useCallback } from 'react';

export const DEFAULT_VERIFICATION_MESSAGE =
  'Email verification required. Unverified accounts cannot declare availability, create teams, apply, or accept invitations.';

export interface UseVerificationGuardOptions {
  isVerified: boolean;
  customMessage?: string;
}

export interface UseVerificationGuardResult {
  isVerified: boolean;
  checkActionAllowed: () => boolean;
  verificationMessage: string;
  isPromptOpen: boolean;
  triggerPrompt: () => void;
  dismissPrompt: () => void;
}

/**
 * React hook enforcing verification-guarded interactions per US-001 AC 4, US-001-T5, and FR-002.
 * Provides verification state, an action gate function, and alert prompt management.
 */
export function useVerificationGuard(
  optionsOrIsVerified: boolean | UseVerificationGuardOptions
): UseVerificationGuardResult {
  const isVerified =
    typeof optionsOrIsVerified === 'boolean'
      ? optionsOrIsVerified
      : optionsOrIsVerified.isVerified;

  const customMessage =
    typeof optionsOrIsVerified === 'object' ? optionsOrIsVerified.customMessage : undefined;

  const verificationMessage = customMessage || DEFAULT_VERIFICATION_MESSAGE;
  const [isPromptOpen, setIsPromptOpen] = useState<boolean>(false);

  const triggerPrompt = useCallback(() => {
    setIsPromptOpen(true);
  }, []);

  const dismissPrompt = useCallback(() => {
    setIsPromptOpen(false);
  }, []);

  const checkActionAllowed = useCallback((): boolean => {
    if (!isVerified) {
      setIsPromptOpen(true);
      return false;
    }
    return true;
  }, [isVerified]);

  return {
    isVerified,
    checkActionAllowed,
    verificationMessage,
    isPromptOpen,
    triggerPrompt,
    dismissPrompt,
  };
}
