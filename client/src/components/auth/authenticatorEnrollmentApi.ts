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
