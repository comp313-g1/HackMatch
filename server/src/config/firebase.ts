import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { config } from './index.js';

let appInstance: App | null = null;
let authInstance: Auth | null = null;

/**
 * Resets the cached singleton instances (primarily for testing purposes).
 */
export function _resetFirebaseInstances(): void {
  appInstance = null;
  authInstance = null;
}

/**
 * Returns the Firebase Admin Auth instance.
 * If credentials are missing, returns an offline-safe proxy that raises a descriptive
 * error ONLY when an active authentication operation or property is accessed.
 */
export function getFirebaseAdminAuth(): Auth {
  const projectId = config.firebase.projectId || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = config.firebase.clientEmail || process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = config.firebase.privateKey || process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawPrivateKey) {
    return new Proxy({} as Auth, {
      get(_target, prop) {
        throw new Error(
          `[Firebase Admin Error] Cannot access property '${String(prop)}': Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY environment variables.`
        );
      },
    });
  }

  if (!authInstance) {
    const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
    const existingApps = getApps();

    if (existingApps.length === 0) {
      appInstance = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } else {
      appInstance = existingApps[0]!;
    }
    authInstance = getAuth(appInstance);
  }

  return authInstance;
}

export interface VerifiedActionCodeResult {
  email: string;
  uid?: string;
}

interface FirebaseAuthErrorLike extends Error {
  code: string;
}

function createAuthError(message: string, code: string): FirebaseAuthErrorLike {
  const error = new Error(message) as FirebaseAuthErrorLike;
  error.code = code;
  return error;
}

/**
 * Verifies an email verification action code (oobCode) via Firebase Identity Platform.
 * In a deployed environment, communicates with the Identity Toolkit REST API.
 * Sanitizes and maps errors strictly to Firebase Auth error codes (e.g., auth/expired-action-code,
 * auth/invalid-action-code) while ensuring sensitive oobCodes are never logged per NR-021.
 */
export async function verifyEmailActionCode(oobCode: string): Promise<VerifiedActionCodeResult> {
  if (!oobCode || typeof oobCode !== 'string' || oobCode.trim() === '') {
    throw createAuthError('The action code is invalid or missing.', 'auth/invalid-action-code');
  }

  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;

  if (!apiKey) {
    throw createAuthError(
      '[Firebase Error] FIREBASE_WEB_API_KEY is not configured to verify out-of-band action codes.',
      'auth/configuration-error'
    );
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ oobCode: oobCode.trim() }),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = (data.error && typeof data.error === 'object' ? data.error : {}) as Record<string, unknown>;
      const message = String(errObj.message || '');

      let code = 'auth/invalid-action-code';
      if (message.includes('EXPIRED_OOB_CODE')) {
        code = 'auth/expired-action-code';
      } else if (message.includes('INVALID_OOB_CODE')) {
        code = 'auth/invalid-action-code';
      } else if (message.includes('USER_DISABLED')) {
        code = 'auth/user-disabled';
      }
      throw createAuthError('Action code verification failed.', code);
    }

    const email = String(data.email || '');
    const uid = data.localId ? String(data.localId) : undefined;

    return { email, uid };
  } catch (err: unknown) {
    const errCode = err && typeof err === 'object' && 'code' in err ? (err as Record<string, unknown>).code : '';
    if (errCode) {
      throw err;
    }
    throw createAuthError('Failed to verify action code due to network or service error.', 'auth/network-request-failed');
  }
}

/**
 * Dispatches an email verification message directly to the recipient's inbox
 * using Firebase Authentication's native Identity Toolkit mail service.
 *
 * Flow:
 * 1. Resolves user record and generates a scoped custom token via Firebase Admin Auth.
 * 2. Exchanges custom token for an ID token via Identity Toolkit signInWithCustomToken.
 * 3. Triggers out-of-band email dispatch via Identity Toolkit sendOobCode (requestType: VERIFY_EMAIL).
 *
 * Guarantees zero passwords, tokens, or action codes in logs (NR-021).
 */
export async function sendVerificationEmail(
  email: string,
  actionCodeSettings?: { url?: string },
  authClientOverride?: Auth
): Promise<void> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;

  if (!apiKey) {
    throw createAuthError(
      '[Firebase Error] FIREBASE_WEB_API_KEY is not configured to dispatch verification emails.',
      'auth/configuration-error'
    );
  }

  const authClient = authClientOverride || getFirebaseAdminAuth();
  const user = await authClient.getUserByEmail(email);
  const customToken = await authClient.createCustomToken(user.uid);

  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  const signInRes = await fetch(signInUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });

  if (!signInRes.ok) {
    const errorData = (await signInRes.json().catch(() => ({}))) as Record<string, unknown>;
    const errMsg = (errorData.error && typeof errorData.error === 'object' && 'message' in (errorData.error as Record<string, unknown>))
      ? String((errorData.error as Record<string, unknown>).message)
      : 'Authentication token exchange failed';
    throw createAuthError(`Firebase token exchange failed: ${errMsg}`, 'auth/network-request-failed');
  }

  const { idToken } = (await signInRes.json()) as { idToken: string };

  const sendOobUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;
  const sendPayload: Record<string, unknown> = {
    requestType: 'VERIFY_EMAIL',
    idToken,
  };

  if (actionCodeSettings?.url) {
    sendPayload.continueUrl = actionCodeSettings.url;
  }

  const sendRes = await fetch(sendOobUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sendPayload),
  });

  if (!sendRes.ok) {
    const errorData = (await sendRes.json().catch(() => ({}))) as Record<string, unknown>;
    const errMsg = (errorData.error && typeof errorData.error === 'object' && 'message' in (errorData.error as Record<string, unknown>))
      ? String((errorData.error as Record<string, unknown>).message)
      : 'Email dispatch failed';
    throw createAuthError(`Firebase email dispatch failed: ${errMsg}`, 'auth/network-request-failed');
  }
}

/**
 * Dispatches a Firebase-managed password-reset email (US-005 / FR-011).
 *
 * Uses Identity Toolkit `accounts:sendOobCode` with `requestType: PASSWORD_RESET`.
 * Link expiry and single-use semantics are Firebase-managed (~60 minutes per FR-011).
 * Never logs the oobCode or continue URL query secrets (NR-021).
 */
export async function sendPasswordResetEmail(
  email: string,
  actionCodeSettings?: { url?: string }
): Promise<void> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;

  if (!apiKey) {
    throw createAuthError(
      '[Firebase Error] FIREBASE_WEB_API_KEY is not configured to dispatch password-reset emails.',
      'auth/configuration-error'
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw createAuthError('Email address is required for password reset.', 'auth/invalid-email');
  }

  const sendOobUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;
  const sendPayload: Record<string, unknown> = {
    requestType: 'PASSWORD_RESET',
    email: normalizedEmail,
  };

  if (actionCodeSettings?.url) {
    sendPayload.continueUrl = actionCodeSettings.url;
  }

  const sendRes = await fetch(sendOobUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sendPayload),
  });

  if (!sendRes.ok) {
    const errorData = (await sendRes.json().catch(() => ({}))) as Record<string, unknown>;
    const errObj =
      errorData.error && typeof errorData.error === 'object'
        ? (errorData.error as Record<string, unknown>)
        : {};
    const errMsg = typeof errObj.message === 'string' ? errObj.message : 'Email dispatch failed';

    if (errMsg.includes('EMAIL_NOT_FOUND')) {
      throw createAuthError('No user record found for the given email.', 'auth/user-not-found');
    }
    if (errMsg.includes('INVALID_EMAIL')) {
      throw createAuthError('The email address is badly formatted.', 'auth/invalid-email');
    }
    if (errMsg.includes('TOO_MANY_ATTEMPTS') || errMsg.includes('TOO_MANY_REQUESTS')) {
      throw createAuthError('Too many password-reset requests.', 'auth/too-many-requests');
    }

    throw createAuthError(
      `Firebase password-reset email dispatch failed: ${errMsg}`,
      'auth/network-request-failed'
    );
  }
}

export interface PasswordResetConfirmResult {
  email: string;
  uid: string;
}

export interface PasswordResetInspectResult {
  email: string;
}

/**
 * Inspects a password-reset oobCode without changing the password
 * (Identity Toolkit `accounts:resetPassword` with oobCode only).
 * Used by POST /api/auth/password-reset/validate (US-005 / S1-P2-16).
 * Never logs the oobCode (NR-021).
 */
export async function inspectPasswordResetCode(
  oobCode: string
): Promise<PasswordResetInspectResult> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;

  if (!apiKey) {
    throw createAuthError(
      '[Firebase Error] FIREBASE_WEB_API_KEY is not configured to validate password-reset links.',
      'auth/configuration-error'
    );
  }

  const trimmedCode = oobCode.trim();
  if (!trimmedCode) {
    throw createAuthError('The action code is invalid or missing.', 'auth/invalid-action-code');
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${apiKey}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ oobCode: trimmedCode }),
    });
  } catch {
    throw createAuthError(
      'Failed to validate password reset link due to network or service error.',
      'auth/network-request-failed'
    );
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errObj =
      data.error && typeof data.error === 'object' ? (data.error as Record<string, unknown>) : {};
    const message = typeof errObj.message === 'string' ? errObj.message : '';

    if (message.includes('EXPIRED_OOB_CODE')) {
      throw createAuthError('The password reset link has expired.', 'auth/expired-action-code');
    }
    if (message.includes('INVALID_OOB_CODE')) {
      throw createAuthError(
        'The password reset link is invalid or has already been used.',
        'auth/invalid-action-code'
      );
    }

    throw createAuthError(
      'Password reset link validation failed due to network or service error.',
      'auth/network-request-failed'
    );
  }

  const email = String(data.email || '').trim().toLowerCase();
  if (!email) {
    throw createAuthError(
      'The password reset link is invalid or has already been used.',
      'auth/invalid-action-code'
    );
  }

  return { email };
}

/**
 * Consumes a password-reset oobCode and sets the new password via Identity Toolkit
 * (`accounts:resetPassword`). Does not create a session (US-005 AC 4 / FR-012).
 * Never logs the oobCode (NR-021).
 */
export async function confirmPasswordResetCode(
  oobCode: string,
  newPassword: string
): Promise<PasswordResetConfirmResult> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;

  if (!apiKey) {
    throw createAuthError(
      '[Firebase Error] FIREBASE_WEB_API_KEY is not configured to confirm password resets.',
      'auth/configuration-error'
    );
  }

  const trimmedCode = oobCode.trim();
  if (!trimmedCode) {
    throw createAuthError('The action code is invalid or missing.', 'auth/invalid-action-code');
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${apiKey}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        oobCode: trimmedCode,
        newPassword,
      }),
    });
  } catch {
    throw createAuthError(
      'Failed to confirm password reset due to network or service error.',
      'auth/network-request-failed'
    );
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errObj =
      data.error && typeof data.error === 'object' ? (data.error as Record<string, unknown>) : {};
    const message = typeof errObj.message === 'string' ? errObj.message : '';

    if (message.includes('EXPIRED_OOB_CODE')) {
      throw createAuthError('The password reset link has expired.', 'auth/expired-action-code');
    }
    if (message.includes('INVALID_OOB_CODE')) {
      throw createAuthError(
        'The password reset link is invalid or has already been used.',
        'auth/invalid-action-code'
      );
    }
    if (message.includes('WEAK_PASSWORD')) {
      throw createAuthError('Password does not meet security requirements.', 'auth/weak-password');
    }
    if (message.includes('USER_DISABLED')) {
      throw createAuthError('This account has been disabled.', 'auth/user-disabled');
    }

    throw createAuthError(
      'Password reset confirmation failed due to network or service error.',
      'auth/network-request-failed'
    );
  }

  const email = String(data.email || '').trim().toLowerCase();
  let uid = data.localId ? String(data.localId) : '';

  if (!uid && email) {
    const user = await getFirebaseAdminAuth().getUserByEmail(email);
    uid = user.uid;
  }

  if (!uid) {
    throw createAuthError(
      'Password was updated but the account could not be resolved for session revocation.',
      'auth/user-not-found'
    );
  }

  return { email, uid };
}

/**
 * Singleton proxy to allow direct consumption without throwing on module import.
 */
export const firebaseAuth: Auth & {
  verifyEmailActionCode?: typeof verifyEmailActionCode;
  sendVerificationEmail?: typeof sendVerificationEmail;
  sendPasswordResetEmail?: typeof sendPasswordResetEmail;
  inspectPasswordResetCode?: typeof inspectPasswordResetCode;
  confirmPasswordResetCode?: typeof confirmPasswordResetCode;
} = new Proxy(
  {} as Auth & {
    verifyEmailActionCode?: typeof verifyEmailActionCode;
    sendVerificationEmail?: typeof sendVerificationEmail;
    sendPasswordResetEmail?: typeof sendPasswordResetEmail;
    inspectPasswordResetCode?: typeof inspectPasswordResetCode;
    confirmPasswordResetCode?: typeof confirmPasswordResetCode;
  },
  {
    get(_target, prop) {
      if (prop === 'verifyEmailActionCode') {
        return verifyEmailActionCode;
      }
      if (prop === 'sendVerificationEmail') {
        return sendVerificationEmail;
      }
      if (prop === 'sendPasswordResetEmail') {
        return sendPasswordResetEmail;
      }
      if (prop === 'inspectPasswordResetCode') {
        return inspectPasswordResetCode;
      }
      if (prop === 'confirmPasswordResetCode') {
        return confirmPasswordResetCode;
      }
      const authClient = getFirebaseAdminAuth();
      const value = (authClient as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === 'function') {
        return value.bind(authClient);
      }
      return value;
    },
  }
);

// Alias for convenience
export const auth = firebaseAuth;

