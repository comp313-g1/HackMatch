/**
 * US-035 / #408 — shared typing hook + indicator: capability gating, throttled
 * signals, stop behavior, local expiry, multi-typist state, accessibility,
 * failure handling, and cleanup on navigation and account changes.
 */
import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { ChatApiError } from './chatApi';
import { ChatCapabilitiesProvider } from './ChatCapabilitiesContext';
import { TypingIndicator } from './TypingIndicator';
import { useConversationTyping } from './useConversationTyping';
import type { ChatConversationTarget, ChatTypingEvent } from './chatTypes';
import type { TypingStreamHandlers } from './typingStream';

const fake = vi.hoisted(() => ({
  connections: [] as Array<{ target: unknown; handlers: unknown; stop: ReturnType<typeof import('vitest').vi.fn> }>,
}));

vi.mock('./typingStream', async () => {
  const actual = await vi.importActual<typeof import('./typingStream')>('./typingStream');
  const { vi: v } = await import('vitest');
  return {
    ...actual,
    connectTypingStream: v.fn((target: unknown, handlers: unknown) => {
      const connection = { target, handlers, stop: v.fn() };
      fake.connections.push(connection);
      return connection.stop;
    }),
  };
});

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return { ...actual, fetchChatCapabilities: vi.fn(), signalChatTyping: vi.fn() };
});

const CHANNEL_A: ChatConversationTarget = { kind: 'channel', channelId: '11111111-1111-4111-8111-11111111111a' };
const CHANNEL_B: ChatConversationTarget = { kind: 'channel', channelId: '11111111-1111-4111-8111-11111111111b' };
const TEAM_A: ChatConversationTarget = { kind: 'team', teamId: '22222222-2222-4222-8222-22222222222a' };
const DM_A: ChatConversationTarget = { kind: 'directMessage', threadId: '44444444-4444-4444-8444-44444444444a' };

function capabilities(typing: boolean) {
  return {
    reactions: { enabled: false, allowedReactions: [] },
    typing: { enabled: typing },
    attachments: { enabled: false as const },
    voiceVideo: false as const,
  };
}

function Harness({ target }: { target: ChatConversationTarget | null }): React.JSX.Element {
  const typing = useConversationTyping(target);
  const [draft, setDraft] = useState('');
  return (
    <div>
      <TypingIndicator enabled={typing.enabled} typists={typing.typists} />
      <label htmlFor="composer">Message</label>
      <textarea
        id="composer"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          typing.onComposerChange(e.target.value);
        }}
        onBlur={typing.onComposerBlur}
      />
      <button
        type="button"
        onClick={() => {
          setDraft('');
          typing.onMessageSent();
        }}
      >
        Send
      </button>
    </div>
  );
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

function ui(target: ChatConversationTarget | null, { sessionKey = 'uid-1', enabled = true } = {}) {
  return (
    <ChatCapabilitiesProvider sessionKey={sessionKey} enabled={enabled}>
      <Harness target={target} />
    </ChatCapabilitiesProvider>
  );
}

async function mount(target: ChatConversationTarget | null = CHANNEL_A, opts?: { sessionKey?: string; enabled?: boolean }) {
  const view = render(ui(target, opts));
  await flush();
  return view;
}

const latest = () => {
  const connection = fake.connections.at(-1)!;
  return { ...connection, handlers: connection.handlers as TypingStreamHandlers };
};

function event(handle: string | null, typing = true, target: ChatConversationTarget = CHANNEL_A): ChatTypingEvent {
  const conversationId = target.kind === 'channel' ? target.channelId : target.kind === 'team' ? target.teamId : target.threadId;
  return { conversationType: target.kind, conversationId, typist: { handle }, typing };
}

const indicator = () => screen.getByTestId('typing-indicator');
const composer = () => screen.getByLabelText('Message');
const type = (value: string) => fireEvent.change(composer(), { target: { value } });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const signal = vi.mocked(chatApi.signalChatTyping);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T12:00:00.000Z'));
  fake.connections.length = 0;
  signal.mockReset().mockResolvedValue(undefined);
  vi.mocked(chatApi.fetchChatCapabilities).mockReset().mockResolvedValue(capabilities(true));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('capability gating', () => {
  it('does nothing at all when the server reports typing disabled', async () => {
    vi.mocked(chatApi.fetchChatCapabilities).mockResolvedValue(capabilities(false));
    await mount();
    type('hello');
    expect(fake.connections).toHaveLength(0);
    expect(signal).not.toHaveBeenCalled();
    expect(screen.queryByTestId('typing-indicator')).not.toBeInTheDocument();
  });

  it('opens one stream for the active conversation and shows a polite status region when enabled', async () => {
    await mount(TEAM_A);
    expect(fake.connections).toHaveLength(1);
    expect(latest().target).toEqual(TEAM_A);
    expect(indicator()).toHaveAttribute('role', 'status');
    expect(indicator()).toHaveAttribute('aria-live', 'polite');
    expect(indicator().textContent).toBe('');
  });

  it('opens nothing without an active conversation', async () => {
    await mount(null);
    expect(fake.connections).toHaveLength(0);
  });
});

describe('outbound signals', () => {
  it('sends promptly, then at most once every 2 s while typing continues', async () => {
    await mount();
    type('h');
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenLastCalledWith(CHANNEL_A, true);
    for (const value of ['he', 'hel', 'hell']) {
      advance(500);
      type(value);
    }
    advance(499); // t = 1999
    type('hello');
    expect(signal).toHaveBeenCalledTimes(1);
    advance(1); // t = 2000
    type('hello!');
    expect(signal).toHaveBeenCalledTimes(2);
    expect(signal.mock.calls.every((call) => call.length === 2 && typeof call[1] === 'boolean')).toBe(true);
  });

  it('stops on a blank composer, on blur, and after sending, only if a start was sent', async () => {
    await mount();
    type('   ');
    fireEvent.blur(composer());
    expect(signal).not.toHaveBeenCalled();

    type('hi');
    type('');
    expect(signal.mock.calls).toEqual([
      [CHANNEL_A, true],
      [CHANNEL_A, false],
    ]);

    type('again');
    fireEvent.blur(composer());
    expect(signal).toHaveBeenLastCalledWith(CHANNEL_A, false);

    type('send me');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(signal).toHaveBeenLastCalledWith(CHANNEL_A, false);
    expect(composer()).toHaveValue('');
  });

  it('never blocks the composer or sending when signals fail, and does not retry aggressively', async () => {
    signal.mockRejectedValue(new ChatApiError(0, 'NETWORK'));
    await mount();
    type('a');
    await flush();
    type('ab');
    expect(composer()).toHaveValue('ab');
    expect(composer()).not.toBeDisabled();
    expect(signal).toHaveBeenCalledTimes(1);
    advance(2000);
    type('abc');
    expect(signal).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(composer()).toHaveValue('');
  });

  it('pauses signals for Retry-After on 429, then resumes', async () => {
    signal.mockRejectedValueOnce(new ChatApiError(429, 'RATE_LIMITED', undefined, undefined, 'x', 5));
    await mount();
    type('a');
    await flush();
    advance(2000);
    type('ab');
    advance(2000);
    type('abc');
    expect(signal).toHaveBeenCalledTimes(1); // paused until t = 5 s
    advance(1000);
    type('abcd');
    expect(signal).toHaveBeenCalledTimes(2);
  });

  it('stops asking in a conversation that refuses the caller (e.g. a block)', async () => {
    signal.mockRejectedValueOnce(new ChatApiError(403, 'DM_PEER_UNAVAILABLE'));
    await mount(DM_A);
    type('a');
    await flush();
    advance(10_000);
    type('ab');
    expect(signal).toHaveBeenCalledTimes(1);
    expect(fake.connections).toHaveLength(1); // still allowed to watch
  });

  it('turns typing off for the session on FEATURE_DISABLED: no stream, no indicator, no more signals', async () => {
    signal.mockRejectedValueOnce(new ChatApiError(404, 'FEATURE_DISABLED'));
    await mount();
    const connection = latest();
    type('a');
    await flush();
    expect(connection.stop).toHaveBeenCalled();
    expect(screen.queryByTestId('typing-indicator')).not.toBeInTheDocument();
    advance(5000);
    type('ab');
    expect(signal).toHaveBeenCalledTimes(1);
    expect(composer()).toHaveValue('ab');
  });
});

describe('inbound indicators and expiry', () => {
  it('shows a typist, refreshes without duplicating, and removes on typing:false', async () => {
    await mount();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('avery')));
    expect(indicator()).toHaveTextContent('avery is typing…');
    act(() => latest().handlers.onTyping(event('avery')));
    expect(indicator()).toHaveTextContent('avery is typing…');
    act(() => latest().handlers.onTyping(event('avery', false)));
    expect(indicator().textContent).toBe('');
  });

  it('expires exactly at the default 6 s with no stop event (5,999 ms present, 6,000 ms gone)', async () => {
    await mount();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('avery')));
    advance(5999);
    expect(indicator()).toHaveTextContent('avery is typing…');
    advance(1);
    expect(indicator().textContent).toBe('');
  });

  it('uses the server-advertised typingExpiryMs from the ready event', async () => {
    await mount();
    act(() => latest().handlers.onConnected(3000));
    act(() => latest().handlers.onTyping(event('avery')));
    advance(2999);
    expect(indicator()).toHaveTextContent('avery is typing…');
    advance(1);
    expect(indicator().textContent).toBe('');
  });

  it('keeps several typists independent: refreshing one never extends another', async () => {
    await mount();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('blake')));
    advance(2000);
    act(() => latest().handlers.onTyping(event('avery')));
    advance(2000);
    act(() => latest().handlers.onTyping(event('blake'))); // blake refreshed at 4 s, avery at 2 s
    expect(indicator()).toHaveTextContent('avery and blake are typing…');
    advance(4000); // t = 8 s: avery expired (2 + 6); blake until 10 s
    expect(indicator()).toHaveTextContent('blake is typing…');
    advance(2000);
    expect(indicator().textContent).toBe('');
  });

  it('summarizes up to three handles alphabetically, then "Several people"', async () => {
    await mount();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('casey')));
    act(() => latest().handlers.onTyping(event('avery')));
    act(() => latest().handlers.onTyping(event('blake')));
    expect(indicator()).toHaveTextContent('avery, blake, and casey are typing…');
    act(() => latest().handlers.onTyping(event('drew')));
    expect(indicator()).toHaveTextContent('Several people are typing…');
    act(() => latest().handlers.onTyping(event(null)));
    expect(indicator()).toHaveTextContent('Several people are typing…');
  });

  it('does not re-announce on a heartbeat refresh, only on a real change', async () => {
    await mount();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('avery')));
    const region = indicator();
    const observer = new MutationObserver(() => undefined);
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 3; i += 1) {
      advance(2000);
      act(() => latest().handlers.onTyping(event('avery')));
    }
    expect(observer.takeRecords()).toHaveLength(0);
    expect(indicator()).toBe(region);
    act(() => latest().handlers.onTyping(event('blake')));
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    observer.disconnect();
  });

  it('starts empty after a reconnect or rotation (no restored history)', async () => {
    await mount();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('avery')));
    act(() => latest().handlers.onDisconnected());
    act(() => latest().handlers.onConnected(6000));
    expect(indicator().textContent).toBe('');
    act(() => latest().handlers.onTyping(event('avery')));
    expect(indicator()).toHaveTextContent('avery is typing…');
    expect(fake.connections).toHaveLength(1);
  });

  it('clears and stops on a stream FEATURE_DISABLED', async () => {
    await mount();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('avery')));
    const connection = latest();
    act(() => connection.handlers.onUnavailable('FEATURE_DISABLED'));
    await flush();
    expect(screen.queryByTestId('typing-indicator')).not.toBeInTheDocument();
    expect(connection.stop).toHaveBeenCalled();
    type('hello');
    expect(signal).not.toHaveBeenCalled();
  });

  it('never moves focus when others start or stop typing', async () => {
    await mount();
    composer().focus();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('avery')));
    act(() => latest().handlers.onTyping(event('avery', false)));
    expect(document.activeElement).toBe(composer());
  });
});

describe('cleanup on navigation and session changes', () => {
  it.each([
    ['public channel A → public channel B', CHANNEL_A, CHANNEL_B],
    ['public → team', CHANNEL_A, TEAM_A],
    ['team → DM', TEAM_A, DM_A],
    ['DM → public', DM_A, CHANNEL_A],
  ])('%s: closes the old stream, clears state, stops the old conversation, and resets the throttle', async (_l, from, to) => {
    const view = await mount(from);
    const old = latest();
    act(() => old.handlers.onConnected(6000));
    act(() => old.handlers.onTyping(event('avery', true, from)));
    type('drafting');
    expect(signal).toHaveBeenLastCalledWith(from, true);

    view.rerender(ui(to));
    await flush();
    expect(old.stop).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenCalledWith(from, false);
    expect(fake.connections).toHaveLength(2);
    expect(latest().target).toEqual(to);
    expect(indicator().textContent).toBe('');

    // A late event from the old connection cannot reach the new conversation's display.
    act(() => old.handlers.onTyping(event('ghost', true, from)));
    expect(indicator().textContent).toBe('');

    // The 2 s throttle belongs to the old conversation: the new one sends at once.
    type('drafting more');
    expect(signal).toHaveBeenLastCalledWith(to, true);
  });

  it('account switch: drops the stream and state, and sends no stop under the new account', async () => {
    const view = await mount(CHANNEL_A, { sessionKey: 'uid-1' });
    const old = latest();
    act(() => old.handlers.onConnected(6000));
    act(() => old.handlers.onTyping(event('avery')));
    type('mine');
    signal.mockClear();

    view.rerender(ui(CHANNEL_A, { sessionKey: 'uid-2' }));
    // Same render: the old session's stream and display are gone, and no stream opens
    // for the new account before ITS capabilities are confirmed.
    expect(old.stop).toHaveBeenCalled();
    expect(screen.queryByTestId('typing-indicator')).not.toBeInTheDocument();
    expect(fake.connections).toHaveLength(1);
    await flush();
    expect(signal).not.toHaveBeenCalled();
    expect(fake.connections).toHaveLength(2); // one fresh stream for the new session
    expect(indicator().textContent).toBe('');
  });

  it('logout: drops the stream, the state, and the indicator, sending nothing', async () => {
    const view = await mount();
    const old = latest();
    act(() => old.handlers.onConnected(6000));
    act(() => old.handlers.onTyping(event('avery')));
    type('mine');
    signal.mockClear();

    view.rerender(ui(CHANNEL_A, { enabled: false }));
    await flush();
    expect(old.stop).toHaveBeenCalled();
    expect(screen.queryByTestId('typing-indicator')).not.toBeInTheDocument();
    expect(signal).not.toHaveBeenCalled();
  });

  it('unmount: closes the stream and clears all timers', async () => {
    const view = await mount();
    const old = latest();
    act(() => old.handlers.onConnected(6000));
    act(() => old.handlers.onTyping(event('avery')));
    view.unmount();
    expect(old.stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps nothing in browser storage or the URL', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const href = window.location.href;
    await mount();
    act(() => latest().handlers.onConnected(6000));
    act(() => latest().handlers.onTyping(event('avery')));
    type('secret draft');
    expect(setItem).not.toHaveBeenCalled();
    expect(window.location.href).toBe(href);
    expect(JSON.stringify(signal.mock.calls)).not.toContain('secret draft');
    setItem.mockRestore();
  });
});
