import {
  AUTHENTICATOR_TOTP_POLICY,
  AuthenticatorEnrollmentError,
  type AuthenticatorOwnerContext,
  type BeginAuthenticatorEnrollmentProviderResult,
  type MfaChallengeMethod,
} from './authenticatorEnrollment.js';

/**
 * US-029 / #269 reauthentication-gated controls for an active authenticator.
 *
 * Every operation is mounted behind the #266 owner chain (Firebase auth, active
 * account, current-session email MFA, PART/ADMIN, recent primary sign-in), so
 * the server — not the browser — decides when reauthentication is required.
 *
 * - Replacement creates a pending factor beside the active one. The active
 *   factor and its recovery codes keep working until the replacement code is
 *   confirmed; that single transaction retires the old factor, revokes the
 *   old recovery set, and stores a fresh set returned to the owner once. A
 *   failed, cancelled, or expired replacement changes neither.
 * - Disabling retires the active factor and revokes its recovery set together.
 *   Email OTP is never changed and stays the mandatory fallback.
 * - Recovery codes are generated server-side, returned exactly once, and stored
 *   only as keyed verifiers. Recovery-code *sign-in use* is intentionally not
 *   part of #269: no login path accepts a second factor other than email OTP.
 */

export interface RecoveryCodeProviderStatus {
  status: 'not_generated' | 'generated';
  batchId: string | null;
  total: number;
  remaining: number;
  generatedAt: string | null;
}

export interface GeneratedRecoveryCodesProviderResult {
  /** Raw one-time codes. Owner-only, never logged, never persisted. */
  codes: string[];
  batchId: string;
  generatedAt: string;
}

export interface ConfirmedReplacementProviderResult {
  activatedAt: string;
  recoveryCodes: GeneratedRecoveryCodesProviderResult;
}

export interface AuthenticatorRecoveryControlsProvider {
  replace(owner: AuthenticatorOwnerContext): Promise<BeginAuthenticatorEnrollmentProviderResult>;
  /**
   * Verifies the new factor's code, then atomically retires the old factor,
   * activates the new one, revokes the old recovery set, and stores a fresh one.
   */
  confirmReplacement(
    owner: AuthenticatorOwnerContext,
    enrollmentId: string,
    code: string
  ): Promise<ConfirmedReplacementProviderResult>;
  disable(owner: AuthenticatorOwnerContext): Promise<{ disabledAt: string }>;
  getRecoveryCodeStatus(owner: AuthenticatorOwnerContext): Promise<RecoveryCodeProviderStatus>;
  generateRecoveryCodes(
    owner: AuthenticatorOwnerContext,
    expectedBatchId: string | null
  ): Promise<GeneratedRecoveryCodesProviderResult>;
}

export interface BeginAuthenticatorReplacementResult {
  authenticator: {
    status: 'pending';
    enrollmentId: string;
    expiresAt: string;
    issuer: string;
    accountLabel: string;
    algorithm: 'SHA1';
    digits: 6;
    periodSeconds: 30;
  };
  setup: {
    otpauthUri: string;
    manualEntryKey: string;
  };
  /** The current factor stays active until the replacement is confirmed. */
  currentAuthenticator: { status: 'active' };
  availableChallengeMethods: MfaChallengeMethod[];
  emailOtpFallback: true;
}

export interface ConfirmAuthenticatorReplacementResult {
  authenticator: { status: 'active'; activatedAt: string };
  /** The previous set was revoked in the same transaction; these are shown once. */
  recoveryCodes: GenerateRecoveryCodesResult['recoveryCodes'];
  availableChallengeMethods: ['authenticator_totp', 'email_otp'];
  emailOtpFallback: true;
}

export interface DisableAuthenticatorResult {
  authenticator: { status: 'not_enrolled' };
  disabledAt: string;
  recoveryCodes: { status: 'not_generated'; total: 0; remaining: 0 };
  availableChallengeMethods: ['email_otp'];
  emailOtpFallback: true;
}

export interface RecoveryCodeStatusResult {
  recoveryCodes:
    | { status: 'not_generated'; total: 0; remaining: 0 }
    | {
        status: 'generated';
        batchId: string;
        total: number;
        remaining: number;
        generatedAt: string;
      };
}

export interface GenerateRecoveryCodesResult {
  recoveryCodes: {
    status: 'generated';
    batchId: string;
    total: number;
    remaining: number;
    generatedAt: string;
    /** Shown once. Subsequent status responses never include codes. */
    codes: string[];
  };
}

const persistentProvider: AuthenticatorRecoveryControlsProvider = {
  async replace(owner) {
    const { persistentAuthenticatorRecoveryControlsProvider } = await import(
      './persistentAuthenticatorRecoveryControlsProvider.js'
    );
    return persistentAuthenticatorRecoveryControlsProvider.replace(owner);
  },
  async confirmReplacement(owner, enrollmentId, code) {
    const { persistentAuthenticatorRecoveryControlsProvider } = await import(
      './persistentAuthenticatorRecoveryControlsProvider.js'
    );
    return persistentAuthenticatorRecoveryControlsProvider.confirmReplacement(
      owner,
      enrollmentId,
      code
    );
  },
  async disable(owner) {
    const { persistentAuthenticatorRecoveryControlsProvider } = await import(
      './persistentAuthenticatorRecoveryControlsProvider.js'
    );
    return persistentAuthenticatorRecoveryControlsProvider.disable(owner);
  },
  async getRecoveryCodeStatus(owner) {
    const { persistentAuthenticatorRecoveryControlsProvider } = await import(
      './persistentAuthenticatorRecoveryControlsProvider.js'
    );
    return persistentAuthenticatorRecoveryControlsProvider.getRecoveryCodeStatus(owner);
  },
  async generateRecoveryCodes(owner, expectedBatchId) {
    const { persistentAuthenticatorRecoveryControlsProvider } = await import(
      './persistentAuthenticatorRecoveryControlsProvider.js'
    );
    return persistentAuthenticatorRecoveryControlsProvider.generateRecoveryCodes(
      owner,
      expectedBatchId
    );
  },
};

let controlsProvider: AuthenticatorRecoveryControlsProvider = persistentProvider;

/** Test/provider seam; production uses protected PostgreSQL persistence. */
export function _setAuthenticatorRecoveryControlsProvider(
  provider: AuthenticatorRecoveryControlsProvider
): void {
  controlsProvider = provider;
}

export function _resetAuthenticatorRecoveryControlsProvider(): void {
  controlsProvider = persistentProvider;
}

function normalizeProviderError(error: unknown): AuthenticatorEnrollmentError {
  if (error instanceof AuthenticatorEnrollmentError) return error;
  return new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_UNAVAILABLE', 503);
}

export async function beginAuthenticatorReplacement(
  owner: AuthenticatorOwnerContext
): Promise<BeginAuthenticatorReplacementResult> {
  try {
    const pending = await controlsProvider.replace(owner);
    return {
      authenticator: {
        status: 'pending',
        enrollmentId: pending.enrollmentId,
        expiresAt: pending.expiresAt,
        issuer: AUTHENTICATOR_TOTP_POLICY.issuer,
        accountLabel: pending.accountLabel,
        algorithm: AUTHENTICATOR_TOTP_POLICY.algorithm,
        digits: AUTHENTICATOR_TOTP_POLICY.digits,
        periodSeconds: AUTHENTICATOR_TOTP_POLICY.periodSeconds,
      },
      setup: {
        otpauthUri: pending.otpauthUri,
        manualEntryKey: pending.manualEntryKey,
      },
      currentAuthenticator: { status: 'active' },
      // The still-active factor remains a valid method; the pending one is not.
      availableChallengeMethods: ['authenticator_totp', 'email_otp'],
      emailOtpFallback: true,
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}

export async function confirmAuthenticatorReplacement(
  owner: AuthenticatorOwnerContext,
  enrollmentId: string,
  code: string
): Promise<ConfirmAuthenticatorReplacementResult> {
  // Defense in depth: route validation also enforces this.
  if (!/^\d{6}$/.test(code)) {
    throw new AuthenticatorEnrollmentError('INVALID_AUTHENTICATOR_CODE', 400);
  }
  try {
    const confirmed = await controlsProvider.confirmReplacement(owner, enrollmentId, code);
    const codes = [...confirmed.recoveryCodes.codes];
    return {
      authenticator: { status: 'active', activatedAt: confirmed.activatedAt },
      recoveryCodes: {
        status: 'generated',
        batchId: confirmed.recoveryCodes.batchId,
        total: codes.length,
        remaining: codes.length,
        generatedAt: confirmed.recoveryCodes.generatedAt,
        codes,
      },
      availableChallengeMethods: ['authenticator_totp', 'email_otp'],
      emailOtpFallback: true,
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}

export async function disableAuthenticator(
  owner: AuthenticatorOwnerContext
): Promise<DisableAuthenticatorResult> {
  try {
    const disabled = await controlsProvider.disable(owner);
    return {
      authenticator: { status: 'not_enrolled' },
      disabledAt: disabled.disabledAt,
      recoveryCodes: { status: 'not_generated', total: 0, remaining: 0 },
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}

export async function getRecoveryCodeStatus(
  owner: AuthenticatorOwnerContext
): Promise<RecoveryCodeStatusResult> {
  try {
    const status = await controlsProvider.getRecoveryCodeStatus(owner);
    if (status.status !== 'generated' || !status.batchId || !status.generatedAt) {
      return { recoveryCodes: { status: 'not_generated', total: 0, remaining: 0 } };
    }
    return {
      recoveryCodes: {
        status: 'generated',
        batchId: status.batchId,
        total: status.total,
        remaining: status.remaining,
        generatedAt: status.generatedAt,
      },
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}

export async function generateRecoveryCodes(
  owner: AuthenticatorOwnerContext,
  expectedBatchId: string | null
): Promise<GenerateRecoveryCodesResult> {
  try {
    const generated = await controlsProvider.generateRecoveryCodes(owner, expectedBatchId);
    return {
      recoveryCodes: {
        status: 'generated',
        batchId: generated.batchId,
        total: generated.codes.length,
        remaining: generated.codes.length,
        generatedAt: generated.generatedAt,
        codes: [...generated.codes],
      },
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}
