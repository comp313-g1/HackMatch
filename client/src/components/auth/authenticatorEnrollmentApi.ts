import { AuthRequiredError, authFetch } from '../../config/authFetch';

export interface PendingAuthenticatorEnrollment {
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
  availableChallengeMethods: ['email_otp'];
  emailOtpFallback: true;
}

export interface ActiveAuthenticatorEnrollment {
  authenticator: {
    status: 'active';
    activatedAt: string;
  };
  availableChallengeMethods: Array<'authenticator_totp' | 'email_otp'>;
  emailOtpFallback: true;
}

export type AuthenticatorEnrollmentStatus =
  | { status: 'not_enrolled' }
  | { status: 'pending'; expiresAt: string }
  | { status: 'active'; activatedAt: string };

export interface AuthenticatorEnrollmentStatusResponse {
  authenticator: AuthenticatorEnrollmentStatus;
  availableChallengeMethods: Array<'authenticator_totp' | 'email_otp'>;
  emailOtpFallback: true;
}

export class AuthenticatorEnrollmentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly fieldErrors: Record<string, string> = {}
  ) {
    super(message);
    this.name = 'AuthenticatorEnrollmentApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function invalidResponse(): never {
  throw new AuthenticatorEnrollmentApiError(
    502,
    'INVALID_RESPONSE',
    'The server returned an invalid authenticator enrollment response.'
  );
}

export function parseBeginAuthenticatorEnrollment(
  body: unknown
): PendingAuthenticatorEnrollment {
  if (!isRecord(body) || !isRecord(body.authenticator) || !isRecord(body.setup)) {
    return invalidResponse();
  }
  const { authenticator, setup } = body;
  if (
    authenticator.status !== 'pending' ||
    typeof authenticator.enrollmentId !== 'string' ||
    !authenticator.enrollmentId ||
    typeof authenticator.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(authenticator.expiresAt)) ||
    typeof authenticator.issuer !== 'string' ||
    typeof authenticator.accountLabel !== 'string' ||
    authenticator.algorithm !== 'SHA1' ||
    authenticator.digits !== 6 ||
    authenticator.periodSeconds !== 30 ||
    typeof setup.otpauthUri !== 'string' ||
    !setup.otpauthUri.startsWith('otpauth://totp/') ||
    typeof setup.manualEntryKey !== 'string' ||
    !setup.manualEntryKey ||
    body.emailOtpFallback !== true ||
    !isStringArray(body.availableChallengeMethods) ||
    body.availableChallengeMethods.length !== 1 ||
    body.availableChallengeMethods[0] !== 'email_otp'
  ) {
    return invalidResponse();
  }
  return {
    authenticator: {
      status: 'pending',
      enrollmentId: authenticator.enrollmentId,
      expiresAt: authenticator.expiresAt,
      issuer: authenticator.issuer,
      accountLabel: authenticator.accountLabel,
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
    },
    setup: {
      otpauthUri: setup.otpauthUri,
      manualEntryKey: setup.manualEntryKey,
    },
    availableChallengeMethods: ['email_otp'],
    emailOtpFallback: true,
  } as PendingAuthenticatorEnrollment;
}

export function parseConfirmAuthenticatorEnrollment(
  body: unknown
): ActiveAuthenticatorEnrollment {
  if (!isRecord(body) || !isRecord(body.authenticator)) return invalidResponse();
  const { authenticator } = body;
  if (
    authenticator.status !== 'active' ||
    typeof authenticator.activatedAt !== 'string' ||
    !Number.isFinite(Date.parse(authenticator.activatedAt)) ||
    body.emailOtpFallback !== true ||
    !isStringArray(body.availableChallengeMethods) ||
    !body.availableChallengeMethods.includes('authenticator_totp') ||
    !body.availableChallengeMethods.includes('email_otp')
  ) {
    return invalidResponse();
  }
  return {
    authenticator: { status: 'active', activatedAt: authenticator.activatedAt },
    availableChallengeMethods: ['authenticator_totp', 'email_otp'],
    emailOtpFallback: true,
  } as ActiveAuthenticatorEnrollment;
}

export function parseAuthenticatorEnrollmentStatus(
  body: unknown
): AuthenticatorEnrollmentStatusResponse {
  const methods = isRecord(body) ? body.availableChallengeMethods : null;
  if (
    !isRecord(body) ||
    !isRecord(body.authenticator) ||
    body.emailOtpFallback !== true ||
    !isStringArray(methods)
  ) {
    return invalidResponse();
  }
  const status = body.authenticator.status;
  if (
    status === 'active' &&
    (typeof body.authenticator.activatedAt !== 'string' ||
      !Number.isFinite(Date.parse(body.authenticator.activatedAt)))
  ) {
    return invalidResponse();
  }
  if (
    status === 'pending' &&
    (typeof body.authenticator.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(body.authenticator.expiresAt)))
  ) {
    return invalidResponse();
  }
  if (!['not_enrolled', 'pending', 'active'].includes(String(status))) {
    return invalidResponse();
  }
  const expectedMethods =
    status === 'active' ? ['authenticator_totp', 'email_otp'] : ['email_otp'];
  if (
    methods.length !== expectedMethods.length ||
    expectedMethods.some((method) => !methods.includes(method))
  ) {
    return invalidResponse();
  }
  const authenticator: AuthenticatorEnrollmentStatus =
    status === 'active'
      ? { status: 'active', activatedAt: body.authenticator.activatedAt as string }
      : status === 'pending'
        ? { status: 'pending', expiresAt: body.authenticator.expiresAt as string }
        : { status: 'not_enrolled' };
  return {
    authenticator,
    availableChallengeMethods:
      status === 'active' ? ['authenticator_totp', 'email_otp'] : ['email_otp'],
    emailOtpFallback: true,
  };
}

async function enrollmentRequest(
  path: string,
  init: RequestInit
): Promise<unknown> {
  let response: Response;
  try {
    response = await authFetch(path, init);
  } catch (error: unknown) {
    if (error instanceof AuthRequiredError) {
      throw new AuthenticatorEnrollmentApiError(401, error.code, error.message);
    }
    throw new AuthenticatorEnrollmentApiError(
      0,
      'NETWORK_ERROR',
      'Network error. Check your connection and try again.',
      true
    );
  }

  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    if (response.ok) return invalidResponse();
  }

  if (!response.ok) {
    const safeBody = isRecord(responseBody) ? responseBody : {};
    const rawErrors = isRecord(safeBody.errors) ? safeBody.errors : {};
    const fieldErrors = Object.fromEntries(
      Object.entries(rawErrors).filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string'
      )
    );
    throw new AuthenticatorEnrollmentApiError(
      response.status,
      typeof safeBody.code === 'string' ? safeBody.code : 'UNKNOWN_ERROR',
      typeof safeBody.error === 'string'
        ? safeBody.error
        : `Request failed with status ${response.status}.`,
      safeBody.retryable === true,
      fieldErrors
    );
  }

  return responseBody;
}

export async function beginAuthenticatorEnrollment(): Promise<PendingAuthenticatorEnrollment> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/enrollment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return parseBeginAuthenticatorEnrollment(body);
}

export async function restartAuthenticatorEnrollment(): Promise<PendingAuthenticatorEnrollment> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/enrollment/restart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return parseBeginAuthenticatorEnrollment(body);
}

export async function confirmAuthenticatorEnrollment(
  enrollmentId: string,
  code: string
): Promise<ActiveAuthenticatorEnrollment> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/enrollment/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId, code }),
  });
  return parseConfirmAuthenticatorEnrollment(body);
}

export async function getAuthenticatorEnrollmentStatus(): Promise<AuthenticatorEnrollmentStatusResponse> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/enrollment', {
    method: 'GET',
  });
  return parseAuthenticatorEnrollmentStatus(body);
}

/* ------------------------------------------------------------------------ */
/* US-029 / #269 reauthentication-gated replacement, disable, recovery codes */
/* ------------------------------------------------------------------------ */

/** Setup material for a replacement; the current factor stays active until confirmation. */
export interface PendingAuthenticatorReplacement {
  authenticator: PendingAuthenticatorEnrollment['authenticator'];
  setup: PendingAuthenticatorEnrollment['setup'];
  currentAuthenticator: { status: 'active' };
  availableChallengeMethods: ['authenticator_totp', 'email_otp'];
  emailOtpFallback: true;
}

export interface DisabledAuthenticatorResponse {
  authenticator: { status: 'not_enrolled' };
  disabledAt: string;
  availableChallengeMethods: ['email_otp'];
  emailOtpFallback: true;
}

export type RecoveryCodeStatus =
  | { status: 'not_generated'; total: 0; remaining: 0 }
  | {
      status: 'generated';
      batchId: string;
      total: number;
      remaining: number;
      generatedAt: string;
    };

export interface GeneratedRecoveryCodes {
  status: 'generated';
  batchId: string;
  total: number;
  remaining: number;
  generatedAt: string;
  /** Raw one-time codes: memory only, never stored in browser storage or URLs. */
  codes: string[];
}

const RECOVERY_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function parseBeginAuthenticatorReplacement(
  body: unknown
): PendingAuthenticatorReplacement {
  if (
    !isRecord(body) ||
    !isRecord(body.currentAuthenticator) ||
    body.currentAuthenticator.status !== 'active' ||
    !isStringArray(body.availableChallengeMethods) ||
    body.availableChallengeMethods.length !== 2 ||
    !body.availableChallengeMethods.includes('authenticator_totp') ||
    !body.availableChallengeMethods.includes('email_otp')
  ) {
    return invalidResponse();
  }
  // Reuse the #268 setup validation for the pending factor itself.
  const pending = parseBeginAuthenticatorEnrollment({
    ...body,
    availableChallengeMethods: ['email_otp'],
  });
  return {
    authenticator: pending.authenticator,
    setup: pending.setup,
    currentAuthenticator: { status: 'active' },
    availableChallengeMethods: ['authenticator_totp', 'email_otp'],
    emailOtpFallback: true,
  };
}

export function parseDisableAuthenticator(body: unknown): DisabledAuthenticatorResponse {
  if (
    !isRecord(body) ||
    !isRecord(body.authenticator) ||
    body.authenticator.status !== 'not_enrolled' ||
    typeof body.disabledAt !== 'string' ||
    !Number.isFinite(Date.parse(body.disabledAt)) ||
    body.emailOtpFallback !== true ||
    !isStringArray(body.availableChallengeMethods) ||
    body.availableChallengeMethods.length !== 1 ||
    body.availableChallengeMethods[0] !== 'email_otp'
  ) {
    return invalidResponse();
  }
  return {
    authenticator: { status: 'not_enrolled' },
    disabledAt: body.disabledAt,
    availableChallengeMethods: ['email_otp'],
    emailOtpFallback: true,
  };
}

function parseRecoveryCodeSummary(value: unknown): RecoveryCodeStatus {
  if (!isRecord(value)) return invalidResponse();
  if (value.status === 'not_generated') {
    return { status: 'not_generated', total: 0, remaining: 0 };
  }
  if (
    value.status !== 'generated' ||
    typeof value.batchId !== 'string' ||
    !UUID_PATTERN.test(value.batchId) ||
    !isCount(value.total) ||
    !isCount(value.remaining) ||
    value.remaining > value.total ||
    typeof value.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.generatedAt))
  ) {
    return invalidResponse();
  }
  return {
    status: 'generated',
    batchId: value.batchId,
    total: value.total,
    remaining: value.remaining,
    generatedAt: value.generatedAt,
  };
}

/** Status never carries codes; any `codes` field is dropped by explicit projection. */
export function parseRecoveryCodeStatus(body: unknown): RecoveryCodeStatus {
  if (!isRecord(body)) return invalidResponse();
  return parseRecoveryCodeSummary(body.recoveryCodes);
}

export function parseGeneratedRecoveryCodes(body: unknown): GeneratedRecoveryCodes {
  if (!isRecord(body) || !isRecord(body.recoveryCodes)) return invalidResponse();
  const summary = parseRecoveryCodeSummary(body.recoveryCodes);
  const codes = body.recoveryCodes.codes;
  if (
    summary.status !== 'generated' ||
    !isStringArray(codes) ||
    codes.length === 0 ||
    codes.length !== summary.total ||
    new Set(codes).size !== codes.length ||
    !codes.every((code) => RECOVERY_CODE_PATTERN.test(code))
  ) {
    return invalidResponse();
  }
  return { ...summary, codes: [...codes] };
}

export interface ConfirmedAuthenticatorReplacement {
  authenticator: { status: 'active'; activatedAt: string };
  /** Fresh set issued in the same transaction that revoked the previous one. Shown once. */
  recoveryCodes: GeneratedRecoveryCodes;
  availableChallengeMethods: ['authenticator_totp', 'email_otp'];
  emailOtpFallback: true;
}

export function parseConfirmAuthenticatorReplacement(
  body: unknown
): ConfirmedAuthenticatorReplacement {
  if (!isRecord(body)) return invalidResponse();
  const active = parseConfirmAuthenticatorEnrollment(body);
  const recoveryCodes = parseGeneratedRecoveryCodes({ recoveryCodes: body.recoveryCodes });
  return {
    authenticator: active.authenticator,
    recoveryCodes,
    availableChallengeMethods: ['authenticator_totp', 'email_otp'],
    emailOtpFallback: true,
  };
}

export async function confirmAuthenticatorReplacement(
  enrollmentId: string,
  code: string
): Promise<ConfirmedAuthenticatorReplacement> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/replacement/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId, code }),
  });
  return parseConfirmAuthenticatorReplacement(body);
}

export async function beginAuthenticatorReplacement(): Promise<PendingAuthenticatorReplacement> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/replacement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return parseBeginAuthenticatorReplacement(body);
}

export async function disableAuthenticator(): Promise<DisabledAuthenticatorResponse> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return parseDisableAuthenticator(body);
}

export async function getRecoveryCodeStatus(): Promise<RecoveryCodeStatus> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/recovery-codes', {
    method: 'GET',
  });
  return parseRecoveryCodeStatus(body);
}

/**
 * Generates (or regenerates) the owner's recovery set. `expectedBatchId` is the
 * batch this view last saw (null = none) so a concurrent change elsewhere is
 * rejected instead of silently invalidating codes another session displays.
 */
export async function generateRecoveryCodes(
  expectedBatchId: string | null
): Promise<GeneratedRecoveryCodes> {
  const body = await enrollmentRequest('/api/auth/mfa/authenticator/recovery-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedBatchId }),
  });
  return parseGeneratedRecoveryCodes(body);
}
