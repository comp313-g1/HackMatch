import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Firebase Admin Auth (Offline & Configuration)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('safely imports and instantiates the auth client proxy without credentials', async () => {
    const { getFirebaseAdminAuth, firebaseAuth, auth } = await import('./firebase.js');

    expect(() => getFirebaseAdminAuth()).not.toThrow();
    expect(firebaseAuth).toBeDefined();
    expect(auth).toBeDefined();
  }, 15000);

  it('fails fast with a descriptive error when active property or operation is accessed without credentials', async () => {
    const { getFirebaseAdminAuth, firebaseAuth, auth } = await import('./firebase.js');

    const client = getFirebaseAdminAuth();
    expect(() => (client as unknown as { listUsers: () => unknown }).listUsers()).toThrowError(
      /Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY environment variables/
    );

    expect(() => (firebaseAuth as unknown as { listUsers: () => unknown }).listUsers()).toThrowError(
      /Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY environment variables/
    );

    expect(() => (auth as unknown as { verifyIdToken: (t: string) => unknown }).verifyIdToken('token')).toThrowError(
      /Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY environment variables/
    );
  });

  it('resets cached instances via _resetFirebaseInstances', async () => {
    const { _resetFirebaseInstances } = await import('./firebase.js');
    expect(() => _resetFirebaseInstances()).not.toThrow();
  });

  describe('verifyEmailActionCode helper', () => {
    it('throws auth/invalid-action-code when oobCode is empty or invalid string', async () => {
      const { verifyEmailActionCode } = await import('./firebase.js');

      await expect(verifyEmailActionCode('')).rejects.toMatchObject({
        code: 'auth/invalid-action-code',
      });
      await expect(verifyEmailActionCode('   ')).rejects.toMatchObject({
        code: 'auth/invalid-action-code',
      });
    });

    it('throws auth/configuration-error when FIREBASE_WEB_API_KEY is missing', async () => {
      const { verifyEmailActionCode } = await import('./firebase.js');
      delete process.env.FIREBASE_WEB_API_KEY;
      delete process.env.VITE_FIREBASE_API_KEY;

      await expect(verifyEmailActionCode('some-code')).rejects.toMatchObject({
        code: 'auth/configuration-error',
      });
    });

    it('returns email and uid when Identity Platform API succeeds', async () => {
      const { verifyEmailActionCode } = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'jane.doe@example.com',
          localId: 'uid-12345',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await verifyEmailActionCode('valid-oob-code');
      expect(result).toEqual({
        email: 'jane.doe@example.com',
        uid: 'uid-12345',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://identitytoolkit.googleapis.com/v1/accounts:update?key=test-web-api-key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ oobCode: 'valid-oob-code' }),
        })
      );

      vi.unstubAllGlobals();
    });

    it('maps EXPIRED_OOB_CODE to auth/expired-action-code', async () => {
      const { verifyEmailActionCode } = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: {
            message: 'EXPIRED_OOB_CODE',
          },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(verifyEmailActionCode('expired-code')).rejects.toMatchObject({
        code: 'auth/expired-action-code',
      });

      vi.unstubAllGlobals();
    });

    it('maps INVALID_OOB_CODE to auth/invalid-action-code', async () => {
      const { verifyEmailActionCode } = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: {
            message: 'INVALID_OOB_CODE',
          },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(verifyEmailActionCode('invalid-code')).rejects.toMatchObject({
        code: 'auth/invalid-action-code',
      });

      vi.unstubAllGlobals();
    });

    it('maps network errors to auth/network-request-failed', async () => {
      const { verifyEmailActionCode } = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Connection failed'));
      vi.stubGlobal('fetch', mockFetch);

      await expect(verifyEmailActionCode('any-code')).rejects.toMatchObject({
        code: 'auth/network-request-failed',
      });

      vi.unstubAllGlobals();
    });

    it('is accessible via firebaseAuth.verifyEmailActionCode proxy', async () => {
      const { firebaseAuth } = await import('./firebase.js');
      expect(typeof firebaseAuth.verifyEmailActionCode).toBe('function');
    });
  });

  describe('sendVerificationEmail helper', () => {
    it('throws auth/configuration-error when FIREBASE_WEB_API_KEY is missing', async () => {
      const { sendVerificationEmail } = await import('./firebase.js');
      delete process.env.FIREBASE_WEB_API_KEY;
      delete process.env.VITE_FIREBASE_API_KEY;

      await expect(sendVerificationEmail('test@example.com')).rejects.toMatchObject({
        code: 'auth/configuration-error',
      });
    });

    it('dispatches verification email via custom token exchange and sendOobCode', async () => {
      const firebaseModule = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockGetUserByEmail = vi.fn().mockResolvedValue({ uid: 'mock-uid-123' });
      const mockCreateCustomToken = vi.fn().mockResolvedValue('mock-custom-token');
      const mockAuthClient = {
        getUserByEmail: mockGetUserByEmail,
        createCustomToken: mockCreateCustomToken,
      } as unknown as import('firebase-admin/auth').Auth;

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ idToken: 'mock-id-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' }),
        });
      vi.stubGlobal('fetch', mockFetch);

      await firebaseModule.sendVerificationEmail(
        'test@example.com',
        { url: 'http://localhost:5173/?mode=verifyEmail' },
        mockAuthClient
      );

      expect(mockGetUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockCreateCustomToken).toHaveBeenCalledWith('mock-uid-123');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify sign-in token exchange call
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test-web-api-key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'mock-custom-token', returnSecureToken: true }),
        })
      );

      // Verify sendOobCode dispatch call
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=test-web-api-key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            requestType: 'VERIFY_EMAIL',
            idToken: 'mock-id-token',
            continueUrl: 'http://localhost:5173/?mode=verifyEmail',
          }),
        })
      );

      vi.unstubAllGlobals();
    });

    it('maps dispatch errors to auth/network-request-failed', async () => {
      const firebaseModule = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockAuthClient = {
        getUserByEmail: vi.fn().mockResolvedValue({ uid: 'mock-uid-123' }),
        createCustomToken: vi.fn().mockResolvedValue('mock-custom-token'),
      } as unknown as import('firebase-admin/auth').Auth;

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'TOKEN_EXCHANGE_ERROR' } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        firebaseModule.sendVerificationEmail('test@example.com', undefined, mockAuthClient)
      ).rejects.toMatchObject({
        code: 'auth/network-request-failed',
      });

      vi.unstubAllGlobals();
    });

    it('is accessible via firebaseAuth.sendVerificationEmail proxy', async () => {
      const { firebaseAuth } = await import('./firebase.js');
      expect(typeof firebaseAuth.sendVerificationEmail).toBe('function');
    });
  });

  describe('sendPasswordResetEmail helper (US-005 / FR-011)', () => {
    it('throws auth/configuration-error when FIREBASE_WEB_API_KEY is missing', async () => {
      const { sendPasswordResetEmail } = await import('./firebase.js');
      delete process.env.FIREBASE_WEB_API_KEY;
      delete process.env.VITE_FIREBASE_API_KEY;

      await expect(sendPasswordResetEmail('test@example.com')).rejects.toMatchObject({
        code: 'auth/configuration-error',
      });
    });

    it('dispatches PASSWORD_RESET oob via Identity Toolkit sendOobCode', async () => {
      const firebaseModule = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await firebaseModule.sendPasswordResetEmail('  Test@Example.com  ', {
        url: 'http://localhost:5173/?mode=resetPassword',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=test-web-api-key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            requestType: 'PASSWORD_RESET',
            email: 'test@example.com',
            continueUrl: 'http://localhost:5173/?mode=resetPassword',
          }),
        })
      );

      vi.unstubAllGlobals();
    });

    it('maps EMAIL_NOT_FOUND to auth/user-not-found', async () => {
      const firebaseModule = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'EMAIL_NOT_FOUND' } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(firebaseModule.sendPasswordResetEmail('ghost@example.com')).rejects.toMatchObject({
        code: 'auth/user-not-found',
      });

      vi.unstubAllGlobals();
    });

    it('is accessible via firebaseAuth.sendPasswordResetEmail proxy', async () => {
      const { firebaseAuth } = await import('./firebase.js');
      expect(typeof firebaseAuth.sendPasswordResetEmail).toBe('function');
    });
  });

  describe('confirmPasswordResetCode helper (US-005 / FR-012)', () => {
    it('throws auth/configuration-error when FIREBASE_WEB_API_KEY is missing', async () => {
      const { confirmPasswordResetCode } = await import('./firebase.js');
      delete process.env.FIREBASE_WEB_API_KEY;
      delete process.env.VITE_FIREBASE_API_KEY;

      await expect(
        confirmPasswordResetCode('oob', 'Valid1@Password')
      ).rejects.toMatchObject({
        code: 'auth/configuration-error',
      });
    });

    it('confirms reset via Identity Toolkit and returns email + uid', async () => {
      const firebaseModule = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'jane@example.com',
          localId: 'uid-123',
          requestType: 'PASSWORD_RESET',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await firebaseModule.confirmPasswordResetCode('oob-abc', 'Valid1@Password');

      expect(result).toEqual({ email: 'jane@example.com', uid: 'uid-123' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=test-web-api-key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ oobCode: 'oob-abc', newPassword: 'Valid1@Password' }),
        })
      );

      vi.unstubAllGlobals();
    });

    it('maps EXPIRED_OOB_CODE to auth/expired-action-code', async () => {
      const firebaseModule = await import('./firebase.js');
      process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'EXPIRED_OOB_CODE' } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        firebaseModule.confirmPasswordResetCode('stale', 'Valid1@Password')
      ).rejects.toMatchObject({
        code: 'auth/expired-action-code',
      });

      vi.unstubAllGlobals();
    });

    it('is accessible via firebaseAuth.confirmPasswordResetCode proxy', async () => {
      const { firebaseAuth } = await import('./firebase.js');
      expect(typeof firebaseAuth.confirmPasswordResetCode).toBe('function');
    });
  });
});
