import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AuthenticatorEnrollmentApiError,
  beginAuthenticatorEnrollment,
  beginAuthenticatorReplacement,
  confirmAuthenticatorEnrollment,
  confirmAuthenticatorReplacement,
  disableAuthenticator,
  getAuthenticatorEnrollmentStatus,
  restartAuthenticatorEnrollment,
  type AuthenticatorEnrollmentStatusResponse,
  type GeneratedRecoveryCodes,
  type PendingAuthenticatorEnrollment,
} from './authenticatorEnrollmentApi';
import { ReauthenticationPanel } from './ReauthenticationPanel';
import { RecoveryCodesPanel, type RunSensitive } from './RecoveryCodesPanel';

type Phase =
  | 'checking'
  | 'status-error'
  | 'needs-verification'
  | 'idle'
  | 'starting'
  | 'restarting'
  | 'pending-existing'
  | 'setup'
  | 'confirming'
  | 'active'
  | 'replacing'
  | 'disabling';

/** First-time enrollment (#268) or replacement of an active factor (#269). */
type SetupMode = 'enroll' | 'replace';

type SetupMaterial = Pick<PendingAuthenticatorEnrollment, 'authenticator' | 'setup'>;

export interface AuthenticatorEnrollmentCardProps {
  /** Changing this value clears all owner-specific setup material from memory. */
  identityKey: string;
}

const primaryButton =
  'w-full py-2.5 px-4 rounded-md text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryButton =
  'w-full py-2 px-4 border border-cream-300 rounded-md text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const dangerButton =
  'w-full py-2.5 px-4 rounded-md text-sm font-semibold text-white bg-red-700 hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-700 disabled:opacity-50';

const CLEAR_SETUP_CODES = new Set([
  'AUTHENTICATOR_ENROLLMENT_EXPIRED',
  'AUTHENTICATOR_ENROLLMENT_STALE',
  'AUTHENTICATOR_ENROLLMENT_NOT_PENDING',
  'AUTH_REQUIRED',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'MFA_REQUIRED',
  'REAUTHENTICATION_REQUIRED',
  'AUTHENTICATOR_ENROLLMENT_FORBIDDEN',
]);

const REAUTHENTICATION_CANCELLED = 'REAUTHENTICATION_CANCELLED';

function friendlyError(error: unknown): { code: string; message: string } {
  if (!(error instanceof AuthenticatorEnrollmentApiError)) {
    return { code: 'UNKNOWN_ERROR', message: 'Authenticator setup failed. Please try again.' };
  }
  if (error.code === 'REAUTHENTICATION_REQUIRED') {
    return {
      code: error.code,
      message: 'We could not confirm a recent sign-in. Verify your identity again to continue.',
    };
  }
  if (error.code === REAUTHENTICATION_CANCELLED) {
    return { code: error.code, message: 'Identity verification was cancelled. No changes were made.' };
  }
  if (error.code === 'MFA_REQUIRED') {
    return {
      code: error.code,
      message: 'Complete the email verification-code step for this session, then try again.',
    };
  }
  if (error.code === 'AUTH_REQUIRED' || error.code === 'UNAUTHORIZED') {
    return { code: error.code, message: 'Your session has ended. Sign in again to continue.' };
  }
  return { code: error.code, message: error.message };
}

function isReauthenticationRequired(error: unknown): boolean {
  return error instanceof AuthenticatorEnrollmentApiError && error.code === 'REAUTHENTICATION_REQUIRED';
}

export function AuthenticatorEnrollmentCard({
  identityKey,
}: AuthenticatorEnrollmentCardProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('checking');
  const [mode, setMode] = useState<SetupMode>('enroll');
  const [pending, setPending] = useState<SetupMaterial | null>(null);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activatedAt, setActivatedAt] = useState<string | null>(null);
  const [pendingExpiresAt, setPendingExpiresAt] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [reauth, setReauth] = useState<{ purpose: string } | null>(null);
  /** Fresh replacement codes held only until the recovery panel takes ownership. */
  const [handoffCodes, setHandoffCodes] = useState<GeneratedRecoveryCodes | null>(null);
  const codeInputId = useId();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const disableHeadingRef = useRef<HTMLParagraphElement>(null);
  const statusRequestId = useRef(0);
  /** Bumped on account change/unmount so late responses never reach another owner's view. */
  const generationRef = useRef(0);
  const reauthResolver = useRef<((verified: boolean) => void) | null>(null);
  const busy =
    phase === 'starting' ||
    phase === 'restarting' ||
    phase === 'confirming' ||
    phase === 'replacing' ||
    phase === 'disabling';

  const clearSensitiveState = useCallback(() => {
    setPending(null);
    setCode('');
    setFieldError(null);
  }, []);

  /**
   * Shows the reauthentication flow and resolves once it finishes. The intended
   * operation is kept in the caller's closure, so the user returns to it
   * without redoing unrelated work.
   */
  const requestReauthentication = useCallback(
    (purpose: string) =>
      new Promise<boolean>((resolve) => {
        reauthResolver.current?.(false);
        reauthResolver.current = resolve;
        setReauth({ purpose });
      }),
    []
  );

  const finishReauthentication = useCallback((verified: boolean) => {
    const resolve = reauthResolver.current;
    reauthResolver.current = null;
    setReauth(null);
    resolve?.(verified);
  }, []);

  /**
   * The server's REAUTHENTICATION_REQUIRED response is the only trigger; the
   * client never decides on its own that a sign-in is recent enough. After
   * verification the same request is sent once more and the server re-checks.
   */
  const runSensitive = useCallback(
    async <T,>(purpose: string, operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation();
      } catch (caught: unknown) {
        if (!isReauthenticationRequired(caught)) throw caught;
        const verified = await requestReauthentication(purpose);
        if (!verified) {
          throw new AuthenticatorEnrollmentApiError(
            0,
            REAUTHENTICATION_CANCELLED,
            'Identity verification was cancelled. No changes were made.'
          );
        }
        return operation();
      }
    },
    [requestReauthentication]
  ) as RunSensitive;

  const applyStatus = useCallback((result: AuthenticatorEnrollmentStatusResponse) => {
    if (result.authenticator.status === 'active') {
      setActivatedAt(result.authenticator.activatedAt);
      setPendingExpiresAt(null);
      setPhase('active');
    } else if (result.authenticator.status === 'pending') {
      setActivatedAt(null);
      setPendingExpiresAt(result.authenticator.expiresAt);
      setPhase('pending-existing');
    } else {
      setActivatedAt(null);
      setPendingExpiresAt(null);
      setPhase('idle');
    }
  }, []);

  const loadStatus = useCallback(
    async (verifyIfNeeded = false) => {
      const requestId = ++statusRequestId.current;
      setPhase('checking');
      setError(null);
      try {
        const result = verifyIfNeeded
          ? await runSensitive('manage your authenticator app', getAuthenticatorEnrollmentStatus)
          : await getAuthenticatorEnrollmentStatus();
        if (requestId !== statusRequestId.current) return;
        applyStatus(result);
      } catch (caught: unknown) {
        if (requestId !== statusRequestId.current) return;
        if (!verifyIfNeeded && isReauthenticationRequired(caught)) {
          // Ask for credentials only after the user chooses to continue.
          setPhase('needs-verification');
          return;
        }
        setError(friendlyError(caught));
        setPhase('status-error');
      }
    },
    [applyStatus, runSensitive]
  );

  useEffect(() => {
    generationRef.current += 1;
    statusRequestId.current += 1;
    clearSensitiveState();
    finishReauthentication(false);
    setHandoffCodes(null);
    setMode('enroll');
    setConfirmingDisable(false);
    setNotice(null);
    setError(null);
    setActivatedAt(null);
    setPendingExpiresAt(null);
    void loadStatus();
    return () => {
      statusRequestId.current += 1;
      generationRef.current += 1;
      // Abandon any in-progress verification for this owner.
      const resolve = reauthResolver.current;
      reauthResolver.current = null;
      resolve?.(false);
    };
  }, [identityKey, clearSensitiveState, finishReauthentication, loadStatus]);

  const showSetup = (material: SetupMaterial) => {
    setPending(material);
    setPhase('setup');
    requestAnimationFrame(() => codeInputRef.current?.focus());
  };

  const start = async () => {
    if (busy) return;
    const generation = generationRef.current;
    clearSensitiveState();
    setError(null);
    setNotice(null);
    setActivatedAt(null);
    setPendingExpiresAt(null);
    setMode('enroll');
    setPhase('starting');
    try {
      const enrollment = await runSensitive(
        'set up an authenticator app',
        beginAuthenticatorEnrollment
      );
      if (generation !== generationRef.current) return;
      showSetup(enrollment);
    } catch (caught: unknown) {
      if (generation !== generationRef.current) return;
      const safe = friendlyError(caught);
      if (safe.code === 'AUTHENTICATOR_ALREADY_ACTIVE') {
        setPhase('active');
        setError(null);
      } else if (safe.code === 'AUTHENTICATOR_ENROLLMENT_PENDING') {
        setPhase('pending-existing');
        setPendingExpiresAt(null);
        setError(safe);
      } else {
        setPhase('idle');
        setError(safe);
      }
    }
  };

  const restart = async () => {
    if (busy) return;
    const generation = generationRef.current;
    clearSensitiveState();
    setError(null);
    setNotice(null);
    setPendingExpiresAt(null);
    setMode('enroll');
    setPhase('restarting');
    try {
      const enrollment = await runSensitive(
        'restart authenticator setup',
        restartAuthenticatorEnrollment
      );
      if (generation !== generationRef.current) return;
      showSetup(enrollment);
    } catch (caught: unknown) {
      if (generation !== generationRef.current) return;
      const safe = friendlyError(caught);
      if (safe.code === 'AUTHENTICATOR_ALREADY_ACTIVE') {
        setPhase('active');
        setError(null);
      } else if (safe.code === 'AUTHENTICATOR_ENROLLMENT_NOT_PENDING') {
        setPhase('idle');
        setError(safe);
      } else {
        setPhase('pending-existing');
        setError(safe);
      }
    }
  };

  const replace = async () => {
    if (busy) return;
    const generation = generationRef.current;
    clearSensitiveState();
    setError(null);
    setNotice(null);
    setConfirmingDisable(false);
    setMode('replace');
    setPhase('replacing');
    try {
      const replacement = await runSensitive(
        'replace your authenticator app',
        beginAuthenticatorReplacement
      );
      if (generation !== generationRef.current) return;
      showSetup(replacement);
    } catch (caught: unknown) {
      if (generation !== generationRef.current) return;
      const safe = friendlyError(caught);
      setMode('enroll');
      if (safe.code === 'AUTHENTICATOR_NOT_ACTIVE') {
        setActivatedAt(null);
        setPhase('idle');
      } else {
        // The current factor was never touched by a failed replacement.
        setPhase('active');
      }
      setError(safe);
    }
  };

  const disable = async () => {
    if (busy) return;
    const generation = generationRef.current;
    setError(null);
    setNotice(null);
    setPhase('disabling');
    try {
      await runSensitive('turn off your authenticator app', disableAuthenticator);
      if (generation !== generationRef.current) return;
      clearSensitiveState();
      setConfirmingDisable(false);
      setActivatedAt(null);
      setPendingExpiresAt(null);
      setMode('enroll');
      setPhase('idle');
      setNotice(
        'Your authenticator app is turned off and its recovery codes no longer work. Email verification codes still protect every sign-in.'
      );
    } catch (caught: unknown) {
      if (generation !== generationRef.current) return;
      const safe = friendlyError(caught);
      setConfirmingDisable(false);
      if (safe.code === 'AUTHENTICATOR_NOT_ACTIVE') {
        setActivatedAt(null);
        setPhase('idle');
      } else {
        setPhase('active');
      }
      setError(safe);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending || busy) return;
    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setFieldError('Enter exactly 6 digits from your authenticator app.');
      codeInputRef.current?.focus();
      return;
    }

    const generation = generationRef.current;
    setFieldError(null);
    setError(null);
    setPhase('confirming');
    try {
      if (mode === 'replace') {
        // One server transaction retires the old app, revokes the old recovery
        // set, and returns the fresh set, which the recovery panel shows once.
        const result = await confirmAuthenticatorReplacement(
          pending.authenticator.enrollmentId,
          normalizedCode
        );
        if (generation !== generationRef.current) return;
        clearSensitiveState();
        setHandoffCodes(result.recoveryCodes);
        setActivatedAt(result.authenticator.activatedAt);
        setPhase('active');
        setNotice(
          'Your new authenticator app is active. Codes from the previous app and your previous recovery codes no longer work.'
        );
        setMode('enroll');
        return;
      }
      const result = await confirmAuthenticatorEnrollment(
        pending.authenticator.enrollmentId,
        normalizedCode
      );
      if (generation !== generationRef.current) return;
      clearSensitiveState();
      setActivatedAt(result.authenticator.activatedAt);
      setPhase('active');
      setMode('enroll');
    } catch (caught: unknown) {
      if (generation !== generationRef.current) return;
      const safe = friendlyError(caught);
      if (safe.code === 'AUTHENTICATOR_ALREADY_ACTIVE') {
        clearSensitiveState();
        setMode('enroll');
        setPhase('active');
        setError(null);
        return;
      }
      if (safe.code === 'REAUTHENTICATION_REQUIRED') {
        // Setup material is never retained across verification (#268); fresh
        // material is requested afterwards so the user returns to setup.
        clearSensitiveState();
        setPhase(mode === 'replace' ? 'active' : 'pending-existing');
        const verified = await requestReauthentication(
          mode === 'replace'
            ? 'continue replacing your authenticator app'
            : 'continue setting up your authenticator app'
        );
        if (generation !== generationRef.current) return;
        if (!verified) {
          setMode('enroll');
          setError({
            code: REAUTHENTICATION_CANCELLED,
            message: 'Identity verification was cancelled. No changes were made.',
          });
          return;
        }
        if (mode === 'replace') void replace();
        else void restart();
        return;
      }
      if (CLEAR_SETUP_CODES.has(safe.code)) {
        clearSensitiveState();
        if (mode === 'replace') {
          // A failed replacement leaves the existing factor active.
          setMode('enroll');
          setPhase('active');
        } else {
          setPhase('idle');
        }
      } else {
        setPhase('setup');
        requestAnimationFrame(() => codeInputRef.current?.focus());
      }
      setError(safe);
    }
  };

  const cancel = () => {
    clearSensitiveState();
    setError(null);
    if (mode === 'replace') {
      setMode('enroll');
      setPhase('active');
      setNotice('Replacement cancelled. Your current authenticator app is still active.');
      return;
    }
    setPhase('idle');
  };

  const handleAuthenticatorInactive = useCallback(() => {
    clearSensitiveState();
    setConfirmingDisable(false);
    setActivatedAt(null);
    setMode('enroll');
    setPhase('idle');
    setError({
      code: 'AUTHENTICATOR_NOT_ACTIVE',
      message: 'Your authenticator app is no longer active for this account.',
    });
  }, [clearSensitiveState]);

  const consumeHandoffCodes = useCallback(() => setHandoffCodes(null), []);

  const openDisableConfirmation = () => {
    setError(null);
    setNotice(null);
    setConfirmingDisable(true);
    requestAnimationFrame(() => disableHeadingRef.current?.focus());
  };

  const confirmationRequired =
    phase === 'setup' || phase === 'confirming' || phase === 'pending-existing';
  const activeView = phase === 'active' || phase === 'disabling';
  const replacing = mode === 'replace' && (phase === 'setup' || phase === 'confirming');

  return (
    <section
      aria-labelledby="authenticator-enrollment-heading"
      className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm"
      data-testid="authenticator-enrollment-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            id="authenticator-enrollment-heading"
            className="font-display text-xl font-semibold text-forest-900"
          >
            Authenticator app
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Use a standards-compatible app to generate instant 6-digit verification codes.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            activeView
              ? 'bg-green-100 text-green-800'
              : confirmationRequired
                ? 'bg-amber-100 text-amber-800'
                : 'bg-cream-100 text-ink-muted'
          }`}
        >
          {activeView
            ? 'Active'
            : replacing
              ? 'Replacing'
              : confirmationRequired
                ? 'Confirmation required'
                : phase === 'checking'
                  ? 'Checking'
                  : phase === 'needs-verification'
                    ? 'Verification required'
                    : 'Not set up'}
        </span>
      </div>

      <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
        Email verification codes remain available as a fallback after setup.
      </div>

      {reauth && (
        <ReauthenticationPanel
          purpose={reauth.purpose}
          onReauthenticated={() => finishReauthentication(true)}
          onCancel={() => finishReauthentication(false)}
        />
      )}

      {/* Kept mounted (not rendered visible) during verification so the intended action resumes. */}
      <div hidden={Boolean(reauth)}>
        {notice && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"
            data-testid="authenticator-enrollment-notice"
          >
            {notice}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            data-testid="authenticator-enrollment-error"
          >
            {error.message}
          </div>
        )}

        {activeView ? (
          <div className="mt-5">
            <div role="status" aria-live="polite">
              <p className="font-semibold text-green-800">Your authenticator app is active.</p>
              <p className="mt-1 text-sm text-ink-muted">
                You can use authenticator codes when supported, and email codes remain available.
              </p>
              {activatedAt && (
                <p className="mt-2 text-xs text-ink-muted">
                  Activated {new Date(activatedAt).toLocaleString()}.
                </p>
              )}
            </div>

            {confirmingDisable ? (
              <div className="mt-4 space-y-3 rounded-md border border-red-200 bg-red-50 p-3">
                <p
                  ref={disableHeadingRef}
                  tabIndex={-1}
                  className="text-sm font-semibold text-red-800 focus:outline-none"
                >
                  Turn off your authenticator app?
                </p>
                <p className="text-sm text-red-800">
                  Authenticator codes and all unused recovery codes will stop working. Email
                  verification codes stay required at every sign-in. You’ll be asked to verify
                  your identity if your sign-in isn’t recent.
                </p>
                <button
                  type="button"
                  onClick={() => void disable()}
                  disabled={busy}
                  aria-busy={phase === 'disabling'}
                  className={dangerButton}
                >
                  {phase === 'disabling' ? 'Turning off...' : 'Turn off authenticator app'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDisable(false)}
                  disabled={busy}
                  className={secondaryButton}
                >
                  Keep authenticator app
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => void replace()}
                  disabled={busy}
                  className={secondaryButton}
                >
                  Replace authenticator app
                </button>
                <button
                  type="button"
                  onClick={openDisableConfirmation}
                  disabled={busy}
                  className={secondaryButton}
                >
                  Turn off authenticator app
                </button>
              </div>
            )}

            <RecoveryCodesPanel
              key={identityKey}
              runSensitive={runSensitive}
              onAuthenticatorInactive={handleAuthenticatorInactive}
              initialCodes={handoffCodes}
              onInitialCodesConsumed={consumeHandoffCodes}
            />
          </div>
        ) : phase === 'pending-existing' ? (
          <div className="mt-5" role="status" aria-live="polite">
            <p className="font-semibold text-amber-800">Authenticator setup is pending.</p>
            <p className="mt-1 text-sm text-ink-muted">
              For security, setup keys are shown only when enrollment starts. Restart setup to
              invalidate the previous key and receive new setup material.
            </p>
            {pendingExpiresAt && (
              <p className="mt-2 text-xs text-ink-muted">
                Pending setup expires {new Date(pendingExpiresAt).toLocaleString()}.
              </p>
            )}
            <div className="mt-4 space-y-2">
              <button type="button" onClick={() => void restart()} className={primaryButton}>
                Restart authenticator setup
              </button>
              <button type="button" onClick={() => void loadStatus()} className={secondaryButton}>
                Check status again
              </button>
            </div>
          </div>
        ) : pending && (phase === 'setup' || phase === 'confirming') ? (
          <div className="mt-5 space-y-5">
            {replacing && (
              <p
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                data-testid="authenticator-replacement-notice"
              >
                Replacing your authenticator app. Your current app and recovery codes keep working
                until you confirm a code from the new one; then you’ll receive a new set of
                recovery codes.
              </p>
            )}
            <div className="text-center">
              <p className="text-sm font-semibold text-ink">
                Scan this QR code with your authenticator app
              </p>
              <div
                className="mx-auto mt-3 inline-flex max-w-full rounded-lg border border-cream-200 bg-white p-3"
                data-testid="authenticator-qr-code"
              >
                <QRCodeSVG
                  value={pending.setup.otpauthUri}
                  title="Authenticator enrollment QR code"
                  size={192}
                  level="M"
                  marginSize={1}
                />
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                The QR code contains the same sensitive setup key shown below.
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-ink">Cannot scan the QR code?</p>
              <p className="mt-1 text-sm text-ink-muted">
                Choose manual setup in your app and enter this key:
              </p>
              <div
                className="mt-2 overflow-wrap-anywhere break-all rounded-md border border-cream-300 bg-cream-50 p-3 font-mono text-sm tracking-wider text-ink"
                data-testid="authenticator-manual-key"
              >
                {pending.setup.manualEntryKey}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted">
                <dt>Issuer</dt>
                <dd className="text-right text-ink">{pending.authenticator.issuer}</dd>
                <dt>Account</dt>
                <dd className="text-right text-ink">{pending.authenticator.accountLabel}</dd>
                <dt>Code settings</dt>
                <dd className="text-right text-ink">
                  {pending.authenticator.digits} digits every {pending.authenticator.periodSeconds}s
                </dd>
              </dl>
            </div>

            <form onSubmit={confirm} noValidate>
              <label htmlFor={codeInputId} className="block text-sm font-semibold text-ink">
                Authenticator code
              </label>
              <p id={`${codeInputId}-hint`} className="mt-1 text-xs text-ink-muted">
                Enter the current 6-digit code from your authenticator app.
              </p>
              <input
                ref={codeInputRef}
                id={codeInputId}
                name="authenticatorCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  if (fieldError) setFieldError(null);
                }}
                disabled={phase === 'confirming'}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={
                  fieldError ? `${codeInputId}-hint ${codeInputId}-error` : `${codeInputId}-hint`
                }
                className="mt-2 block w-full rounded-md border border-cream-300 px-3 py-2 text-center font-mono text-lg tracking-[0.35em] focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30 disabled:bg-cream-50"
              />
              {fieldError && (
                <p id={`${codeInputId}-error`} role="alert" className="mt-1 text-xs text-red-700">
                  {fieldError}
                </p>
              )}
              <div className="mt-4 space-y-2">
                <button
                  type="submit"
                  disabled={phase === 'confirming'}
                  aria-busy={phase === 'confirming'}
                  className={primaryButton}
                >
                  {phase === 'confirming'
                    ? 'Confirming...'
                    : replacing
                      ? 'Confirm new authenticator'
                      : 'Confirm authenticator'}
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  disabled={phase === 'confirming'}
                  className={secondaryButton}
                >
                  {replacing ? 'Cancel replacement' : 'Cancel setup'}
                </button>
              </div>
            </form>
          </div>
        ) : phase === 'checking' || phase === 'restarting' || phase === 'replacing' ? (
          <div role="status" aria-live="polite" aria-busy="true" className="mt-5 text-center">
            <div
              className="mx-auto mb-2 h-7 w-7 rounded-full border-4 border-forest-100 border-t-forest animate-spin"
              aria-hidden="true"
            />
            <p className="text-sm text-ink-muted">
              {phase === 'restarting'
                ? 'Restarting authenticator setup...'
                : phase === 'replacing'
                  ? 'Preparing your replacement authenticator...'
                  : 'Checking authenticator status...'}
            </p>
          </div>
        ) : phase === 'needs-verification' ? (
          <div className="mt-5 space-y-2">
            <p className="text-sm text-ink-muted">
              Authenticator settings are protected. Verify your identity to view or change them.
            </p>
            <button type="button" onClick={() => void loadStatus(true)} className={primaryButton}>
              Verify identity to manage authenticator
            </button>
          </div>
        ) : phase === 'status-error' ? (
          <div className="mt-5">
            <button type="button" onClick={() => void loadStatus()} className={secondaryButton}>
              Check authenticator status again
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => void start()}
              disabled={phase === 'starting'}
              aria-busy={phase === 'starting'}
              className={primaryButton}
            >
              {phase === 'starting' ? 'Starting setup...' : 'Set up authenticator app'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export default AuthenticatorEnrollmentCard;
