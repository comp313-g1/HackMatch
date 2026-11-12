import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AuthenticatorEnrollmentApiError,
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  type GeneratedRecoveryCodes,
  type RecoveryCodeStatus,
} from './authenticatorEnrollmentApi';

/**
 * Runs a protected request; when the server answers REAUTHENTICATION_REQUIRED the
 * owner is asked to verify again and the same request is retried once.
 */
export type RunSensitive = <T>(purpose: string, operation: () => Promise<T>) => Promise<T>;

export interface RecoveryCodesPanelProps {
  runSensitive: RunSensitive;
  /** The server reported no active authenticator; the parent should refresh its status. */
  onAuthenticatorInactive: () => void;
  /**
   * Fresh set issued by a confirmed authenticator replacement. Read once on
   * mount and displayed with the same one-time UI as a manual generation.
   */
  initialCodes?: GeneratedRecoveryCodes | null;
  /** Lets the parent drop its copy as soon as this panel owns the codes. */
  onInitialCodesConsumed?: () => void;
}

type PanelState =
  | 'loading'
  | 'needs-verification'
  | 'error'
  | 'ready'
  | 'confirm-regenerate'
  | 'generating'
  | 'shown';

const primaryButton =
  'w-full py-2.5 px-4 rounded-md text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryButton =
  'w-full py-2 px-4 border border-cream-300 rounded-md text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';

function errorOf(caught: unknown): { code: string; message: string } {
  if (!(caught instanceof AuthenticatorEnrollmentApiError)) {
    return { code: 'UNKNOWN_ERROR', message: 'Recovery codes could not be loaded. Please try again.' };
  }
  switch (caught.code) {
    case 'REAUTHENTICATION_CANCELLED':
      return {
        code: caught.code,
        message: 'Identity verification was cancelled. Your recovery codes were not changed.',
      };
    case 'AUTHENTICATOR_NOT_ACTIVE':
      return {
        code: caught.code,
        message: 'Recovery codes are available only while an authenticator app is active.',
      };
    case 'AUTH_REQUIRED':
    case 'UNAUTHORIZED':
      return { code: caught.code, message: 'Your session has ended. Sign in again to continue.' };
    default:
      return { code: caught.code, message: caught.message };
  }
}

/**
 * US-029 / #269 recovery-code controls for an active authenticator.
 *
 * Raw codes come only from the generate response, live only in this
 * component's state (never localStorage/sessionStorage/URLs), and are dropped
 * on acknowledgement, unmount, sign-out, or account change (the parent keys
 * this component by account identity).
 */
export function RecoveryCodesPanel({
  runSensitive,
  onAuthenticatorInactive,
  initialCodes = null,
  onInitialCodesConsumed,
}: RecoveryCodesPanelProps): React.JSX.Element {
  // Captured once: later prop changes never re-show or replace displayed codes.
  const [fromReplacement] = useState(() => Boolean(initialCodes));
  const [state, setState] = useState<PanelState>(() => (initialCodes ? 'shown' : 'loading'));
  const [summary, setSummary] = useState<RecoveryCodeStatus | null>(() =>
    initialCodes
      ? {
          status: 'generated',
          batchId: initialCodes.batchId,
          total: initialCodes.total,
          remaining: initialCodes.remaining,
          generatedAt: initialCodes.generatedAt,
        }
      : null
  );
  const [generated, setGenerated] = useState<GeneratedRecoveryCodes | null>(() =>
    initialCodes ? { ...initialCodes, codes: [...initialCodes.codes] } : null
  );
  const [showReplacementNote, setShowReplacementNote] = useState(fromReplacement);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const codesHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const codesFieldId = useId();
  // Latest callbacks without re-running the mount-time load when a parent re-renders.
  const runSensitiveRef = useRef(runSensitive);
  const onInactiveRef = useRef(onAuthenticatorInactive);
  runSensitiveRef.current = runSensitive;
  onInactiveRef.current = onAuthenticatorInactive;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyError = useCallback((caught: unknown, fallbackState: PanelState) => {
    const safe = errorOf(caught);
    setError(safe);
    if (safe.code === 'AUTHENTICATOR_NOT_ACTIVE') {
      onInactiveRef.current();
    }
    setState(fallbackState);
    requestAnimationFrame(() => errorRef.current?.focus());
  }, []);

  const load = useCallback(
    async (verifyIfNeeded: boolean) => {
      setState('loading');
      setError(null);
      try {
        const next = verifyIfNeeded
          ? await runSensitiveRef.current('view your recovery codes', getRecoveryCodeStatus)
          : await getRecoveryCodeStatus();
        if (!mountedRef.current) return;
        setSummary(next);
        setState('ready');
      } catch (caught: unknown) {
        if (!mountedRef.current) return;
        if (
          caught instanceof AuthenticatorEnrollmentApiError &&
          caught.code === 'REAUTHENTICATION_REQUIRED' &&
          !verifyIfNeeded
        ) {
          // Do not interrupt the page with a credential prompt the user did not ask for.
          setState('needs-verification');
          return;
        }
        applyError(caught, 'error');
      }
    },
    [applyError]
  );

  useEffect(() => {
    if (fromReplacement) {
      onInitialCodesConsumed?.();
      requestAnimationFrame(() => codesHeadingRef.current?.focus());
      return;
    }
    void load(false);
    // Mount-only: the handoff is consumed exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    if (state === 'generating') return;
    const expectedBatchId = summary?.status === 'generated' ? summary.batchId : null;
    setError(null);
    setCopyStatus(null);
    setShowReplacementNote(false);
    setState('generating');
    try {
      const result = await runSensitiveRef.current(
        expectedBatchId ? 'replace your recovery codes' : 'generate recovery codes',
        () => generateRecoveryCodes(expectedBatchId)
      );
      if (!mountedRef.current) return;
      setGenerated(result);
      setSummary({
        status: 'generated',
        batchId: result.batchId,
        total: result.total,
        remaining: result.remaining,
        generatedAt: result.generatedAt,
      });
      setState('shown');
      requestAnimationFrame(() => codesHeadingRef.current?.focus());
    } catch (caught: unknown) {
      if (!mountedRef.current) return;
      if (caught instanceof AuthenticatorEnrollmentApiError && caught.code === 'RECOVERY_CODES_STALE') {
        // Another session changed the set: show its message and refresh the summary.
        const safe = errorOf(caught);
        await load(false);
        if (!mountedRef.current) return;
        setError(safe);
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      // Previous codes are untouched on any failure; return to the prior view.
      applyError(caught, 'ready');
    }
  };

  const acknowledge = () => {
    setGenerated(null);
    setCopyStatus(null);
    setShowReplacementNote(false);
    setState('ready');
  };

  const copyCodes = async () => {
    if (!generated) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(generated.codes.join('\n'));
      if (mountedRef.current) setCopyStatus('Recovery codes copied to your clipboard.');
    } catch {
      if (mountedRef.current) {
        setCopyStatus('Copy failed. Select the codes in the box and copy them manually.');
      }
    }
  };

  const hasSet = summary?.status === 'generated';

  return (
    <section
      aria-labelledby="recovery-codes-heading"
      className="mt-6 border-t border-cream-200 pt-5"
      data-testid="recovery-codes-panel"
    >
      <h4 id="recovery-codes-heading" className="font-display text-lg font-semibold text-forest-900">
        Recovery codes
      </h4>
      <p className="mt-1 text-sm text-ink-muted">
        Single-use backup codes reserved for authenticator recovery. Email verification codes
        remain your sign-in fallback.
      </p>

      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          data-testid="recovery-codes-error"
        >
          {error.message}
        </div>
      )}

      {(state === 'loading' || state === 'generating') && (
        <div role="status" aria-live="polite" aria-busy="true" className="mt-4 text-center">
          <div
            className="mx-auto mb-2 h-6 w-6 rounded-full border-4 border-forest-100 border-t-forest animate-spin"
            aria-hidden="true"
          />
          <p className="text-sm text-ink-muted">
            {state === 'generating' ? 'Generating recovery codes...' : 'Checking recovery codes...'}
          </p>
        </div>
      )}

      {state === 'needs-verification' && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-ink-muted">
            Verify your identity to view or change your recovery codes.
          </p>
          <button type="button" onClick={() => void load(true)} className={secondaryButton}>
            Verify identity for recovery codes
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="mt-4">
          <button type="button" onClick={() => void load(false)} className={secondaryButton}>
            Check recovery codes again
          </button>
        </div>
      )}

      {state === 'ready' && summary && (
        <div className="mt-4 space-y-3">
          {hasSet ? (
            <div role="status" aria-live="polite" className="text-sm text-ink">
              <p>
                <span className="font-semibold">{summary.remaining}</span> of {summary.total} recovery
                codes unused.
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Generated {new Date(summary.generatedAt).toLocaleString()}. Codes are never shown
                again after generation.
              </p>
              {summary.remaining === 0 && (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
                  Warning: every recovery code has been used. Generate a new set.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-muted" data-testid="recovery-codes-empty">
              You have not generated recovery codes yet.
            </p>
          )}
          <button
            type="button"
            onClick={() => (hasSet ? setState('confirm-regenerate') : void generate())}
            className={hasSet ? secondaryButton : primaryButton}
          >
            {hasSet ? 'Regenerate recovery codes' : 'Generate recovery codes'}
          </button>
        </div>
      )}

      {state === 'confirm-regenerate' && (
        <div className="mt-4 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900" role="alert">
            Important: generating a new set immediately stops every current recovery code from
            working. Your authenticator app stays active.
          </p>
          <button type="button" onClick={() => void generate()} className={primaryButton}>
            Generate new codes
          </button>
          <button type="button" onClick={() => setState('ready')} className={secondaryButton}>
            Keep current codes
          </button>
        </div>
      )}

      {state === 'shown' && generated && (
        <div className="mt-4 space-y-3" data-testid="recovery-codes-shown">
          <h5
            ref={codesHeadingRef}
            tabIndex={-1}
            className="text-sm font-semibold text-ink focus:outline-none"
          >
            Save your new recovery codes now
          </h5>
          {showReplacementNote && (
            <p
              className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900"
              data-testid="recovery-codes-replacement-note"
            >
              Important: your new authenticator app replaced the previous one, so your previous
              recovery codes no longer work. Use this new set instead.
            </p>
          )}
          <p className="text-sm text-ink" id={`${codesFieldId}-help`}>
            These codes are shown only once. HackMatch stores them in a form that cannot be shown
            again. Store them somewhere safe, such as a password manager. Each code works once.
          </p>
          <label htmlFor={codesFieldId} className="block text-xs font-semibold text-ink">
            Recovery codes ({generated.codes.length})
          </label>
          <textarea
            id={codesFieldId}
            readOnly
            rows={generated.codes.length}
            value={generated.codes.join('\n')}
            aria-describedby={`${codesFieldId}-help`}
            spellCheck={false}
            autoComplete="off"
            className="block w-full resize-none rounded-md border border-cream-300 bg-cream-50 px-3 py-2 font-mono text-sm tracking-wider text-ink focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
            data-testid="recovery-codes-list"
          />
          {copyStatus && (
            <p role="status" aria-live="polite" className="text-xs text-ink-muted">
              {copyStatus}
            </p>
          )}
          <button type="button" onClick={() => void copyCodes()} className={secondaryButton}>
            Copy recovery codes
          </button>
          <button type="button" onClick={acknowledge} className={primaryButton}>
            I have saved these codes
          </button>
        </div>
      )}
    </section>
  );
}

export default RecoveryCodesPanel;
