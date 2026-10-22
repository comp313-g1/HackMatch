import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyActionCode,
  onAuthStateChanged,
  onIdTokenChanged,
  getIdTokenResult,
  type User,
  type IdTokenResult,
} from 'firebase/auth';
import App from './App';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    applyActionCode: vi.fn(),
    checkActionCode: vi.fn(),
    signOut: vi.fn(),
    getIdTokenResult: vi.fn(),
    getIdToken: vi.fn().mockResolvedValue('mock-token'),
    onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: User | null) => void) => {
      cb(null);
      return () => {};
    }),
    onIdTokenChanged: vi.fn((_auth: unknown, cb: (user: User | null) => void) => {
      cb(null);
      return () => {};
    }),
  };
});

vi.mock('./components/teams/teamApi', async () => {
  const actual = await vi.importActual<typeof import('./components/teams/teamApi')>('./components/teams/teamApi');
  return {
    ...actual,
    fetchMyTeams: vi.fn().mockResolvedValue([]),
    fetchMyTeam: vi.fn().mockResolvedValue(null),
  };
});

describe('App Component (View Routing and Integration)', () => {
  const mockApplyActionCode = vi.mocked(applyActionCode);

  const primaryNav = () => screen.getByRole('navigation', { name: /primary/i });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
    // Default: signed out (clearAllMocks alone does not restore mockImplementation).
    const signedOut = ((_auth: unknown, cb: (user: User | null) => void) => {
      cb(null);
      return () => {};
    }) as unknown as typeof onAuthStateChanged;
    vi.mocked(onAuthStateChanged).mockImplementation(signedOut);
    vi.mocked(onIdTokenChanged).mockImplementation(signedOut as unknown as typeof onIdTokenChanged);
    vi.mocked(getIdTokenResult).mockReset();
  });

  it('renders the header with HackMatch branding', () => {
    render(<App />);
    const brand = screen.getByRole('button', { name: /hackmatch home/i });
    expect(brand).toBeInTheDocument();
    expect(brand).toHaveTextContent('HackMatch');
  });

  it('renders the accessible skip-to-content link', () => {
    render(<App />);
    const skipLink = screen.getByText(/skip to main content/i);
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');
  });

  it('renders the main landmark and production-safe footer', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('HackMatch')).toBeInTheDocument();
    expect(within(footer).queryByText(/COMP 313 Project 2/i)).not.toBeInTheDocument();
    expect(within(footer).queryByRole('button', { name: /probe \/api\/health/i })).not.toBeInTheDocument();
  });

  it('renders LandingPage by default when URL has no verification parameters', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /find your hackathon team/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();
  });

  it('renders RegistrationForm when URL contains view=register', () => {
    window.history.pushState({}, '', '/?view=register');
    render(<App />);
    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();
  });

  it('renders EmailVerificationView when URL contains mode=verifyEmail', async () => {
    window.history.pushState({}, '', '/?mode=verifyEmail&oobCode=url-test-code');
    mockApplyActionCode.mockResolvedValueOnce(undefined);

    render(<App />);

    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: /email verified successfully/i })
    ).toBeInTheDocument();
  });

  it('renders EmailVerificationView when URL contains view=verify', () => {
    window.history.pushState({}, '', '/?view=verify');

    render(<App />);

    expect(
      screen.getByRole('heading', { level: 2, name: /email verification/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();
  });

  it('renders PasswordRecoveryRequestForm when URL contains view=recover', () => {
    window.history.pushState({}, '', '/?view=recover');

    render(<App />);

    expect(screen.getByRole('heading', { level: 2, name: /reset password/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();
  });

  it('renders PasswordResetForm when URL contains mode=resetPassword', async () => {
    window.history.pushState({}, '', '/?mode=resetPassword&oobCode=reset-test-code');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        state: 'valid',
        email: 'reset@example.com',
        accountType: 'credential',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 2, name: /choose a new password/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/validate',
      expect.objectContaining({ method: 'POST' })
    );

    vi.unstubAllGlobals();
  });

  it('switches to verification view when RegistrationForm requests replacement link', async () => {
    window.history.pushState({}, '', '/?view=register');
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        message: 'User registered successfully',
        user: { id: 'test-id', email: 'registered@example.com' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    const main = screen.getByRole('main');
    // Fill and submit registration form
    fireEvent.change(within(main).getByLabelText(/full name/i), { target: { value: 'Test User' } });
    fireEvent.change(within(main).getByLabelText(/email address/i), {
      target: { value: 'registered@example.com' },
    });
    fireEvent.change(within(main).getByLabelText(/^password/i), {
      target: { value: 'Valid1@password' },
    });
    fireEvent.click(within(main).getByRole('button', { name: /create account/i }));

    // Wait for registration success view
    const replacementBtn = await screen.findByRole('button', {
      name: /didn't receive the email\? request a replacement link/i,
    });
    expect(replacementBtn).toBeInTheDocument();

    // Click replacement button
    fireEvent.click(replacementBtn);

    // Verify view transitioned to verification view and email is prefilled
    expect(
      await screen.findByRole('heading', { level: 2, name: /email verification/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue('registered@example.com');
  });

  it('navigates from EmailVerificationView to the sign-in form with status notice', async () => {
    window.history.pushState({}, '', '/?mode=verifyEmail&oobCode=sign-in-code');
    mockApplyActionCode.mockResolvedValueOnce(undefined);

    render(<App />);

    const signInBtn = await screen.findByRole('button', { name: /proceed to sign in/i });
    fireEvent.click(signInBtn);

    expect(within(primaryNav()).getByRole('button', { name: /^sign in$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByText(/participant account verified! you can now sign in/i)).toBeInTheDocument();
  });

  it('switches between landing, create account, and sign in via header nav and brand logo', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: /find your hackathon team/i })).toBeInTheDocument();

    fireEvent.click(within(primaryNav()).getByRole('button', { name: /create account/i }));
    expect(within(primaryNav()).getByRole('button', { name: /create account/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();

    fireEvent.click(within(primaryNav()).getByRole('button', { name: /^sign in$/i }));
    expect(within(primaryNav()).getByRole('button', { name: /^sign in$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(screen.getByRole('main')).getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /create an account/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /hackmatch home/i }));
    expect(screen.getByRole('heading', { level: 1, name: /find your hackathon team/i })).toBeInTheDocument();
  });

  it('does not show the account area to a signed-out visitor and links back to sign in', async () => {
    window.history.pushState({}, '', '/?view=account');

    render(<App />);

    expect(await screen.findByText(/you are not signed in/i)).toBeInTheDocument();
    expect(screen.queryByText(/you are signed in/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /go to sign in/i }));
    expect(within(primaryNav()).getByRole('button', { name: /^sign in$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('opens the sign-in form directly when ?view=login is in the URL', () => {
    window.history.pushState({}, '', '/?view=login');

    render(<App />);

    expect(within(primaryNav()).getByRole('button', { name: /^sign in$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(screen.getByRole('main')).getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('navigates from empty code verification view back to registration view when clicking back button', () => {
    window.history.pushState({}, '', '/?view=verify');

    render(<App />);

    const backBtn = screen.getByRole('button', { name: /back to registration/i });
    fireEvent.click(backBtn);

    expect(screen.getByRole('heading', { level: 2, name: /create an account/i })).toBeInTheDocument();
  });

  it('renders Choose an event first alert when visiting ?view=team without valid eventId', async () => {
    window.history.pushState({}, '', '/?view=team');

    render(<App />);

    expect(await screen.findByText(/you are not signed in/i)).toBeInTheDocument();
  });

  function mockSignedInUser(options?: {
    mfaComplete?: boolean;
    displayName?: string;
    role?: 'PART' | 'ADMIN' | null;
  }) {
    const mfaComplete = options?.mfaComplete ?? true;
    const role = options?.role === undefined ? 'PART' : options.role;
    const mockUser = {
      uid: 'user-nav-1',
      email: 'sahil@example.com',
      displayName: options?.displayName ?? 'Sahil Gupta',
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
    } as unknown as User;

    const emitUser = ((_auth: unknown, cb: (u: User | null) => void) => {
      cb(mockUser);
      return () => {};
    }) as unknown as typeof onAuthStateChanged;
    vi.mocked(onAuthStateChanged).mockImplementation(emitUser);
    vi.mocked(onIdTokenChanged).mockImplementation(emitUser as unknown as typeof onIdTokenChanged);

    const authTime = 1792000000;
    const claims: Record<string, unknown> = mfaComplete
      ? { auth_time: authTime, mfa_auth_time: authTime }
      : { auth_time: authTime };
    if (role) claims.role = role;
    vi.mocked(getIdTokenResult).mockResolvedValue({
      claims,
    } as unknown as IdTokenResult);

    return mockUser;
  }

  it('renders authenticated navigation (Profile, Teams, Sign out) and hides guest auth buttons when MFA session is ready', async () => {
    window.history.pushState({}, '', '/?view=account');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^profile$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(primaryNav()).getByRole('button', { name: /^teams$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^sign out/i })).toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-verification-pending')).not.toBeInTheDocument();
  });

  it('PART navbar hides Moderation and Accounts (#359)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^teams$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^chat$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^profile$/i })).toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^moderation$/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^accounts$/i })).not.toBeInTheDocument();
  });

  it('ADMIN navbar shows Moderation and Accounts (#359)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'ADMIN', displayName: 'Alex Admin' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^moderation$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^accounts$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^teams$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^sign out/i })).toBeInTheDocument();
  });

  it('PART mobile menu also hides Moderation and Accounts (#359)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^teams$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const mobile = screen.getByRole('region', { name: /mobile navigation/i });
    expect(within(mobile).getByRole('button', { name: /^teams$/i })).toBeInTheDocument();
    expect(within(mobile).queryByRole('button', { name: /^moderation$/i })).not.toBeInTheDocument();
    expect(within(mobile).queryByRole('button', { name: /^accounts$/i })).not.toBeInTheDocument();
  });

  it('renders Teams button with active state in primary nav when viewing team with MFA session', async () => {
    window.history.pushState(
      {},
      '',
      '/?view=team&eventId=123e4567-e89b-12d3-a456-426614174000'
    );
    mockSignedInUser({ mfaComplete: true });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^profile$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^teams$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(primaryNav()).getByRole('button', { name: /^sign out/i })).toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument();
  });

  it('shows verification-pending header (not full signed-in nav) when Firebase user lacks MFA claim (#355)', async () => {
    window.history.pushState({}, '', '/?view=mfa');
    mockSignedInUser({ mfaComplete: false, displayName: 'Sahil Gupta' });

    render(<App />);

    expect(await screen.findByTestId('header-verification-pending')).toHaveTextContent(
      /verification pending/i
    );
    expect(within(primaryNav()).getByRole('button', { name: /enter code/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /sign out \(sahil gupta\)/i })).toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^profile$/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^teams$/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: /enter verification code/i })
    ).toBeInTheDocument();
  });

  it('redirects Sign In to MFA when Firebase user exists without MFA claim', async () => {
    window.history.pushState({}, '', '/?view=login');
    mockSignedInUser({ mfaComplete: false, displayName: 'Sahil Gupta' });

    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 2, name: /enter verification code/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(await screen.findByTestId('header-verification-pending')).toBeInTheDocument();
  });

  it('clears verification-pending header when id token gains MFA claim after OTP (#355)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    const mockUser = {
      uid: 'user-nav-1',
      email: 'sahil@example.com',
      displayName: 'Sahil Gupta',
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
    } as unknown as User;

    let tokenListener: ((user: User | null) => void) | null = null;
    vi.mocked(onIdTokenChanged).mockImplementation(((_auth: unknown, cb: (u: User | null) => void) => {
      tokenListener = cb;
      cb(mockUser);
      return () => {};
    }) as unknown as typeof onIdTokenChanged);
    vi.mocked(onAuthStateChanged).mockImplementation(((_auth: unknown, cb: (u: User | null) => void) => {
      cb(mockUser);
      return () => {};
    }) as unknown as typeof onAuthStateChanged);

    const authTime = 1792000000;
    vi.mocked(getIdTokenResult)
      .mockResolvedValueOnce({
        claims: { auth_time: authTime },
      } as unknown as IdTokenResult)
      .mockResolvedValueOnce({
        claims: { auth_time: authTime, mfa_auth_time: authTime },
      } as unknown as IdTokenResult);

    render(<App />);

    expect(await screen.findByTestId('header-verification-pending')).toBeInTheDocument();

    await act(async () => {
      tokenListener?.(mockUser);
    });

    expect(await within(primaryNav()).findByRole('button', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.queryByTestId('header-verification-pending')).not.toBeInTheDocument();
  });

  it('toggles mobile menu when clicking menu button', () => {
    render(<App />);

    const menuBtn = screen.getByRole('button', { name: /open menu/i });
    expect(menuBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(menuBtn);
    expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: /mobile navigation/i })).toBeInTheDocument();

    fireEvent.click(menuBtn);
    expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: /mobile navigation/i })).not.toBeInTheDocument();
  });

  it('renders the MFA gate when ?view=mfa is visited while signed out', async () => {
    window.history.pushState({}, '', '/?view=mfa');
    render(<App />);

    expect(await screen.findByText(/you are not signed in/i)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('button', { name: /go to sign in/i })).toBeInTheDocument();
  });

  it('transitions from mfa view to the participant landing page upon successful MFA verification', async () => {
    window.history.pushState({}, '', '/?view=mfa');
    const mockUser = {
      uid: 'user-p1',
      email: 't1comp313brian@gmail.com',
      displayName: 'Brian',
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
    } as unknown as User;

    const emitUser = ((_auth: unknown, cb: (u: User | null) => void) => {
      cb(mockUser);
      return () => {};
    }) as unknown as typeof onAuthStateChanged;
    vi.mocked(onAuthStateChanged).mockImplementation(emitUser);
    vi.mocked(onIdTokenChanged).mockImplementation(emitUser as unknown as typeof onIdTokenChanged);

    vi.mocked(getIdTokenResult).mockResolvedValue({
      claims: { auth_time: 1792000000, mfa_auth_time: 1792000000, role: 'PART' },
    } as unknown as IdTokenResult);

    render(<App />);

    // Post-MFA landing page should display hero and participant buttons
    expect(
      await screen.findByRole('heading', { level: 1, name: /find your hackathon team/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^teams workspace$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /your profile/i })).toBeInTheDocument();
    // And search / events directory section is visible on the participant landing page
    expect(screen.getByRole('searchbox', { name: /search hackathons/i })).toBeInTheDocument();
    expect(screen.getByText(/no events match your criteria/i)).toBeInTheDocument();

    // Clicking Profile in header navigates to account view (SignedInPanel)
    fireEvent.click(within(primaryNav()).getByRole('button', { name: /^profile$/i }));
    expect(await screen.findByRole('heading', { level: 3, name: /you are signed in/i })).toBeInTheDocument();
    expect(screen.getByText(/manage technical profile/i)).toBeInTheDocument();

    // Clicking Teams in header navigates to MyTeamsPage view
    fireEvent.click(within(primaryNav()).getByRole('button', { name: /^teams$/i }));
    expect(await screen.findByRole('heading', { level: 1, name: /my teams/i })).toBeInTheDocument();
    const createTeamBtns = screen.getAllByRole('button', { name: /create a team/i });
    expect(createTeamBtns.length).toBeGreaterThan(0);

    // Clicking Create a team navigates to CreateTeamPage
    fireEvent.click(createTeamBtns[0]);
    expect(await screen.findByRole('heading', { level: 1, name: /create a new team/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/team name/i)).toBeInTheDocument();
  });
});

