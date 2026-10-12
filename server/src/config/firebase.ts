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
 * Singleton proxy to allow direct consumption without throwing on module import.
 */
export const firebaseAuth: Auth & { verifyEmailActionCode?: typeof verifyEmailActionCode } = new Proxy(
  {} as Auth & { verifyEmailActionCode?: typeof verifyEmailActionCode },
  {
    get(_target, prop) {
      if (prop === 'verifyEmailActionCode') {
        return verifyEmailActionCode;
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

