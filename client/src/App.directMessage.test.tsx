/**
 * #432 — the app-level wiring of "Message" buttons: any screen can ask the app to open a direct
 * message, and the app opens the chat panel on that conversation exactly once.
 *
 * The landing page and the chat page are replaced by small stand-ins so this test exercises only
 * App.tsx: the launcher it provides, the request it passes to the chat page, and when it clears it.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  onAuthStateChanged,
  onIdTokenChanged,
  getIdTokenResult,
  type User,
  type IdTokenResult,
} from 'firebase/auth';
import App from './App';
import { useDirectMessageLauncher } from './components/chat/directMessageLauncher';

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

vi.mock('./components/notifications/notificationsApi', async () => {
  const actual = await vi.importActual<typeof import('./components/notifications/notificationsApi')>(
    './components/notifications/notificationsApi'
  );
  return {
    ...actual,
    listNotifications: vi.fn().mockResolvedValue({ notifications: [], unreadCount: 0, nextCursor: null }),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  };
});

vi.mock('./components/landing/LandingPage', () => ({
  LandingPage: function LandingStandIn(): React.JSX.Element {
    const launcher = useDirectMessageLauncher();
    return (
      <div data-testid="landing-stub">
        <button type="button" onClick={() => launcher?.openDirectMessage('peer-1')}>
          message peer-1
        </button>
        <button type="button" onClick={() => launcher?.openDirectMessage('peer-2')}>
          message peer-2
        </button>
      </div>
    );
  },
}));

vi.mock('./components/chat/ChatPage', () => ({
  ChatPage: function ChatStandIn(props: {
    directMessageRequest?: { participantId: string; requestId: number } | null;
    onDirectMessageRequestHandled?: () => void;
  }): React.JSX.Element {
    return (
      <div data-testid="chat-stub">
        <p data-testid="chat-request">
          {props.directMessageRequest
            ? `${props.directMessageRequest.participantId}#${props.directMessageRequest.requestId}`
            : 'none'}
        </p>
        <button type="button" onClick={() => props.onDirectMessageRequestHandled?.()}>
          request taken
        </button>
      </div>
    );
  },
}));

function mockSignedInUser(): void {
  const mockUser = {
    uid: 'user-1',
    email: 'sahil@example.com',
    displayName: 'Sahil Gupta',
    getIdToken: vi.fn().mockResolvedValue('mock-token'),
  } as unknown as User;
  const emitUser = ((_auth: unknown, cb: (u: User | null) => void) => {
    cb(mockUser);
    return () => {};
  }) as unknown as typeof onAuthStateChanged;
  vi.mocked(onAuthStateChanged).mockImplementation(emitUser);
  vi.mocked(onIdTokenChanged).mockImplementation(emitUser as unknown as typeof onIdTokenChanged);
  const authTime = 1792000000;
  vi.mocked(getIdTokenResult).mockResolvedValue({
    claims: { auth_time: authTime, mfa_auth_time: authTime, role: 'PART' },
  } as unknown as IdTokenResult);
}

describe('App: Message buttons open the chat on a conversation (#432)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.pushState({}, '', '/?view=landing');
    mockSignedInUser();
  });

  it('opens the chat panel with the participant a Message button asked for', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /message peer-1/i }));

    expect(await screen.findByTestId('chat-stub')).toBeInTheDocument();
    expect(screen.getByTestId('chat-request')).toHaveTextContent(/^peer-1#\d+$/);
    expect(screen.queryByTestId('landing-stub')).not.toBeInTheDocument();
  });

  it('forgets the request once the chat page has taken it', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /message peer-1/i }));
    await screen.findByTestId('chat-stub');

    fireEvent.click(screen.getByRole('button', { name: /request taken/i }));

    expect(screen.getByTestId('chat-request')).toHaveTextContent('none');
  });

  it('every click is a new request, even for the same person, so the conversation reopens', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /message peer-1/i }));
    const first = (await screen.findByTestId('chat-request')).textContent;

    // Back to the landing page, then click again for the same person.
    fireEvent.click(screen.getByRole('button', { name: /hackmatch home/i }));
    fireEvent.click(await screen.findByRole('button', { name: /message peer-1/i }));
    const second = (await screen.findByTestId('chat-request')).textContent;

    expect(first).toMatch(/^peer-1#/);
    expect(second).toMatch(/^peer-1#/);
    expect(second).not.toBe(first);
  });

  it('a different person gives a different request', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /message peer-1/i }));
    await screen.findByTestId('chat-stub');
    fireEvent.click(screen.getByRole('button', { name: /hackmatch home/i }));
    fireEvent.click(await screen.findByRole('button', { name: /message peer-2/i }));

    expect(await screen.findByTestId('chat-request')).toHaveTextContent(/^peer-2#/);
  });

  it('the plain Open chat button opens the chat WITHOUT replaying an old request', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /message peer-1/i }));
    await screen.findByTestId('chat-stub');
    // The request is still pending (the stand-in has not taken it): leave and come back via the button.
    fireEvent.click(screen.getByRole('button', { name: /hackmatch home/i }));
    await screen.findByTestId('landing-stub');

    fireEvent.click(screen.getByRole('button', { name: /^open chat$/i }));

    expect(await screen.findByTestId('chat-request')).toHaveTextContent('none');
  });

  it('does not show a chat page until a Message button or Open chat is used', async () => {
    render(<App />);
    await screen.findByTestId('landing-stub');
    expect(screen.queryByTestId('chat-stub')).not.toBeInTheDocument();
    expect(within(document.body).getByRole('button', { name: /^open chat$/i })).toBeInTheDocument();
  });
});
