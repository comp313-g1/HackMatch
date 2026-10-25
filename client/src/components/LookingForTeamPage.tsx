import React, { useState, useEffect, useCallback } from 'react';
import { auth } from '../config/firebase';
import {
  fetchMyAvailability,
  fetchAvailableCandidates,
  AuthRequiredError,
  AvailabilityApiError,
  type PlatformAvailabilityRecord,
  type AvailableCandidateCard,
} from '../services/availabilityApi';
import { AvailabilityPreferencesForm } from './AvailabilityPreferencesForm';
import { AvailableCandidatesList } from './AvailableCandidatesList';

export interface LookingForTeamPageProps {
  idToken?: string | null;
  isVerifiedParticipant?: boolean;
  currentParticipantId?: string | null;
  onNavigateToSignIn?: () => void;
  onBackToLanding?: () => void;
}

export function LookingForTeamPage({
  idToken,
  isVerifiedParticipant = true,
  currentParticipantId,
  onNavigateToSignIn,
  onBackToLanding,
}: LookingForTeamPageProps): React.JSX.Element {
  const [currentUser, setCurrentUser] = useState(() => auth.currentUser);
  const [availability, setAvailability] = useState<PlatformAvailabilityRecord | null>(null);
  const [candidates, setCandidates] = useState<AvailableCandidateCard[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVisitor, setIsVisitor] = useState<boolean>(false);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setIsVisitor(false);

    // If explicit visitor flag or no user and no token
    if (!currentUser && !idToken) {
      setIsVisitor(true);
      setIsLoading(false);
      return;
    }

    try {
      const [availData, candData] = await Promise.all([
        fetchMyAvailability(idToken),
        fetchAvailableCandidates(idToken),
      ]);
      setAvailability(availData);
      setCandidates(candData);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setIsVisitor(true);
      } else if (err instanceof AvailabilityApiError && (err.status === 401 || err.status === 403)) {
        setIsVisitor(true);
        setErrorMessage('Sign in as a verified participant to declare availability or view available candidates.');
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to load availability data.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, idToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Visitor Access Restriction (US-011 AC 3 / FR-027)
  if (isVisitor || (!currentUser && !idToken) || !isVerifiedParticipant) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {onBackToLanding && (
          <button
            type="button"
            onClick={onBackToLanding}
            className="inline-flex items-center gap-1 text-sm font-medium text-forest hover:underline"
          >
            ← Back to Events
          </button>
        )}

        <div
          role="alert"
          className="bg-white rounded-xl border border-cream-200 shadow-sm p-8 text-center space-y-4"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-forest-900">
            Sign In Required to Access Looking for Team
          </h3>
          <p className="text-sm text-ink-muted max-w-md mx-auto">
            Candidate availability profiles and Looking for Team preferences are protected.
            Sign in as a verified participant to declare your availability or view available candidates.
          </p>
          {onNavigateToSignIn && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onNavigateToSignIn}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-md font-semibold text-sm bg-forest text-white hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 transition-colors"
              >
                Sign in to HackMatch
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {onBackToLanding && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBackToLanding}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:text-forest-900 hover:underline focus:outline-none focus:ring-2 focus:ring-forest rounded px-2 py-1"
          >
            ← Back to Events
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg"
        >
          {errorMessage}
        </div>
      )}

      <AvailabilityPreferencesForm
        initialAvailability={availability}
        idToken={idToken}
        onAvailabilityUpdated={(updated) => {
          setAvailability(updated);
          fetchAvailableCandidates(idToken)
            .then(setCandidates)
            .catch(() => {});
        }}
      />

      <AvailableCandidatesList
        candidates={candidates}
        currentParticipantId={currentParticipantId ?? currentUser?.uid ?? null}
        isLoading={isLoading}
      />
    </div>
  );
}
