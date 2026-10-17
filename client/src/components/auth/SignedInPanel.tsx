import React, { useState } from 'react';
import { auth } from '../../config/firebase';
import { logout } from './logout';
import { ProfileEditorForm } from '../profile/ProfileEditorForm';
import {
  CandidateProfileCard,
  type CandidateProfileData,
} from '../profile/CandidateProfileCard';

export interface SignedInPanelProps {
  email: string | null;
  onSignedOut?: () => void;
}

export function SignedInPanel({ email, onSignedOut }: SignedInPanelProps): React.JSX.Element {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<CandidateProfileData | null>(null);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await logout(auth.currentUser);
      onSignedOut?.();
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Sign-out failed. Please try again.';
      setError(message);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm">
        <h3 className="font-display text-xl font-semibold text-forest-900 mb-2">
          You are signed in
        </h3>
        <p className="text-sm text-ink-muted mb-6">
          Welcome back{email ? `, ${email}` : ''}. Your session is fully verified.
        </p>
        {error && (
          <div
            role="alert"
            className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
          >
            {error}
          </div>
        )}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowProfileEditor((prev) => !prev)}
            className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest"
          >
            {showProfileEditor ? 'Hide Technical Profile' : 'Manage Technical Profile'}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-busy={signingOut}
            className="w-full py-2 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50"
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </div>

      {showProfileEditor && (
        <div className="space-y-6">
          <ProfileEditorForm
            loadOnMount
            onLoaded={(loaded) => setCurrentProfile(loaded as unknown as CandidateProfileData)}
            onSaved={(saved) => setCurrentProfile(saved as unknown as CandidateProfileData)}
          />
          {currentProfile && (
            <div className="max-w-md w-full mx-auto">
              <CandidateProfileCard viewerCategory="OWNER" profile={currentProfile} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SignedInPanel;
