import type { ParticipantRole } from '../db/types.js';

/**
 * US-029 / #266 approved TOTP contract.
 *
 * HackMatch keeps Firebase Authentication as the primary identity provider and
 * owns the second-factor policy in the application.  The provider implemented
 * by #267 persists pending/active TOTP credentials securely. This contract
 * remains storage-agnostic so encrypted storage details cannot enter API DTOs.
 *
 * Approved lifecycle:
 * not_enrolled -> pending -> active. A pending enrollment that expires, is
 * cancelled, or is replaced never becomes active. Replacing/disabling an
 * active factor requires the #269 reauthentication/recovery flow, and the old
 * active factor must survive until its replacement is confirmed.
 */
export const AUTHENTICATOR_TOTP_POLICY = Object.freeze({
  issuer: 'HackMatch',
  algorithm: 'SHA1' as const,
  digits: 6 as const,
  periodSeconds: 30 as const,
});

export type AuthenticatorEnrollmentStatus = 'not_enrolled' | 'pending' | 'active';
export type MfaChallengeMethod = 'authenticator_totp' | 'email_otp';

export type AuthenticatorEnrollmentErrorCode =
  | 'AUTHENTICATOR_ALREADY_ACTIVE'
  | 'AUTHENTICATOR_ENROLLMENT_PENDING'
  | 'AUTHENTICATOR_ENROLLMENT_NOT_PENDING'
  | 'AUTHENTICATOR_ENROLLMENT_EXPIRED'
  | 'AUTHENTICATOR_ENROLLMENT_STALE'
  | 'INVALID_AUTHENTICATOR_CODE'
  | 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE'
  | 'AUTHENTICATOR_CONFIGURATION_ERROR';

export class AuthenticatorEnrollmentError extends Error {
  constructor(
    public readonly code: AuthenticatorEnrollmentErrorCode,
    public readonly status: number
  ) {
    super(code);
    this.name = 'AuthenticatorEnrollmentError';
  }
}

export interface AuthenticatorOwnerContext {
  participantId: string;
  firebaseUid: string;
  role: ParticipantRole;
}

export interface BeginAuthenticatorEnrollmentProviderResult {
  enrollmentId: string;
  expiresAt: string;
  /**
   * Owner-only setup material. Both fields contain the TOTP credential and
   * must never be logged, stored in profiles, or returned after confirmation.
   */
  otpauthUri: string;
  manualEntryKey: string;
  /** Safe label displayed by an authenticator app; must not contain email/Firebase UID. */
  accountLabel: string;
}

export interface ConfirmAuthenticatorEnrollmentProviderResult {
  activatedAt: string;
}

export type AuthenticatorEnrollmentProviderStatus =
  | { status: 'not_enrolled' }
  | { status: 'pending'; expiresAt: string }
  | { status: 'active'; activatedAt: string };

/**
 * #267 supplies the durable implementation. Implementations must atomically
 * enforce one current enrollment per participant, pending expiry, and
 * confirm-before-activate semantics. Failed confirmation must leave any
 * existing active credential and email OTP fallback unchanged.
 */
export interface AuthenticatorEnrollmentProvider {
  getStatus(
    owner: AuthenticatorOwnerContext
  ): Promise<AuthenticatorEnrollmentProviderStatus>;
  begin(
    owner: AuthenticatorOwnerContext
  ): Promise<BeginAuthenticatorEnrollmentProviderResult>;
  restart(
    owner: AuthenticatorOwnerContext
  ): Promise<BeginAuthenticatorEnrollmentProviderResult>;
  confirm(
    owner: AuthenticatorOwnerContext,
    enrollmentId: string,
    code: string
  ): Promise<ConfirmAuthenticatorEnrollmentProviderResult>;
}

export interface BeginAuthenticatorEnrollmentResult {
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
  availableChallengeMethods: MfaChallengeMethod[];
  emailOtpFallback: true;
}

export interface ConfirmAuthenticatorEnrollmentResult {
  authenticator: {
    status: 'active';
    activatedAt: string;
  };
  availableChallengeMethods: MfaChallengeMethod[];
  emailOtpFallback: true;
}

export interface AuthenticatorEnrollmentStatusResult {
  authenticator: AuthenticatorEnrollmentProviderStatus;
  availableChallengeMethods: MfaChallengeMethod[];
  emailOtpFallback: true;
}

const persistentProvider: AuthenticatorEnrollmentProvider = {
  async getStatus(owner) {
    const { persistentAuthenticatorEnrollmentProvider } = await import(
      './persistentAuthenticatorEnrollmentProvider.js'
    );
    return persistentAuthenticatorEnrollmentProvider.getStatus(owner);
  },
  async begin(owner) {
    const { persistentAuthenticatorEnrollmentProvider } = await import(
      './persistentAuthenticatorEnrollmentProvider.js'
    );
    return persistentAuthenticatorEnrollmentProvider.begin(owner);
  },
  async restart(owner) {
    const { persistentAuthenticatorEnrollmentProvider } = await import(
      './persistentAuthenticatorEnrollmentProvider.js'
    );
    return persistentAuthenticatorEnrollmentProvider.restart(owner);
  },
  async confirm(owner, enrollmentId, code) {
    const { persistentAuthenticatorEnrollmentProvider } = await import(
      './persistentAuthenticatorEnrollmentProvider.js'
    );
    return persistentAuthenticatorEnrollmentProvider.confirm(owner, enrollmentId, code);
  },
};

let enrollmentProvider: AuthenticatorEnrollmentProvider = persistentProvider;

/** Test/provider seam; production uses #267 protected PostgreSQL persistence. */
export function _setAuthenticatorEnrollmentProvider(
  provider: AuthenticatorEnrollmentProvider
): void {
  enrollmentProvider = provider;
}

export function _resetAuthenticatorEnrollmentProvider(): void {
  enrollmentProvider = persistentProvider;
}

function normalizeProviderError(error: unknown): AuthenticatorEnrollmentError {
  if (error instanceof AuthenticatorEnrollmentError) return error;
  return new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_UNAVAILABLE', 503);
}

export async function getAuthenticatorEnrollmentStatus(
  owner: AuthenticatorOwnerContext
): Promise<AuthenticatorEnrollmentStatusResult> {
  try {
    const providerStatus = await enrollmentProvider.getStatus(owner);
    // Explicit projection prevents repository/provider fields from reaching the client.
    const authenticator: AuthenticatorEnrollmentProviderStatus =
      providerStatus.status === 'active'
        ? { status: 'active', activatedAt: providerStatus.activatedAt }
        : providerStatus.status === 'pending'
          ? { status: 'pending', expiresAt: providerStatus.expiresAt }
          : { status: 'not_enrolled' };
    return {
      authenticator,
      availableChallengeMethods:
        authenticator.status === 'active'
          ? ['authenticator_totp', 'email_otp']
          : ['email_otp'],
      emailOtpFallback: true,
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}

export async function beginAuthenticatorEnrollment(
  owner: AuthenticatorOwnerContext
): Promise<BeginAuthenticatorEnrollmentResult> {
  try {
    const pending = await enrollmentProvider.begin(owner);

    // Explicit projection: unknown provider fields can never become API output.
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
      // An unconfirmed factor cannot be offered as a challenge method.
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}

export async function restartAuthenticatorEnrollment(
  owner: AuthenticatorOwnerContext
): Promise<BeginAuthenticatorEnrollmentResult> {
  try {
    const pending = await enrollmentProvider.restart(owner);
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
      availableChallengeMethods: ['email_otp'],
      emailOtpFallback: true,
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}

export async function confirmAuthenticatorEnrollment(
  owner: AuthenticatorOwnerContext,
  enrollmentId: string,
  code: string
): Promise<ConfirmAuthenticatorEnrollmentResult> {
  // Defense in depth: route validation also enforces this and strips whitespace.
  if (!/^\d{6}$/.test(code)) {
    throw new AuthenticatorEnrollmentError('INVALID_AUTHENTICATOR_CODE', 400);
  }

  try {
    const active = await enrollmentProvider.confirm(owner, enrollmentId, code);

    return {
      authenticator: {
        status: 'active',
        activatedAt: active.activatedAt,
      },
      // Email OTP is intentionally retained as the approved fallback.
      availableChallengeMethods: ['authenticator_totp', 'email_otp'],
      emailOtpFallback: true,
    };
  } catch (error: unknown) {
    throw normalizeProviderError(error);
  }
}
