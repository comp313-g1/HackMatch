import { useState, useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../config/firebase.js';

/**
 * Custom React hook that tracks whether a user is currently signed in to Firebase Auth.
 * Automatically subscribes on mount and unsubscribes on unmount.
 */
export function useIsSignedIn(): boolean {
  const [isSignedIn, setIsSignedIn] = useState<boolean>(() => !!auth.currentUser);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      setIsSignedIn(!!user);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return isSignedIn;
}
