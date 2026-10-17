import React, { useState, useCallback } from 'react';
import { auth } from '../../config/firebase';
import { logout } from './logout';
import { authFetch } from '../../config/authFetch';
import { ProfileEditorForm, type ProfileEditorInitialValues } from '../profile/ProfileEditorForm';
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
  const [showProfileSection, setShowProfileSection] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [currentProfile, setCurrentProfile] = useState<CandidateProfileData | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoadingProfile(true);
    setProfileLoadError(null);
    try {
      const response = await authFetch('/api/profiles/me', { method: 'GET' });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.profile) {
        setCurrentProfile(data.profile as CandidateProfileData);
      } else {
        setProfileLoadError(data?.error || 'Could not load your technical profile.');
      }
    } catch {
      setProfileLoadError('Network error while loading your technical profile.');
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  const handleToggleProfileSection = () => {
    if (!showProfileSection) {
      setShowProfileSection(true);
      if (!currentProfile) {
        void fetchProfile();
      }
    } else {
      setShowProfileSection(false);
      setIsEditingProfile(false);
    }
  };

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

  const isProfileEmpty =
    !currentProfile || (!currentProfile.primaryRole && !currentProfile.handle);

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
            onClick={handleToggleProfileSection}
            className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest"
          >
            {showProfileSection ? 'Hide Technical Profile' : 'Manage Technical Profile'}
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

      {showProfileSection && (
        <div className="max-w-md w-full mx-auto space-y-4">
          {loadingProfile ? (
            <CandidateProfileCard viewerCategory="OWNER" profile={{}} loading />
          ) : profileLoadError ? (
            <CandidateProfileCard
              viewerCategory="OWNER"
              profile={{}}
              error={profileLoadError}
              onRetry={() => void fetchProfile()}
            />
          ) : isEditingProfile ? (
            <ProfileEditorForm
              initialValues={currentProfile as ProfileEditorInitialValues | undefined}
              onSaved={(saved) => {
                setCurrentProfile(saved as unknown as CandidateProfileData);
                setIsEditingProfile(false);
              }}
              onCancel={() => setIsEditingProfile(false)}
            />
          ) : (
            <div className="space-y-4">
              <CandidateProfileCard
                viewerCategory="OWNER"
                profile={currentProfile || {}}
              />
              <button
                type="button"
                onClick={() => setIsEditingProfile(true)}
                className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest"
              >
                {isProfileEmpty ? 'Create Technical Profile' : 'Edit Technical Profile'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SignedInPanel;
