/**
 * US-035 / #407 — in-memory typing state: expiry, refresh, isolation, scoping,
 * re-authorization, and cleanup (#404 policy, section 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config/index.js';
import {
  TYPING_EXPIRY_MS,
  TypingHub,
  type TypingConversation,
  type TypingEvent,
} from './chatTyping.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const V = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PUBLIC_1: TypingConversation = { conversationType: 'channel', conversationId: '11111111-1111-4111-8111-111111111111' };
const PUBLIC_2: TypingConversation = { conversationType: 'channel', conversationId: '11111111-1111-4111-8111-111111111112' };
const TEAM_1: TypingConversation = { conversationType: 'team', conversationId: '22222222-2222-4222-8222-222222222221' };
const DM_1: TypingConversation = { conversationType: 'directMessage', conversationId: '33333333-3333-4333-8333-333333333331' };

let clock = 0;
let hub: TypingHub;

function viewer(participantId: string, conversation: TypingConversation, authorize = async () => true) {
  const events: TypingEvent[] = [];
  const close = vi.fn();
  const unsubscribe = hub.subscribe(conversation, { participantId, deliver: (e) => events.push(e), authorize, close });
  return { events, close, unsubscribe };
}

const signal = (participantId: string, conversation: TypingConversation, typing = true, handle: string | null = 'h') =>
  hub.signal({ conversation, participantId, handle, typing });

beforeEach(() => {
  vi.useFakeTimers();
  clock = Date.parse('2026-11-12T12:00:00.000Z');
  vi.setSystemTime(clock);
  hub = new TypingHub({ now: () => clock });
  config.richChat.typingEnabled = true;
});

afterEach(() => {
  hub._reset();
  vi.useRealTimers();
  config.richChat.typingEnabled = false;
});

const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

describe('expiry', () => {
  it('uses the approved 6-second expiry and publishes it as a server timestamp', async () => {
    expect(TYPING_EXPIRY_MS).toBe(6_000);
    const v = viewer(V, PUBLIC_1);
    await signal(A, PUBLIC_1, true, 'avery');
    expect(v.events).toEqual([
      {
        conversationType: 'channel',
        conversationId: PUBLIC_1.conversationId,
        typist: { handle: 'avery' },
        typing: true,
        expiresAt: '2026-11-12T12:00:06.000Z',
      },
    ]);
  });

  it('expires exactly at 6 s without any stop signal, and publishes typing:false', async () => {
    const v = viewer(V, PUBLIC_1);
    await signal(A, PUBLIC_1);
    await advance(5_999);
    expect(hub.activeTypists(PUBLIC_1)).toHaveLength(1);
    expect(v.events).toHaveLength(1);

    await advance(1);
    expect(hub.activeTypists(PUBLIC_1)).toEqual([]);
    expect(v.events.at(-1)).toEqual({
      conversationType: 'channel',
      conversationId: PUBLIC_1.conversationId,
      typist: { handle: 'h' },
      typing: false,
    });
  });

  it('refreshes only the sender’s own expiry on a repeated pulse, without duplicate entries', async () => {
    await signal(A, PUBLIC_1);
    await advance(2_000);
    await signal(B, PUBLIC_1);
    await advance(2_000);
    await signal(A, PUBLIC_1); // A refreshed at t=4s; B still from t=2s
    expect(hub.activeTypists(PUBLIC_1).map((t) => t.participantId).sort()).toEqual([A, B]);

    await advance(4_000); // t=8s: B expired (2+6), A alive until 10s
    expect(hub.activeTypists(PUBLIC_1).map((t) => t.participantId)).toEqual([A]);
    await advance(2_000);
    expect(hub.activeTypists(PUBLIC_1)).toEqual([]);
  });

  it('clears immediately on an explicit stop, and a stop with nothing active publishes nothing', async () => {
    const v = viewer(V, PUBLIC_1);
    await signal(A, PUBLIC_1, false);
    expect(v.events).toEqual([]);

    await signal(A, PUBLIC_1, true);
    await signal(A, PUBLIC_1, false);
    expect(hub.activeTypists(PUBLIC_1)).toEqual([]);
    expect(v.events.map((e) => e.typing)).toEqual([true, false]);
    await advance(TYPING_EXPIRY_MS * 2);
    expect(v.events).toHaveLength(2); // the cancelled expiry never fires a second stop
  });
});

describe('delivery scoping', () => {
  it('delivers only to viewers of that exact conversation, never back to the sender', async () => {
    const sameChannel = viewer(V, PUBLIC_1);
    const senderTab = viewer(A, PUBLIC_1);
    const otherChannel = viewer(B, PUBLIC_2);
    const team = viewer(B, TEAM_1);
    const dm = viewer(B, DM_1);

    await signal(A, PUBLIC_1);
    expect(sameChannel.events).toHaveLength(1);
    expect(senderTab.events).toEqual([]);
    expect(otherChannel.events).toEqual([]);
    expect(team.events).toEqual([]);
    expect(dm.events).toEqual([]);
  });

  it('keeps per-conversation state isolated for the same participant', async () => {
    await signal(A, PUBLIC_1);
    await signal(A, TEAM_1);
    await signal(A, PUBLIC_1, false);
    expect(hub.activeTypists(PUBLIC_1)).toEqual([]);
    expect(hub.activeTypists(TEAM_1).map((t) => t.participantId)).toEqual([A]);
  });

  it('re-checks the viewer’s access before EVERY delivery and disconnects on loss, with no grace window', async () => {
    let allowed = true;
    const authorize = vi.fn(async () => allowed);
    const v = viewer(V, TEAM_1, authorize);

    await signal(A, TEAM_1);
    await signal(A, TEAM_1);
    expect(authorize).toHaveBeenCalledTimes(2); // even a brand-new subscription is checked
    expect(v.events).toHaveLength(2);

    allowed = false; // revoked with no time passing
    await signal(A, TEAM_1);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(v.close).toHaveBeenCalledTimes(1);
    expect(v.events).toHaveLength(2);
  });

  it('re-checks access for the expiry stop event too', async () => {
    let allowed = true;
    const v = viewer(V, PUBLIC_1, async () => allowed);
    await signal(A, PUBLIC_1);
    allowed = false;
    await advance(TYPING_EXPIRY_MS);
    expect(v.events.map((e) => e.typing)).toEqual([true]);
    expect(v.close).toHaveBeenCalled();
  });

  it('treats a failing access check as no access', async () => {
    const v = viewer(V, DM_1, async () => {
      throw new Error('db down');
    });
    await signal(A, DM_1);
    expect(v.events).toEqual([]);
    expect(v.close).toHaveBeenCalled();
  });

  it('keeps delivering to other viewers when one viewer’s connection throws', async () => {
    hub.subscribe(PUBLIC_1, {
      participantId: B,
      deliver: () => {
        throw new Error('socket gone');
      },
      authorize: async () => true,
      close: () => undefined,
    });
    const v = viewer(V, PUBLIC_1);
    await expect(signal(A, PUBLIC_1)).resolves.toBeUndefined();
    expect(v.events).toHaveLength(1);
  });
});

describe('lifecycle', () => {
  it('sends a new viewer no earlier typing state (no history or replay)', async () => {
    await signal(A, PUBLIC_1);
    const late = viewer(V, PUBLIC_1);
    expect(late.events).toEqual([]);
    await signal(A, PUBLIC_1);
    expect(late.events).toHaveLength(1);
  });

  it('removes a viewer and its stream count on unsubscribe (idempotent)', async () => {
    const v = viewer(V, PUBLIC_1);
    viewer(V, TEAM_1);
    expect(hub.streamCount(V)).toBe(2);
    v.unsubscribe();
    v.unsubscribe();
    expect(hub.streamCount(V)).toBe(1);
    expect(hub.subscriberCount(PUBLIC_1)).toBe(0);
    await signal(A, PUBLIC_1);
    expect(v.events).toEqual([]);
  });

  it('publishes nothing and stores nothing while the feature flag is off', async () => {
    const v = viewer(V, PUBLIC_1);
    config.richChat.typingEnabled = false;
    await signal(A, PUBLIC_1);
    expect(hub.activeTypists(PUBLIC_1)).toEqual([]);
    expect(v.events).toEqual([]);
  });
});
