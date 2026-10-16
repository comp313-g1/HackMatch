import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signInWithPopup } from 'firebase/auth';
import { ProviderSignInButtons } from './ProviderSignInButtons';
import type { OtpChallenge, ProviderSignInOutcome } from './providerSignIn';

// --- Module mocks -----------------------------------------------------------
// Firebase popup + the config module are isolated so no real network/SDK runs.
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  getAuth: vi.fn(),
}));

vi.mock('../../config/firebase', () => ({
  auth: {},
  googleProvider: { providerId: 'google.com' },
  githubProvider: { providerId: 'github.com' },
  translateAuthError: vi.fn((error: unknown) => {
    const code = (error as { code?: string } | null | undefined)?.code;
    return `FB:${code ?? 'unknown'}`;
  }),
}));

const mockSignInWithPopup = vi.mocked(signInWithPopup);

// --- Helpers ----------------------------------------------------------------
interface FakeUserOverrides {
  email?: string | null;
  emailVerified?: boolean;
  getIdToken?: () => Promise<string>;
}

function makeUser(overrides: FakeUserOverrides = {}) {
  return {
    email: 'jane@example.com' as string | null,
    emailVerified: true as boolean | undefined,
    getIdToken: vi.fn().mockResolvedValue('id-token-123'),
    ...overrides,
  };
}

function makePopupResult(user: ReturnType<typeof makeUser>) {
  return { user } as unknown as Awaited<ReturnType<typeof signInWithPopup>>;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderButtons() {
  const onRequiresOtp = vi.fn<(challenge: OtpChallenge) => void>();
  const onUnverifiedEmail = vi.fn<(email: string | null) => void>();
  const onEmptyEmail = vi.fn<() => void>();
  const onError = vi.fn<(message: string, retryable: boolean) => void>();

  render(
    <ProviderSignInButtons
      onRequiresOtp={onRequiresOtp}
      onUnverifiedEmail={onUnverifiedEmail}
      onEmptyEmail={onEmptyEmail}
      onError={onError}
    />
  );

  return { onRequiresOtp, onUnverifiedEmail, onEmptyEmail, onError };
}

const clickGoogle = () => fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
const clickGithub = () => fireEvent.click(screen.getByRole('button', { name: /continue with github/i }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Test cases -------------------------------------------------------------

describe('ProviderSignInButtons · success (issue #30 / US-002 AC2, AC5)', () => {
  it('case 1: Google success with a verified email calls onRequiresOtp, creates no session, and calls fetch once', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser({ emailVerified: true })));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        requiresOtp: true,
        challengeId: 'challenge-1',
        email: 'j***e@example.com',
        expiresInSeconds: 600,
        message: 'A 6-digit verification code has been sent to your email.',
      })
    );

    const props = renderButtons();
    clickGoogle();

    await waitFor(() => expect(props.onRequiresOtp).toHaveBeenCalledTimes(1));

    const challenge = props.onRequiresOtp.mock.calls[0][0] as OtpChallenge;
    expect(challenge).toEqual({
      challengeId: 'challenge-1',
      email: 'j***e@example.com',
      expiresInSeconds: 600,
      message: 'A 6-digit verification code has been sent to your email.',
    });

    // Payload contract: exactly { idToken, provider, consentHandleAvatar }.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/oauth/sign-in');
    expect(JSON.parse(init.body as string)).toEqual({
      idToken: 'id-token-123',
      provider: 'google',
      consentHandleAvatar: false,
    });

    // No session is created — success stops at the OTP hand-off.
    expect(sessionStorage.getItem('hackmatch_last_registered_email')).toBeNull();
    expect(Object.keys(localStorage)).toHaveLength(0);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });
});

describe('ProviderSignInButtons · email diversion (AC2)', () => {
  it('case 2: GitHub with emailVerified=false diverts to email registration and never calls fetch', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(
      makePopupResult(makeUser({ email: 'octocat@example.com', emailVerified: false }))
    );

    const props = renderButtons();
    clickGithub();

    await waitFor(() => expect(props.onUnverifiedEmail).toHaveBeenCalledWith('octocat@example.com'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('case 3: a null provider email enters the empty state without calling fetch', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser({ email: null })));

    const props = renderButtons();
    clickGoogle();

    await waitFor(() => expect(props.onEmptyEmail).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/did not return an email address/i);
  });

  it('case 4 (red line): a passing pre-check still diverts when the server returns 403 UNVERIFIED_PROVIDER_EMAIL', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser({ emailVerified: true })));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, {
        error: 'A verified provider email is required. Please sign up using standard email registration.',
        code: 'UNVERIFIED_PROVIDER_EMAIL',
      })
    );

    const props = renderButtons();
    clickGoogle();

    await waitFor(() => expect(props.onUnverifiedEmail).toHaveBeenCalledWith('jane@example.com'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('case 4b (boundary): emailVerified=undefined is not pre-diverted — the server stays authoritative', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(
      makePopupResult(makeUser({ emailVerified: undefined }))
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: 'unverified', code: 'UNVERIFIED_PROVIDER_EMAIL' })
    );

    const props = renderButtons();
    clickGoogle();

    await waitFor(() => expect(props.onUnverifiedEmail).toHaveBeenCalled());
    // The client did NOT short-circuit; it asked the server and obeyed the 403.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ProviderSignInButtons · Firebase-level errors', () => {
  it('case 5: a cancelled popup becomes an error state with the translated message and no session', async () => {
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });

    const props = renderButtons();
    clickGoogle();

    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    expect(screen.getByRole('alert')).toHaveTextContent('FB:auth/popup-closed-by-user');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Object.keys(localStorage)).toHaveLength(0);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });

  it('case 6a: a blocked popup is retryable', async () => {
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });

    const props = renderButtons();
    clickGoogle();

    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.anything(), true));
    expect(screen.getByRole('alert')).toHaveTextContent('FB:auth/popup-blocked');
    expect(screen.getByRole('button', { name: /try again with google/i })).toBeInTheDocument();
  });

  it('case 6b: a network failure of the sign-in request is retryable', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const props = renderButtons();
    clickGoogle();

    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.anything(), true));
    expect(screen.getByRole('alert')).toHaveTextContent(/network error/i);
    expect(screen.getByRole('button', { name: /try again with google/i })).toBeInTheDocument();
  });
});

describe('ProviderSignInButtons · server-side error codes', () => {
  it('case 7: 409 LINKING_REAUTHENTICATION_REQUIRED explains the password route and is not retryable', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: 'linking required',
        code: 'LINKING_REAUTHENTICATION_REQUIRED',
      })
    );

    const props = renderButtons();
    clickGoogle();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/password/i);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(props.onError).toHaveBeenCalledWith(expect.anything(), false);
  });

  it.each([
    [400, 'PROVIDER_MISMATCH', undefined, /does not match your sign-in credential/i],
    [401, 'INVALID_TOKEN', undefined, /credential has expired/i],
    [423, 'ACCOUNT_LOCKED', 900, /15 minutes/i],
    [429, 'RATE_LIMITED', 30, /30 seconds/i],
    [502, 'EMAIL_DELIVERY_FAILED', undefined, /couldn't send your verification code/i],
  ])(
    'case 8: HTTP %i %s maps to its own message',
    async (status, code, retryAfter, expected) => {
      mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
      fetchMock.mockResolvedValueOnce(
        jsonResponse(status as number, {
          error: 'server error',
          code,
          ...(retryAfter !== undefined ? { retryAfter } : {}),
        })
      );

      renderButtons();
      clickGoogle();

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByRole('alert')).toHaveTextContent(expected);
    }
  );

  it('case 8b: an unknown code falls back to the generic message', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom', code: 'SOMETHING_NEW' }));

    renderButtons();
    clickGoogle();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/sign-in failed\. please try again/i);
  });
});

describe('ProviderSignInButtons · loading and data preservation', () => {
  it('case 9: repeated clicks while loading are ignored and fetch is called once', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    renderButtons();
    clickGoogle();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Second attempt while the first is still in flight.
    clickGithub();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /signing in with google/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeDisabled();
  });

  it('case 10 (validation): a field-level 400 surfaces inline and preserves the consent choice', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { errors: { idToken: 'Firebase ID token is required.' } })
    );

    renderButtons();

    const consent = screen.getByLabelText(/allow hackmatch to use my provider/i);
    fireEvent.click(consent);
    expect(consent).toBeChecked();

    clickGoogle();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/id token is required/i)
    );
    // Already-filled data is preserved across the validation error.
    expect(consent).toBeChecked();
  });

  it('case 10b: the consent choice is forwarded to the backend payload', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { requiresOtp: true, challengeId: 'c', email: 'j***e@example.com', expiresInSeconds: 600, message: 'sent' })
    );

    renderButtons();
    fireEvent.click(screen.getByLabelText(/allow hackmatch to use my provider/i));
    clickGoogle();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).consentHandleAvatar).toBe(true);
  });
});

describe('ProviderSignInButtons · accessibility', () => {
  it('case 11a: the group is aria-busy while loading', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    renderButtons();
    clickGoogle();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true');
  });

  it('case 11b: success announces politely via role=status / aria-live', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser()));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { requiresOtp: true, challengeId: 'c', email: 'j***e@example.com', expiresInSeconds: 600, message: 'sent' })
    );

    renderButtons();
    clickGoogle();

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('case 11c: a validation error marks the group aria-invalid and uses role=alert', async () => {
    mockSignInWithPopup.mockResolvedValueOnce(makePopupResult(makeUser({ emailVerified: false })));

    renderButtons();
    clickGoogle();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('group')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('providerSignIn outcome typing', () => {
  it('exposes the five outcome discriminants', () => {
    const outcomes: ProviderSignInOutcome['status'][] = [
      'requires_otp',
      'unverified_email',
      'empty_email',
      'validation',
      'error',
    ];
    expect(outcomes).toHaveLength(5);
  });
});
