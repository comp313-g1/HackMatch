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

/**
 * Singleton proxy to allow direct consumption without throwing on module import.
 */
export const firebaseAuth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const authClient = getFirebaseAdminAuth();
    const value = (authClient as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(authClient);
    }
    return value;
  },
});

// Alias for convenience
export const auth: Auth = firebaseAuth;
