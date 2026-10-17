import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsSignedIn } from './useIsSignedIn.js';
import * as firebaseAuth from 'firebase/auth';
import { auth } from '../config/firebase.js';

vi.mock('firebase/auth', async () => {
  const actual = await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
  return {
    ...actual,
    onAuthStateChanged: vi.fn(),
  };
});

describe('useIsSignedIn hook unit tests (US-008 / #77)', () => {
  let authCallback: ((user: firebaseAuth.User | null) => void) | null = null;
  const mockUnsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    authCallback = null;

    vi.mocked(firebaseAuth.onAuthStateChanged).mockImplementation((_auth, cb) => {
      authCallback = cb as (user: firebaseAuth.User | null) => void;
      return mockUnsubscribe;
    });

    // Default auth.currentUser to null
    Object.defineProperty(auth, 'currentUser', {
      value: null,
      writable: true,
      configurable: true,
    });
  });

  it('returns false initially when no user is signed in', () => {
    const { result } = renderHook(() => useIsSignedIn());

    expect(result.current).toBe(false);
    expect(firebaseAuth.onAuthStateChanged).toHaveBeenCalledWith(auth, expect.any(Function));
  });

  it('returns true initially when auth.currentUser exists', () => {
    Object.defineProperty(auth, 'currentUser', {
      value: { uid: 'user-123' } as firebaseAuth.User,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useIsSignedIn());

    expect(result.current).toBe(true);
  });

  it('updates state dynamically when auth state changes', () => {
    const { result } = renderHook(() => useIsSignedIn());
    expect(result.current).toBe(false);

    // Simulate user sign in
    act(() => {
      if (authCallback) {
        authCallback({ uid: 'user-456' } as firebaseAuth.User);
      }
    });
    expect(result.current).toBe(true);

    // Simulate user sign out
    act(() => {
      if (authCallback) {
        authCallback(null);
      }
    });
    expect(result.current).toBe(false);
  });

  it('unsubscribes from onAuthStateChanged on unmount', () => {
    const { unmount } = renderHook(() => useIsSignedIn());

    expect(mockUnsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
