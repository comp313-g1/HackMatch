import React, { useEffect, useState } from 'react';
import { getIdTokenResult, onIdTokenChanged, type User } from 'firebase/auth';
import { auth } from './config/firebase';
import { logout } from './components/auth/logout';
import { hasCompletedMfa } from './components/auth/mfaClaim';
import { readAppRole, type AppRole } from './components/auth/roleClaim';
import { LandingPage } from './components/landing/LandingPage';
import { RegistrationForm } from './components/auth/RegistrationForm';
import { EmailVerificationView } from './components/auth/EmailVerificationView';
import { LoginForm } from './components/auth/LoginForm';
import { PasswordRecoveryRequestForm } from './components/auth/PasswordRecoveryRequestForm';
import { PasswordResetForm } from './components/auth/PasswordResetForm';
import { MfaGate } from './components/auth/MfaGate';
import { SignedInPanel } from './components/auth/SignedInPanel';
import { TeamWorkspace } from './components/teams/TeamWorkspace';
import { MyTeamsPage } from './components/teams/MyTeamsPage';
import { CreateTeamPage } from './components/teams/CreateTeamPage';
import { LookingForTeamPage } from './components/LookingForTeamPage';
import { OpenTeamsBoard } from './components/teams/OpenTeamsBoard';
import { ApplicationFormPanel } from './components/teams/ApplicationFormPanel';
import { RequestsPage, type RequestsTab } from './components/RequestsPage';
import { ModerationSafetyPage } from './components/moderation/ModerationSafetyPage';
import { AccountEnforcementPage } from './components/accounts/AccountEnforcementPage';
import { ChatPage } from './components/chat/ChatPage';
import type { OpenTeamApplyTarget } from './components/teams/openTeamsApi';
import type { OtpChallenge } from './components/auth/providerSignIn';

type View =
  | 'landing'
  | 'register'
  | 'login'
  | 'mfa'
  | 'verify'
  | 'account'
  | 'recover'
  | 'reset'
  | 'team'
  | 'create-team'
  | 'looking'
  | 'browse-teams'
  | 'requests'
  | 'moderation'
  | 'accounts'
  | 'chat';

const getInitialRequestsTab = (): RequestsTab => {
  if (typeof window === 'undefined') return 'applications';
  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'invitations' || view === 'my-invitations') return 'invitations';
  return 'applications';
};

const getInitialView = (): View => {
  if (typeof window === 'undefined') return 'landing';
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const view = params.get('view');
  if (mode === 'verifyEmail' || view === 'verify' || view === 'resend-verification') {
    return 'verify';
  }
  // Password-reset continue URL may include view=login; mode wins (US-005 S1-P1-14).
  if (mode === 'resetPassword' || view === 'reset') {
    return 'reset';
  }
  if (view === 'login' || view === 'signin') {
    return 'login';
  }
  if (view === 'mfa' || view === 'otp') {
    return 'mfa';
  }
  if (view === 'account') {
    return 'account';
  }
  if (view === 'team') {
    return 'team';
  }
  if (view === 'looking' || view === 'lft') {
    return 'looking';
  }
  if (view === 'recover' || view === 'forgot-password') {
    return 'recover';
  }
  if (view === 'register' || view === 'signup') {
    return 'register';
  }
  if (view === 'browse-teams' || view === 'open-teams') {
    return 'browse-teams';
  }
  if (
    view === 'requests' ||
    view === 'applications' ||
    view === 'my-applications' ||
    view === 'invitations' ||
    view === 'my-invitations'
  ) {
    return 'requests';
  }
  if (view === 'moderation' || view === 'safety-queue') {
    return 'moderation';
  }
  if (view === 'accounts' || view === 'account-enforcement') {
    return 'accounts';
  }
  if (view === 'chat' || view === 'forums' || view === 'messaging') {
    return 'chat';
  }
  return 'landing';
};

const navLinkClass = (active: boolean) =>
  `text-sm font-medium rounded px-2 py-1 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream ${
    active
      ? 'text-forest-900 font-semibold ring-1 ring-forest'
      : 'text-ink-muted hover:text-forest-800'
  }`;


export function App(): React.JSX.Element {
  const [currentView, setCurrentView] = useState<View>(getInitialView);
  const [verificationEmail, setVerificationEmail] = useState<string>('');
  const [recoveryEmail, setRecoveryEmail] = useState<string>('');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<OpenTeamApplyTarget | null>(null);
  const [teamEventId, setTeamEventId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('eventId') ?? '';
  });
  const [currentUser, setCurrentUser] = useState<User | null>(() => auth.currentUser);
  /** null = checking token claims; true = MFA done; false = signed out or MFA still required (#355). */
  const [mfaComplete, setMfaComplete] = useState<boolean | null>(null);
  /** From Firebase `role` claim after MFA session is ready (#359). null while unknown / signed out. */
  const [authRole, setAuthRole] = useState<AppRole | null>(null);
  const [signingOut, setSigningOut] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [otpChallenge, setOtpChallenge] = useState<OtpChallenge | null>(null);
  const [requestsTab, setRequestsTab] = useState<RequestsTab>(getInitialRequestsTab);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // onIdTokenChanged covers sign-in/out AND post-MFA token refresh (claim updates).
    // onAuthStateChanged alone left the header stuck on "Verification pending" after OTP (#355).
    const unsubscribe = onIdTokenChanged(auth, (user) => {
      setCurrentUser(user);
      if (!user) {
        setMfaComplete(false);
        setAuthRole(null);
        return;
      }
      setMfaComplete(null);
      setAuthRole(null);
      void getIdTokenResult(user)
        .then((result) => {
          if (cancelled) return;
          const claims = result.claims as Record<string, unknown>;
          setMfaComplete(hasCompletedMfa(claims));
          setAuthRole(readAppRole(claims));
        })
        .catch(() => {
          if (cancelled) return;
          // Fail closed: treat as verification still required (do not show full session nav).
          setMfaComplete(false);
          setAuthRole(null);
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const closeMenus = () => {
    setIsMobileMenuOpen(false);
    setAccountMenuOpen(false);
    setAdminMenuOpen(false);
  };

  const goToLanding = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('landing');
  };

  const goToRegister = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('register');
  };

  const goToLogin = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('login');
  };

  const goToAccount = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('account');
  };

  const goToTeam = () => {
    setStatusNotice(null);
    setTeamEventId('');
    closeMenus();
    setCurrentView('team');
  };

  const handleSelectEvent = (eventId: string) => {
    setTeamEventId(eventId);
    setStatusNotice(null);
    closeMenus();
    setCurrentView('team');
  };

  const handleHeaderSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    closeMenus();
    try {
      await logout(auth.currentUser);
      setStatusNotice('You have been signed out.');
      setCurrentView('login');
    } catch {
      setStatusNotice('Failed to sign out cleanly. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  const goToCreateTeam = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('create-team');
  };

  const goToLooking = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('looking');
  };

  const goToBrowseTeams = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('browse-teams');
  };

  const goToRequests = (tab: RequestsTab = 'applications') => {
    setStatusNotice(null);
    setApplyTarget(null);
    setRequestsTab(tab);
    setAccountMenuOpen(false);
    setAdminMenuOpen(false);
    setIsMobileMenuOpen(false);
    setCurrentView('requests');
  };

  const goToModeration = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('moderation');
  };

  const goToAccounts = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('accounts');
  };

  const goToChat = () => {
    setStatusNotice(null);
    closeMenus();
    setCurrentView('chat');
  };

  useEffect(() => {
    if (!accountMenuOpen && !adminMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('[data-nav-menu-root="true"]')) return;
      setAccountMenuOpen(false);
      setAdminMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [accountMenuOpen, adminMenuOpen]);

  // #355 — full app chrome only after Firebase user + MFA claim; primary auth alone is not a session.
  const sessionReady = Boolean(currentUser) && mfaComplete === true;
  const verificationPending = Boolean(currentUser) && mfaComplete === false;
  // #359 — ADMIN-only nav links; missing/invalid claim never unlocks admin chrome.
  const showAdminNav = sessionReady && authRole === 'ADMIN';
  const participantIdentifier =
    currentUser?.displayName ||
    (currentUser?.email ? currentUser.email.split('@')[0] : 'participant');

  // Password auth can succeed while OTP is rate-limited; do not leave Sign In open
  // under a "Verification pending" / Sign out (Name) header.
  useEffect(() => {
    if (!verificationPending) return;
    if (currentView === 'login' || currentView === 'register') {
      setCurrentView('mfa');
    }
  }, [verificationPending, currentView]);

  return (
    <div className="flex flex-col min-h-screen bg-cream text-ink font-sans">
      {/* Skip to Content Link for WCAG 2.1 AA Compliance per NR-018 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-forest focus:text-white focus:rounded"
      >
        Skip to main content
      </a>

      {/* Semantic Header Landmark */}
      <header className="sticky top-0 z-40 bg-cream-50/95 border-b border-cream-200 backdrop-blur" role="banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={goToLanding}
            className="flex items-center gap-2 shrink-0 rounded focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream"
            aria-label="HackMatch home"
          >
            <span className="font-display text-2xl font-semibold tracking-tight text-forest-900">
              HackMatch
            </span>
          </button>

          {/* Desktop Primary Nav (#358) */}
          <nav className="hidden md:flex items-center gap-2 lg:gap-3" aria-label="Primary">
            <button
              type="button"
              onClick={goToBrowseTeams}
              aria-current={currentView === 'browse-teams' ? 'page' : undefined}
              className={navLinkClass(currentView === 'browse-teams')}
            >
              Open teams
            </button>

            {sessionReady ? (
              <>
                <button
                  type="button"
                  onClick={goToTeam}
                  aria-current={currentView === 'team' ? 'page' : undefined}
                  className={navLinkClass(currentView === 'team')}
                >
                  My teams
                </button>
                <button
                  type="button"
                  onClick={goToLooking}
                  aria-current={currentView === 'looking' ? 'page' : undefined}
                  className={navLinkClass(currentView === 'looking')}
                >
                  Find teammates
                </button>
                <button
                  type="button"
                  onClick={() => goToRequests('applications')}
                  aria-current={currentView === 'requests' ? 'page' : undefined}
                  className={navLinkClass(currentView === 'requests')}
                >
                  Requests
                </button>

                {showAdminNav && (
                  <div className="relative" data-nav-menu-root="true">
                    <button
                      type="button"
                      onClick={() => {
                        setAdminMenuOpen((open) => !open);
                        setAccountMenuOpen(false);
                      }}
                      aria-expanded={adminMenuOpen}
                      aria-haspopup="menu"
                      className="text-sm font-semibold rounded-md px-3 py-2 border border-cream-300 text-ink hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream"
                    >
                      Admin ▾
                    </button>
                    {adminMenuOpen && (
                      <div
                        role="menu"
                        aria-label="Admin"
                        className="absolute right-0 mt-2 w-44 rounded-lg border border-cream-200 bg-white shadow-sm p-1 z-50"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={goToModeration}
                          className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-cream-50"
                        >
                          Moderation
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={goToAccounts}
                          className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-cream-50"
                        >
                          Accounts
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="relative ml-1" data-nav-menu-root="true">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen((open) => !open);
                      setAdminMenuOpen(false);
                    }}
                    aria-expanded={accountMenuOpen}
                    aria-haspopup="menu"
                    className="text-sm font-semibold rounded-md px-3.5 py-2 border border-cream-300 text-ink hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream"
                  >
                    {participantIdentifier} ▾
                  </button>
                  {accountMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Account"
                      className="absolute right-0 mt-2 w-44 rounded-lg border border-cream-200 bg-white shadow-sm p-1 z-50"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={goToAccount}
                        className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-cream-50"
                      >
                        Profile
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void handleHeaderSignOut()}
                        disabled={signingOut}
                        className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-cream-50 disabled:opacity-50"
                      >
                        {signingOut ? 'Signing out...' : 'Sign out'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : verificationPending ? (
              <>
                <span
                  className="text-xs font-semibold uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1"
                  data-testid="header-verification-pending"
                >
                  Verification pending
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setStatusNotice(null);
                    closeMenus();
                    setCurrentView('mfa');
                  }}
                  className="text-sm font-medium text-forest-800 hover:underline rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forest"
                >
                  Enter code
                </button>
                <button
                  type="button"
                  onClick={() => void handleHeaderSignOut()}
                  disabled={signingOut}
                  className="text-sm font-semibold rounded-md px-3.5 py-2 border border-cream-300 text-ink hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream disabled:opacity-50"
                >
                  {signingOut ? 'Signing out...' : `Sign out (${participantIdentifier})`}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goToLogin}
                  aria-current={currentView === 'login' ? 'page' : undefined}
                  className={navLinkClass(currentView === 'login')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={goToRegister}
                  aria-current={currentView === 'register' ? 'page' : undefined}
                  className="text-sm font-semibold rounded-md px-3.5 py-2 bg-forest text-white hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream"
                >
                  Create account
                </button>
              </>
            )}
          </nav>

          {/* Mobile Menu Button per wireframe (md:hidden) */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMobileMenuOpen}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-cream-200 text-ink md:hidden focus:outline-none focus:ring-2 focus:ring-forest"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              {isMobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {isMobileMenuOpen && (
          <div
            className="md:hidden border-t border-cream-200 bg-cream-50 px-4 pt-3 pb-4 space-y-2"
            role="region"
            aria-label="Mobile navigation"
          >
            <button
              type="button"
              onClick={goToBrowseTeams}
              className="block w-full text-left px-3 py-2 text-sm font-medium text-ink hover:bg-cream-100 rounded"
            >
              Open teams
            </button>
            {sessionReady ? (
              <>
                <button
                  type="button"
                  onClick={goToTeam}
                  className="block w-full text-left px-3 py-2 text-sm font-medium text-ink hover:bg-cream-100 rounded"
                >
                  My teams
                </button>
                <button
                  type="button"
                  onClick={goToLooking}
                  className="block w-full text-left px-3 py-2 text-sm font-medium text-ink hover:bg-cream-100 rounded"
                >
                  Find teammates
                </button>
                <button
                  type="button"
                  onClick={() => goToRequests('applications')}
                  className="block w-full text-left px-3 py-2 text-sm font-medium text-ink hover:bg-cream-100 rounded"
                >
                  Requests
                </button>
                {showAdminNav && (
                  <>
                    <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Admin
                    </p>
                    <button
                      type="button"
                      onClick={goToModeration}
                      className="block w-full text-left px-3 py-2 text-sm font-medium text-ink hover:bg-cream-100 rounded"
                    >
                      Moderation
                    </button>
                    <button
                      type="button"
                      onClick={goToAccounts}
                      className="block w-full text-left px-3 py-2 text-sm font-medium text-ink hover:bg-cream-100 rounded"
                    >
                      Accounts
                    </button>
                  </>
                )}
                <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Account
                </p>
                <button
                  type="button"
                  onClick={goToAccount}
                  className="block w-full text-left px-3 py-2 text-sm font-medium text-ink hover:bg-cream-100 rounded"
                >
                  Profile
                </button>
                <button
                  type="button"
                  onClick={() => void handleHeaderSignOut()}
                  disabled={signingOut}
                  className="block w-full text-left px-3 py-2 text-sm font-semibold text-forest-800 hover:bg-cream-100 rounded"
                >
                  {signingOut ? 'Signing out...' : 'Sign out'}
                </button>
              </>
            ) : verificationPending ? (
              <>
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Verification pending
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStatusNotice(null);
                    setIsMobileMenuOpen(false);
                    setCurrentView('mfa');
                  }}
                  className="block w-full text-left px-3 py-2 text-sm font-medium text-forest-800 hover:bg-cream-100 rounded"
                >
                  Enter code
                </button>
                <button
                  type="button"
                  onClick={handleHeaderSignOut}
                  disabled={signingOut}
                  className="block w-full text-left px-3 py-2 text-sm font-semibold text-forest-800 hover:bg-cream-100 rounded"
                >
                  {signingOut ? 'Signing out...' : `Sign out (${participantIdentifier})`}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goToLogin}
                  className="block w-full text-left px-3 py-2 text-sm font-medium text-ink hover:bg-cream-100 rounded"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={goToRegister}
                  className="block w-full text-center px-4 py-2 bg-forest text-white text-sm font-semibold rounded hover:bg-forest-800"
                >
                  Create account
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {/* Semantic Main Content Landmark */}
      <main
        id="main-content"
        className={`flex-grow w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${
          currentView === 'landing' ? 'py-6 md:py-8' : 'py-10 md:py-14'
        }`}
        role="main"
      >
        {statusNotice && (
          <div
            role="status"
            aria-live="polite"
            className="mb-6 max-w-lg mx-auto p-4 bg-forest-50 border border-forest-100 text-forest-900 text-sm rounded-md"
          >
            {statusNotice}
          </div>
        )}

        {/* View Routing: Landing vs. Team vs. Account vs. Email Verification vs. Reset vs. Recover vs. Login vs. Register */}
        {currentView === 'landing' ? (
          <LandingPage
            onNavigateToRegister={goToRegister}
            onNavigateToLogin={goToLogin}
            onNavigateToTeams={goToTeam}
            onNavigateToProfile={goToAccount}
            onNavigateToOpenTeams={goToBrowseTeams}
            onNavigateToLooking={goToLooking}
            currentUser={currentUser}
          />
        ) : currentView === 'create-team' ? (
          <section aria-labelledby="create-team-heading">
            <h2 id="create-team-heading" className="sr-only">
              Create a Team
            </h2>
            <MfaGate
              initialChallenge={otpChallenge}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setOtpChallenge(null);
                setCurrentView('login');
              }}
            >
              {() => (
                <CreateTeamPage
                  onCancel={goToTeam}
                  onCreated={(newTeam) => {
                    setStatusNotice(`Team "${newTeam.name}" created successfully!`);
                    goToTeam();
                  }}
                />
              )}
            </MfaGate>
          </section>
        ) : currentView === 'team' ? (
          <section aria-labelledby="team-heading">
            <h2 id="team-heading" className="sr-only">
              My Teams
            </h2>
            <MfaGate
              initialChallenge={otpChallenge}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setOtpChallenge(null);
                setCurrentView('login');
              }}
            >
              {() => {
                const UUID_REGEX =
                  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (!teamEventId || !UUID_REGEX.test(teamEventId.trim())) {
                  return (
                    <MyTeamsPage
                      onCreateTeam={goToCreateTeam}
                      onSelectTeam={(eventId) => {
                        handleSelectEvent(eventId);
                      }}
                    />
                  );
                }
                return (
                  <div className="space-y-6">
                    <div className="max-w-4xl mx-auto flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setTeamEventId('');
                        }}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:text-forest-900 hover:underline focus:outline-none focus:ring-2 focus:ring-forest rounded px-2 py-1"
                      >
                        ← Back to My Teams
                      </button>
                    </div>
                    <TeamWorkspace eventId={teamEventId.trim()} />
                  </div>
                );
              }}
            </MfaGate>
          </section>
        ) : currentView === 'looking' ? (
          <section aria-labelledby="looking-heading">
            <h2 id="looking-heading" className="sr-only">
              Looking for Team
            </h2>
            <LookingForTeamPage
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setCurrentView('login');
              }}
              onBackToLanding={goToLanding}
            />
          </section>
        ) : currentView === 'chat' ? (
          <section aria-labelledby="chat-heading">
            <h2 id="chat-heading" className="sr-only">
              Participant Chat Forums and Messaging
            </h2>
            <MfaGate
              initialChallenge={otpChallenge}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setOtpChallenge(null);
                setCurrentView('login');
              }}
            >
              {() => (
                <ChatPage
                  onNavigateToSignIn={() => {
                    setStatusNotice(null);
                    setCurrentView('login');
                  }}
                  onNavigateAway={goToLanding}
                />
              )}
            </MfaGate>
          </section>
        ) : currentView === 'browse-teams' ? (
          <>
            <ApplicationFormPanel
              target={applyTarget}
              onClose={() => setApplyTarget(null)}
              onSuccess={(notice) => setStatusNotice(notice)}
            />
            <OpenTeamsBoard
              currentUser={currentUser}
              onNavigateToSignIn={goToLogin}
              onNavigateToMfa={() => {
                setStatusNotice(null);
                setIsMobileMenuOpen(false);
                setCurrentView('mfa');
              }}
              onApply={(target) => {
                setStatusNotice(null);
                setApplyTarget(target);
              }}
            />
          </>
        ) : currentView === 'requests' ? (
          <section aria-labelledby="requests-view-heading">
            <h2 id="requests-view-heading" className="sr-only">
              Requests
            </h2>
            <MfaGate
              initialChallenge={otpChallenge}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setOtpChallenge(null);
                setCurrentView('login');
              }}
            >
              {() => (
                <RequestsPage
                  activeTab={requestsTab}
                  onTabChange={setRequestsTab}
                  onStatusNotice={(notice) => setStatusNotice(notice)}
                  onViewRoster={(eventId) => {
                    setStatusNotice(null);
                    closeMenus();
                    setTeamEventId(eventId);
                    setCurrentView('team');
                  }}
                />
              )}
            </MfaGate>
          </section>
        ) : currentView === 'account' ? (
          <section aria-labelledby="account-heading">
            <h2 id="account-heading" className="sr-only">
              Your Account
            </h2>
            <MfaGate
              initialChallenge={otpChallenge}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setOtpChallenge(null);
                setCurrentView('login');
              }}
            >
              {(user) => (
                <SignedInPanel
                  email={user.email}
                  onSignedOut={() => {
                    setStatusNotice('You have been signed out.');
                    setCurrentView('login');
                  }}
                />
              )}
            </MfaGate>
          </section>
        ) : currentView === 'moderation' ? (
          <section aria-labelledby="moderation-heading">
            <h2 id="moderation-heading" className="sr-only">
              Content Moderation Safety Queue
            </h2>
            <MfaGate
              initialChallenge={otpChallenge}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setOtpChallenge(null);
                setCurrentView('login');
              }}
            >
              {() => (
                <ModerationSafetyPage
                  onNavigateAway={() => {
                    setStatusNotice(null);
                    setCurrentView('landing');
                  }}
                />
              )}
            </MfaGate>
          </section>
        ) : currentView === 'accounts' ? (
          <section aria-labelledby="accounts-heading">
            <h2 id="accounts-heading" className="sr-only">
              Administrative Account Enforcement
            </h2>
            <MfaGate
              initialChallenge={otpChallenge}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setOtpChallenge(null);
                setCurrentView('login');
              }}
            >
              {() => (
                <AccountEnforcementPage
                  onNavigateAway={() => {
                    setStatusNotice(null);
                    setCurrentView('landing');
                  }}
                />
              )}
            </MfaGate>
          </section>
        ) : currentView === 'mfa' ? (
          <section aria-labelledby="mfa-heading">
            <h2 id="mfa-heading" className="sr-only">
              Two-Factor Authentication
            </h2>
            <MfaGate
              initialChallenge={otpChallenge}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setOtpChallenge(null);
                setCurrentView('login');
              }}
              onAuthorized={() => {
                setOtpChallenge(null);
                setMfaComplete(true);
                setCurrentView('landing');
              }}
            >
              {() => (
                <div
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                  className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 text-center shadow-sm"
                >
                  <div
                    className="mx-auto mb-3 h-8 w-8 rounded-full border-4 border-forest-100 border-t-forest animate-spin"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-ink-muted">Redirecting to hackathon events...</p>
                </div>
              )}
            </MfaGate>
          </section>
        ) : currentView === 'verify' ? (
          <section aria-labelledby="verification-heading">
            <h2 id="verification-heading" className="sr-only">
              Account Verification
            </h2>
            <EmailVerificationView
              initialEmail={verificationEmail}
              onNavigateToSignIn={() => {
                setStatusNotice('Participant account verified! You can now sign in.');
                setCurrentView('login');
              }}
              onNavigateToRegister={() => {
                setStatusNotice(null);
                setCurrentView('register');
              }}
            />
          </section>
        ) : currentView === 'login' ? (
          <section aria-labelledby="login-heading">
            <h2 id="login-heading" className="sr-only">
              Sign In
            </h2>
            <LoginForm
              onNavigateToRegister={() => setCurrentView('register')}
              onNavigateToPasswordRecovery={(email) => {
                setRecoveryEmail(email ?? '');
                setStatusNotice(null);
                setCurrentView('recover');
              }}
              onPrimaryAuthSuccess={(result) => {
                setOtpChallenge(result.challenge);
                setStatusNotice(null);
                setCurrentView('mfa');
              }}
              onPrimaryAuthNeedsMfa={({ message }) => {
                setOtpChallenge(null);
                setStatusNotice(message);
                setCurrentView('mfa');
              }}
            />
          </section>
        ) : currentView === 'recover' ? (
          <section aria-labelledby="recovery-heading">
            <h2 id="recovery-heading" className="sr-only">
              Password Recovery
            </h2>
            <PasswordRecoveryRequestForm
              initialEmail={recoveryEmail}
              onNavigateToSignIn={() => {
                setStatusNotice(null);
                setCurrentView('login');
              }}
              onNavigateToRegister={() => {
                setStatusNotice(null);
                setCurrentView('register');
              }}
            />
          </section>
        ) : currentView === 'reset' ? (
          <section aria-labelledby="password-reset-heading">
            <h2 id="password-reset-heading" className="sr-only">
              Set New Password
            </h2>
            <PasswordResetForm
              onNavigateToSignIn={() => {
                setStatusNotice(
                  'Password updated. Sign in with your new password — you will need the email OTP before access.'
                );
                setOtpChallenge(null);
                setCurrentView('login');
              }}
              onNavigateToRecover={() => {
                setStatusNotice(null);
                setCurrentView('recover');
              }}
            />
          </section>
        ) : (
          <section aria-labelledby="registration-heading">
            <h2 id="registration-heading" className="sr-only">
              Participant Registration
            </h2>
            <RegistrationForm
              onNavigateToVerification={(email) => {
                if (email) setVerificationEmail(email);
                setStatusNotice(null);
                setCurrentView('verify');
              }}
              onRequiresOtp={(challenge) => {
                setOtpChallenge(challenge);
                setStatusNotice(null);
                setCurrentView('mfa');
              }}
            />
          </section>
        )}
      </main>

      {/* Semantic Footer Landmark */}
      <footer className="border-t border-cream-200 bg-cream-50 py-6" role="contentinfo">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center text-sm text-ink-muted">
          <p>© 2026 HackMatch Team 1. All rights reserved.</p>
          <p>HackMatch</p>
        </div>
      </footer>

      {/* #358 — Chat as floating action (not in primary navbar) */}
      {sessionReady && (
        <button
          type="button"
          onClick={goToChat}
          aria-label="Open chat"
          aria-current={currentView === 'chat' ? 'page' : undefined}
          className={`fixed bottom-5 left-5 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full shadow-lg focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 ${
            currentView === 'chat'
              ? 'bg-forest-800 text-white'
              : 'bg-forest text-white hover:bg-forest-800'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default App;
