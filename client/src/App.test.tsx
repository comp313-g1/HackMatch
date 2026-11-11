import React from 'react';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
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
import { fetchAuditRecords } from './components/audit/auditApi';
import { listNotifications, markNotificationRead } from './components/notifications/notificationsApi';
import {
  fetchRecommendedTeams,
  type RecommendedTeam,
  type RecommendedTeamsResponse,
} from './components/recommendations/recommendedTeamsApi';
import {
  ApplicationsApiError,
  submitTeamApplication,
} from './components/teams/applicationsApi';

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

vi.mock('./components/teams/openTeamsApi', async () => {
  const actual = await vi.importActual<typeof import('./components/teams/openTeamsApi')>(
    './components/teams/openTeamsApi'
  );
  return {
    ...actual,
    fetchOpenTeams: vi.fn().mockResolvedValue({ viewer: 'VISITOR', total: 0, teams: [] }),
  };
});

vi.mock('./services/availabilityApi', () => ({
  fetchAvailableCandidates: vi.fn().mockResolvedValue([]),
  fetchMyAvailability: vi.fn().mockResolvedValue(null),
  updateMyAvailability: vi.fn(),
}));

vi.mock('./components/notifications/notificationsApi', async () => {
  const actual = await vi.importActual<typeof import('./components/notifications/notificationsApi')>(
    './components/notifications/notificationsApi'
  );
  return {
    ...actual,
    listNotifications: vi.fn().mockResolvedValue({ notifications: [], unreadCount: 0, nextCursor: null }),
    markNotificationRead: vi.fn().mockResolvedValue({ notification: { readAt: '2026-11-03T12:00:00Z' }, alreadyRead: false, unreadCount: 0 }),
    markAllNotificationsRead: vi.fn(),
  };
});
vi.mock('./components/recommendations/recommendedTeamsApi', async () => {
  const actual = await vi.importActual<typeof import('./components/recommendations/recommendedTeamsApi')>(
    './components/recommendations/recommendedTeamsApi'
  );
  return {
    ...actual,
    fetchRecommendedTeams: vi.fn().mockResolvedValue({
      recommendations: [],
      empty: true,
      eligibilityReason: 'participant_not_looking',
      message: null,
      notice: null,
    }),
  };
});
vi.mock('./components/teams/applicationsApi', async () => {
  const actual = await vi.importActual<typeof import('./components/teams/applicationsApi')>(
    './components/teams/applicationsApi'
  );
  return {
    ...actual,
    submitTeamApplication: vi.fn(),
  };
});
vi.mock('./components/audit/auditApi', async () => {
  const actual = await vi.importActual<typeof import('./components/audit/auditApi')>(
    './components/audit/auditApi'
  );
  return {
    ...actual,
    fetchAuditRecords: vi.fn().mockResolvedValue({ records: [], hasMore: false, nextCursor: null }),
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
    vi.mocked(fetchRecommendedTeams).mockReset().mockResolvedValue({
      recommendations: [],
      empty: true,
      eligibilityReason: 'participant_not_looking',
      message: null,
      notice: null,
    });
    vi.mocked(submitTeamApplication).mockReset();
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
    expect(screen.getByRole('heading', { level: 1, name: /find your team/i })).toBeInTheDocument();
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

    expect(screen.getByRole('heading', { level: 1, name: /find your team/i })).toBeInTheDocument();

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
    expect(screen.getByRole('heading', { level: 1, name: /find your team/i })).toBeInTheDocument();
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

  it('renders authenticated navigation with account menu and hides guest auth buttons when MFA session is ready (#358)', async () => {
    window.history.pushState({}, '', '/?view=account');
    mockSignedInUser({ mfaComplete: true, role: 'PART', displayName: 'Sahil Gupta' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^open teams$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^find teammates$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^requests$/i })).toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /browse events/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^chat$/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();

    fireEvent.click(within(primaryNav()).getByRole('button', { name: /sahil gupta/i }));
    expect(await screen.findByRole('menuitem', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^sign out$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^open chat$/i })).toBeInTheDocument();
    expect(screen.queryByTestId('header-verification-pending')).not.toBeInTheDocument();
  });

  it('offers Recommended teams in the navigation and opens the page from it (US-016 / #156)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'PART', displayName: 'Sahil Gupta' });

    render(<App />);

    const link = await within(primaryNav()).findByRole('button', { name: /^recommended teams$/i });
    fireEvent.click(link);

    expect(await screen.findByRole('heading', { level: 1, name: /^recommended teams$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^recommended teams$/i })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('recommended-teams-empty')).toHaveTextContent(/turn on looking for team/i);
  });

  it('opens the recommended teams page directly from ?view=recommended-teams (US-016 / #156)', async () => {
    window.history.pushState({}, '', '/?view=recommended-teams');
    mockSignedInUser({ mfaComplete: true, role: 'PART', displayName: 'Sahil Gupta' });

    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: /^recommended teams$/i })).toBeInTheDocument();
  });

  it('sends the empty-state button to Looking for Team (US-016 / #156)', async () => {
    window.history.pushState({}, '', '/?view=recommended-teams');
    mockSignedInUser({ mfaComplete: true, role: 'PART', displayName: 'Sahil Gupta' });

    render(<App />);

    fireEvent.click(await screen.findByTestId('go-to-looking'));
    expect(await screen.findByRole('heading', { level: 2, name: /looking for team/i })).toBeInTheDocument();
  });

  it('does not show the recommended teams page to a signed-out visitor (US-016 / #156)', async () => {
    window.history.pushState({}, '', '/?view=recommended-teams');

    render(<App />);

    expect(screen.queryByRole('heading', { level: 1, name: /^recommended teams$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('recommended-team')).not.toBeInTheDocument();
  });

  const recommendedTeam = (over: Partial<RecommendedTeam> = {}): RecommendedTeam => ({
    rank: 1,
    teamId: 'team-a',
    vacancyId: 'vacancy-a',
    teamName: 'Civic Signal',
    goal: 'Learning',
    commitmentHours: 12,
    vacancyRole: 'Backend' as const,
    matchPercent: 85,
    matchedSkills: ['Node.js'],
    missingSkills: ['PostgreSQL'],
    roleMatched: true,
    contributions: {
      skill: 'Matched 1 of 2 required skills.',
      goal: 'Identical goals.',
      hours: 'Commitment 12h vs requested 12h.',
    },
    ...over,
  });

  const recommendationList = (
    teams: RecommendedTeam[] = [recommendedTeam()]
  ): RecommendedTeamsResponse => ({
    recommendations: teams,
    empty: teams.length === 0,
    eligibilityReason: null,
    message: null,
    notice: 'Scores use self-declared information.',
  });

  it('opens the existing US-018 form for the recommended team and refreshes after success (#157)', async () => {
    window.history.pushState({}, '', '/?view=recommended-teams');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });
    vi.mocked(fetchRecommendedTeams)
      .mockResolvedValueOnce(recommendationList())
      .mockResolvedValueOnce(recommendationList([]));
    vi.mocked(submitTeamApplication).mockResolvedValue({
      id: 'application-1',
      teamId: 'team-a',
      vacancyId: 'vacancy-a',
      applicantParticipantId: 'participant-1',
      status: 'Pending',
      requestType: 'Application',
      message: 'I would like to help.',
      createdAt: '2026-11-11T15:00:00.000Z',
      teamName: 'Civic Signal',
      vacancyRole: 'Backend',
      notice: 'Application submitted for review.',
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /apply to civic signal/i }));

    expect(screen.getByRole('dialog', { name: /apply to join civic signal/i })).toBeInTheDocument();
    expect(screen.getByTestId('application-form-team')).toHaveTextContent('Civic Signal');
    expect(screen.getByTestId('application-form-slot')).toHaveTextContent('Backend');
    fireEvent.change(screen.getByTestId('application-message-input'), {
      target: { value: 'I would like to help.' },
    });
    fireEvent.click(screen.getByTestId('submit-application'));

    await waitFor(() => {
      expect(submitTeamApplication).toHaveBeenCalledWith('team-a', {
        vacancyId: 'vacancy-a',
        message: 'I would like to help.',
      });
    });
    expect(await screen.findByTestId('application-form-success')).toHaveTextContent(
      'Application submitted for review.'
    );
    await waitFor(() => expect(fetchRecommendedTeams).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('recommended-teams-empty')).toBeInTheDocument();
  });

  it('keeps the recommended team and draft when existing US-018 validation fails (#157)', async () => {
    window.history.pushState({}, '', '/?view=recommended-teams');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });
    vi.mocked(fetchRecommendedTeams).mockResolvedValue(recommendationList());

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /apply to civic signal/i }));
    const draft = 'x'.repeat(251);
    fireEvent.change(screen.getByTestId('application-message-input'), { target: { value: draft } });
    fireEvent.click(screen.getByTestId('submit-application'));

    expect(await screen.findByTestId('application-message-error')).toHaveTextContent(/at most 250/i);
    expect(screen.getByTestId('application-message-input')).toHaveValue(draft);
    expect(screen.getByTestId('application-form-team')).toHaveTextContent('Civic Signal');
    expect(submitTeamApplication).not.toHaveBeenCalled();
  });

  it('keeps recommendation context and entered data when the server rejects a stale team (#157)', async () => {
    window.history.pushState({}, '', '/?view=recommended-teams');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });
    vi.mocked(fetchRecommendedTeams).mockResolvedValue(recommendationList());
    vi.mocked(submitTeamApplication).mockRejectedValue(
      new ApplicationsApiError(
        409,
        'TEAM_NOT_RECRUITING',
        undefined,
        undefined,
        'This team is no longer accepting applications.'
      )
    );

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /apply to civic signal/i }));
    fireEvent.change(screen.getByTestId('application-message-input'), {
      target: { value: 'Please keep this draft.' },
    });
    fireEvent.click(screen.getByTestId('submit-application'));

    expect(await screen.findByTestId('application-form-error')).toHaveTextContent(
      'This team is no longer accepting applications.'
    );
    expect(screen.getByTestId('application-message-input')).toHaveValue('Please keep this draft.');
    expect(screen.getByTestId('application-form-team')).toHaveTextContent('Civic Signal');
  });

  it('isolates recommendation state when Team A is closed before applying to Team B (#157)', async () => {
    window.history.pushState({}, '', '/?view=recommended-teams');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });
    vi.mocked(fetchRecommendedTeams).mockResolvedValue(
      recommendationList([
        recommendedTeam(),
        recommendedTeam({
          rank: 2,
          teamId: 'team-b',
          vacancyId: 'vacancy-b',
          teamName: 'Health Bridge',
          vacancyRole: 'Frontend',
        }),
      ])
    );

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /apply to civic signal/i }));
    fireEvent.change(screen.getByTestId('application-message-input'), {
      target: { value: 'Team A draft' },
    });
    fireEvent.click(screen.getByTestId('application-form-dismiss'));
    fireEvent.click(screen.getByRole('button', { name: /apply to health bridge/i }));

    expect(screen.getByTestId('application-form-team')).toHaveTextContent('Health Bridge');
    expect(screen.getByTestId('application-form-slot')).toHaveTextContent('Frontend');
    expect(screen.getByTestId('application-message-input')).toHaveValue('');
  });

  it('PART navbar hides Moderation and Accounts (#359 / #358)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'PART', displayName: 'Sahil Gupta' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^admin/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^moderation$/i })).not.toBeInTheDocument();
    expect(within(primaryNav()).queryByRole('button', { name: /^accounts$/i })).not.toBeInTheDocument();
  });

  it('shows the notification bell with unread badge for a signed-in participant (US-021 AC 1)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });
    vi.mocked(listNotifications).mockResolvedValue({ notifications: [], unreadCount: 4, nextCursor: null });

    render(<App />);

    expect(await screen.findByRole('button', { name: /notifications, 4 unread/i })).toBeInTheDocument();
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('4');
  });

  it('hides the notification bell when signed out, MFA is pending, or the user is an admin', async () => {
    window.history.pushState({}, '', '/?view=landing');
    const { unmount } = render(<App />);
    expect(screen.queryByRole('button', { name: /^notifications,/i })).not.toBeInTheDocument();
    unmount();

    mockSignedInUser({ mfaComplete: false, role: 'PART' });
    const pending = render(<App />);
    expect(await screen.findByTestId('header-verification-pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^notifications,/i })).not.toBeInTheDocument();
    pending.unmount();

    mockSignedInUser({ mfaComplete: true, role: 'ADMIN' });
    render(<App />);
    expect(await within(primaryNav()).findByRole('button', { name: /^admin/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^notifications,/i })).not.toBeInTheDocument();
  });

  it('opens the Invitations tab when an invitation notification is clicked (US-021 AC 3)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });
    vi.mocked(listNotifications).mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          type: 'team_invitation',
          category: 'invitation',
          message: 'You were invited to Team Rocket',
          teamId: 't1',
          eventId: 'e1',
          requestId: null,
          submissionId: null,
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
      nextCursor: null,
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /notifications, 1 unread/i }));
    fireEvent.click(await screen.findByText('You were invited to Team Rocket'));

    expect(await screen.findByRole('heading', { name: /^requests$/i, level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /notifications/i })).not.toBeInTheDocument();
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
  });

  it('ADMIN navbar exposes Moderation and Accounts under Admin menu (#359 / #358)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'ADMIN', displayName: 'Alex Admin' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^admin/i })).toBeInTheDocument();
    fireEvent.click(within(primaryNav()).getByRole('button', { name: /^admin/i }));
    expect(await screen.findByRole('menuitem', { name: /^moderation$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^accounts$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
  });

  it('ADMIN Admin menu offers an Audit log entry that opens the audit records page (US-028 / #259)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'ADMIN', displayName: 'Alex Admin' });
    vi.mocked(fetchAuditRecords).mockResolvedValue({
      records: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          actionType: 'moderation_warn',
          category: 'moderation',
          targetType: 'team',
          targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          reason: 'Spam in pitch',
          outcome: 'Applied',
          safeStateSummary: {},
          createdAt: '2026-11-03T10:00:00.000000Z',
        },
      ],
      hasMore: false,
      nextCursor: null,
    });

    render(<App />);

    fireEvent.click(await within(primaryNav()).findByRole('button', { name: /^admin/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^audit log$/i }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Spam in pitch')).toBeInTheDocument();
    expect(screen.getByText('2026-11-03 10:00:00 UTC')).toBeInTheDocument();
    expect(fetchAuditRecords).toHaveBeenCalledWith({ limit: 25 });
  });

  it('opens the audit records page directly from ?view=audit for an ADMIN', async () => {
    window.history.pushState({}, '', '/?view=audit');
    mockSignedInUser({ mfaComplete: true, role: 'ADMIN' });
    vi.mocked(fetchAuditRecords).mockResolvedValue({ records: [], hasMore: false, nextCursor: null });

    render(<App />);

    expect(await screen.findByTestId('audit-empty')).toBeInTheDocument();
  });

  it('shows the access-denied state if a non-admin reaches the audit page (server returns 403)', async () => {
    window.history.pushState({}, '', '/?view=audit');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });
    const { AuditApiError } = await import('./components/audit/auditApi');
    vi.mocked(fetchAuditRecords).mockRejectedValue(new AuditApiError(403, 'FORBIDDEN_ROLE', 'x'));

    render(<App />);

    expect(await screen.findByTestId('audit-denied')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('PART users never see an Audit log entry in the desktop or mobile menus (US-028 AC 3)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /audit log/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /audit log/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const mobile = screen.getByRole('region', { name: /mobile navigation/i });
    expect(within(mobile).queryByRole('button', { name: /audit log/i })).not.toBeInTheDocument();
  });

  it('ADMIN mobile menu includes Audit log', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'ADMIN' });

    render(<App />);

    await within(primaryNav()).findByRole('button', { name: /^admin/i });
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const mobile = screen.getByRole('region', { name: /mobile navigation/i });
    expect(within(mobile).getByRole('button', { name: /^audit log$/i })).toBeInTheDocument();
  });

  it('PART mobile menu also hides Moderation and Accounts (#359 / #358)', async () => {
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser({ mfaComplete: true, role: 'PART' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const mobile = screen.getByRole('region', { name: /mobile navigation/i });
    expect(within(mobile).getByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
    expect(within(mobile).getByRole('button', { name: /^requests$/i })).toBeInTheDocument();
    expect(within(mobile).queryByRole('button', { name: /^moderation$/i })).not.toBeInTheDocument();
    expect(within(mobile).queryByRole('button', { name: /^accounts$/i })).not.toBeInTheDocument();
  });

  it('renders My teams button with active state in primary nav when viewing team with MFA session', async () => {
    window.history.pushState(
      {},
      '',
      '/?view=team&eventId=123e4567-e89b-12d3-a456-426614174000'
    );
    mockSignedInUser({ mfaComplete: true, displayName: 'Sahil Gupta' });

    render(<App />);

    expect(await within(primaryNav()).findByRole('button', { name: /sahil gupta/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^my teams$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
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

    expect(await within(primaryNav()).findByRole('button', { name: /sahil gupta/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
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

    // Post-MFA landing page: event-free hero + nav-aligned CTAs (#361)
    expect(
      await screen.findByRole('heading', { level: 1, name: /find your team/i })
    ).toBeInTheDocument();
    const hero = screen.getByRole('region', { name: /hackmatch hero/i });
    expect(within(hero).getByRole('button', { name: /^open teams$/i })).toBeInTheDocument();
    expect(within(hero).getByRole('button', { name: /^my teams$/i })).toBeInTheDocument();
    expect(within(hero).getByRole('button', { name: /^find teammates$/i })).toBeInTheDocument();
    expect(within(hero).getByRole('button', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search teams or people/i })).toBeInTheDocument();
    expect(await screen.findByText(/no teams match your search/i)).toBeInTheDocument();

    // Account menu → Profile navigates to account view (SignedInPanel)
    fireEvent.click(within(primaryNav()).getByRole('button', { name: /brian/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^profile$/i }));
    expect(await screen.findByRole('heading', { level: 3, name: /you are signed in/i })).toBeInTheDocument();
    expect(screen.getByText(/manage technical profile/i)).toBeInTheDocument();

    // Clicking My teams in header navigates to MyTeamsPage view
    fireEvent.click(within(primaryNav()).getByRole('button', { name: /^my teams$/i }));
    expect(await screen.findByRole('heading', { level: 1, name: /my teams/i })).toBeInTheDocument();
    const createTeamBtns = screen.getAllByRole('button', { name: /create a team/i });
    expect(createTeamBtns.length).toBeGreaterThan(0);

    // Clicking Create a team navigates to CreateTeamPage
    fireEvent.click(createTeamBtns[0]);
    expect(await screen.findByRole('heading', { level: 1, name: /create a new team/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/team name/i)).toBeInTheDocument();
  });
});

