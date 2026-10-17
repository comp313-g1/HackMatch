import React, { useState } from 'react';
import { RegistrationForm } from './components/auth/RegistrationForm';
import { EmailVerificationView } from './components/auth/EmailVerificationView';
import { LoginForm } from './components/auth/LoginForm';
import { PasswordRecoveryRequestForm } from './components/auth/PasswordRecoveryRequestForm';
import { PasswordResetForm } from './components/auth/PasswordResetForm';
import { MfaGate } from './components/auth/MfaGate';
import { SignedInPanel } from './components/auth/SignedInPanel';
import { EventDirectory } from './components/events/EventDirectory';
import type { OtpChallenge } from './components/auth/providerSignIn';

type View = 'register' | 'login' | 'verify' | 'account' | 'recover' | 'reset' | 'events';

const getInitialView = (): View => {
  if (typeof window === 'undefined') return 'register';
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
  if (view === 'login') {
    return 'login';
  }
  if (view === 'account') {
    return 'account';
  }
  if (view === 'recover' || view === 'forgot-password') {
    return 'recover';
  }
  if (view === 'events') {
    return 'events';
  }
  return 'register';
};

export function App(): React.JSX.Element {
  const [currentView, setCurrentView] = useState<View>(getInitialView);
  const [verificationEmail, setVerificationEmail] = useState<string>('');
  const [recoveryEmail, setRecoveryEmail] = useState<string>('');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [otpChallenge, setOtpChallenge] = useState<OtpChallenge | null>(null);
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const checkApiHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      // Calls /api/health through Vite proxy in development
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setHealthStatus(`Connected: status=${data.status}, time=${data.timestamp}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reach API');
    } finally {
      setLoading(false);
    }
  };

  const goToRegister = () => {
    setStatusNotice(null);
    setCurrentView('register');
  };

  const goToLogin = () => {
    setStatusNotice(null);
    setCurrentView('login');
  };

  const goToEvents = () => {
    setStatusNotice(null);
    setCurrentView('events');
  };

  const showAuthNav =
    currentView === 'register' ||
    currentView === 'login' ||
    currentView === 'recover' ||
    currentView === 'reset' ||
    currentView === 'events';

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
      <header className="bg-cream-50/80 border-b border-cream-200 backdrop-blur-sm" role="banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={goToRegister}
            className="flex items-center gap-2 shrink-0 rounded focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream"
            aria-label="HackMatch home"
          >
            <h1 className="font-display text-2xl font-semibold tracking-tight text-forest-900">
              HackMatch
            </h1>
          </button>

          <nav className="flex items-center gap-2 sm:gap-4" aria-label="Primary">
            <button
              type="button"
              onClick={goToEvents}
              aria-current={currentView === 'events' ? 'page' : undefined}
              className={`text-sm font-medium rounded px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream ${
                currentView === 'events'
                  ? 'text-forest-900 font-semibold'
                  : 'text-ink-muted hover:text-forest-800'
              }`}
            >
              Browse Events
            </button>

            {showAuthNav ? (
              <>
                <button
                  type="button"
                  onClick={goToLogin}
                  aria-current={currentView === 'login' ? 'page' : undefined}
                  className={`text-sm font-medium rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream ${
                    currentView === 'login'
                      ? 'text-forest-900'
                      : 'text-ink-muted hover:text-forest-800'
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={goToRegister}
                  aria-current={currentView === 'register' ? 'page' : undefined}
                  className={`text-sm font-semibold rounded-md px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream ${
                    currentView === 'register'
                      ? 'bg-forest text-white hover:bg-forest-800'
                      : 'bg-forest text-white hover:bg-forest-800'
                  }`}
                >
                  Create account
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goToLogin}
                  className="text-sm font-medium text-ink-muted hover:text-forest-800 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={goToRegister}
                  className="text-sm font-semibold rounded-md px-3.5 py-2 bg-forest text-white hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream"
                >
                  Create account
                </button>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Semantic Main Content Landmark */}
      <main
        id="main-content"
        className="flex-grow w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14"
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

        {/* View Routing: Registration vs. Email Verification vs. Signed-in Account */}
        {currentView === 'account' ? (
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
                setCurrentView('account');
              }}
            />
          </section>
        ) : currentView === 'events' ? (
          <section aria-labelledby="events-heading">
            <h2 id="events-heading" className="sr-only">
              Hackathon Directory
            </h2>
            <EventDirectory />
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
                setCurrentView('account');
              }}
            />
          </section>
        )}
      </main>

      {/* Semantic Footer Landmark */}
      <footer className="border-t border-cream-200 bg-cream-50 py-6" role="contentinfo">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center text-sm text-ink-muted">
          <p>© 2026 HackMatch Team 1. All rights reserved.</p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <p>COMP 313 Project 2</p>
            <button
              type="button"
              onClick={checkApiHealth}
              disabled={loading}
              className="text-xs font-medium text-forest-700 underline hover:text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest rounded disabled:opacity-50"
            >
              {loading ? 'Checking Health...' : 'Probe /api/health'}
            </button>
          </div>
        </div>
        {(healthStatus || error) && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-3">
            {healthStatus && (
              <div role="status" className="text-xs text-forest-800 bg-forest-50 border border-forest-100 rounded px-3 py-2">
                {healthStatus}
              </div>
            )}
            {error && (
              <div role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
                Error: {error}
              </div>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}

export default App;
