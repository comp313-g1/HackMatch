import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DirectMessage,
  DirectMessageThread,
  IDirectMessageRepository,
} from '../db/directMessage.repository.js';
import {
  participantBlockRepository,
  type IParticipantBlockRepository,
} from '../db/participantBlock.repository.js';
import type { IParticipantRepository } from '../db/participants.repository.js';
import type { IProfileRepository } from '../db/profile.repository.js';
import type { Participant } from '../db/types.js';
import { publicPayloadHasPrivateChatKey } from './chatPrivacy.js';
import {
  directMessagePayloadHasPrivateKey,
  toDirectInboxItemView,
  toDirectMessageView,
  toDirectThreadView,
  toUtcIsoTimestamp,
} from './directMessagePrivacy.js';
import {
  DirectMessageServiceError,
  getDmThread,
  isEligibleDirectMessagePeer,
  listDmInbox,
  listDmThreadMessages,
  mapDirectMessageWriteError,
  openOrContinueDirectThread,
  sendDmMessage,
} from './directMessages.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THREAD_AB = '11111111-1111-4111-8111-111111111111';
const THREAD_AC = '22222222-2222-4222-8222-222222222222';

function makeParticipant(id: string, overrides: Partial<Participant> = {}): Participant {
  return {
    id,
    firebase_uid: `fb-${id}`,
    email: `${id}@example.com`,
    full_name: `Participant ${id}`,
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeThread(overrides: Partial<DirectMessageThread> = {}): DirectMessageThread {
  return {
    id: THREAD_AB,
    participant_low_id: USER_A,
    participant_high_id: USER_B,
    last_message_at: '2026-11-09T12:00:00.000Z',
    created_at: '2026-11-09T10:00:00.000Z',
    updated_at: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<DirectMessage> = {}): DirectMessage {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    thread_id: THREAD_AB,
    author_id: USER_A,
    body: 'Hello from unit test',
    created_at: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

describe('directMessages service (US-032 / #391 / FR-089, FR-091)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(participantBlockRepository, 'findBlockState').mockResolvedValue({
      blockedByMe: false,
      blockedByThem: false,
    });
  });

  describe('toUtcIsoTimestamp', () => {
    it('normalizes Date objects and timezone-offset strings to UTC ISO-8601 Z format', () => {
      expect(toUtcIsoTimestamp(new Date('2026-11-09T15:30:00.000Z'))).toBe(
        '2026-11-09T15:30:00.000Z'
      );
      expect(toUtcIsoTimestamp('2026-11-09T10:30:00-05:00')).toBe(
        '2026-11-09T15:30:00.000Z'
      );
    });

    it('throws TypeError when given an unparseable timestamp string', () => {
      expect(() => toUtcIsoTimestamp('not-a-timestamp')).toThrow(TypeError);
    });
  });

  describe('toDirectMessageView, toDirectThreadView & toDirectInboxItemView', () => {
    it('projects message view with UTC timestamp, fromMe boolean, and scrubs private properties', () => {
      const view = toDirectMessageView(
        {
          ...makeMessage({ created_at: '2026-11-09T08:00:00-04:00' }),
          email: 'secret@example.com',
          firebase_uid: 'fb-secret',
        } as unknown as DirectMessage,
        USER_A,
        'alice_h'
      );

      expect(view).toEqual({
        id: '99999999-9999-4999-8999-999999999999',
        threadId: THREAD_AB,
        fromMe: true,
        authorHandle: 'alice_h',
        body: 'Hello from unit test',
        createdAt: '2026-11-09T12:00:00.000Z',
      });
      expect(publicPayloadHasPrivateChatKey(view)).toBe(false);
      expect(directMessagePayloadHasPrivateKey(view)).toBe(false);
    });

    it('projects thread view with peer handle and lastMessageAt, and inbox item with lastMessage', () => {
      const thread = makeThread();
      const threadView = toDirectThreadView(thread, USER_A, 'bob_h');
      expect(threadView).toEqual({
        id: THREAD_AB,
        peer: { id: USER_B, handle: 'bob_h' },
        lastMessageAt: '2026-11-09T12:00:00.000Z',
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T12:00:00.000Z',
      });

      const msg = makeMessage({ author_id: USER_B, created_at: '2026-11-09T12:05:00.000Z' });
      const inboxItem = toDirectInboxItemView(thread, USER_A, 'bob_h', {
        message: msg,
        authorHandle: 'bob_h',
      });
      expect(inboxItem.lastMessage).toMatchObject({
        id: msg.id,
        body: msg.body,
        fromMe: false,
        authorHandle: 'bob_h',
      });
      expect(inboxItem.lastMessageAt).toBe('2026-11-09T12:00:00.000Z');
    });
  });

  describe('isEligibleDirectMessagePeer & mapDirectMessageWriteError', () => {
    it('validates peer eligibility across role, verification, suspension, and deactivation', () => {
      expect(isEligibleDirectMessagePeer(makeParticipant(USER_B))).toBe(true);
      expect(isEligibleDirectMessagePeer(null)).toBe(false);
      expect(isEligibleDirectMessagePeer(makeParticipant(USER_B, { role: 'ADMIN' }))).toBe(false);
      expect(isEligibleDirectMessagePeer(makeParticipant(USER_B, { is_verified: false }))).toBe(false);
      expect(isEligibleDirectMessagePeer(makeParticipant(USER_B, { is_suspended: true }))).toBe(false);
      expect(isEligibleDirectMessagePeer(makeParticipant(USER_B, { is_deactivated: true }))).toBe(false);
    });

    // #435: one set of codes, the same ones the route guard uses (DM_DENIALS).
    it.each([
      ['DM_PEER_BLOCKED: blocked pair', 'DM_PEER_UNAVAILABLE'],
      ['PARTICIPANT_BLOCKED trigger error', 'DM_PEER_UNAVAILABLE'],
      ['DM_PEER_SUSPENDED: peer suspended', 'DM_PEER_UNAVAILABLE'],
      ['DM_PEER_UNVERIFIED: peer unverified', 'DM_PEER_UNAVAILABLE'],
      ['DM_ACCOUNT_SUSPENDED: caller suspended', 'DM_ACCOUNT_NOT_ELIGIBLE'],
      ['DM_NOT_A_PARTICIPANT: author not in thread', 'FORBIDDEN_NOT_THREAD_PARTICIPANT'],
      ['DM_THREAD_ACCESS_DENIED: forbidden', 'FORBIDDEN_NOT_THREAD_PARTICIPANT'],
    ])('maps database trigger error "%s" to 403 %s', (dbMessage, expectedCode) => {
      const mapped = mapDirectMessageWriteError(new Error(dbMessage));
      expect(mapped).toBeInstanceOf(DirectMessageServiceError);
      expect(mapped?.status).toBe(403);
      expect(mapped?.code).toBe(expectedCode);
    });

    it('a trigger-level block, suspension and unverified peer all give the same answer, so a block is never revealed', () => {
      const answers = [
        'DM_PEER_BLOCKED: x',
        'PARTICIPANT_BLOCKED',
        'DM_PEER_SUSPENDED: x',
        'DM_PEER_UNVERIFIED: x',
      ].map((m) => {
        const e = mapDirectMessageWriteError(new Error(m));
        return `${e?.status}|${e?.code}|${e?.message}`;
      });
      expect(new Set(answers).size).toBe(1);
    });

    it('never produces the retired duplicate codes', () => {
      const retired = ['DM_PEER_BLOCKED', 'DM_PEER_SUSPENDED', 'DM_PEER_UNVERIFIED', 'DM_THREAD_ACCESS_DENIED'];
      for (const m of ['DM_PEER_BLOCKED', 'PARTICIPANT_BLOCKED', 'DM_PEER_SUSPENDED', 'DM_ACCOUNT_SUSPENDED', 'DM_PEER_UNVERIFIED', 'DM_NOT_A_PARTICIPANT', 'DM_THREAD_ACCESS_DENIED']) {
        expect(retired).not.toContain(mapDirectMessageWriteError(new Error(m))?.code);
      }
    });

    it('returns null for unrecognized database errors so they propagate as 500', () => {
      expect(mapDirectMessageWriteError(new Error('connection timeout'))).toBeNull();
    });
  });

  describe('openOrContinueDirectThread', () => {
    it('rejects self-DM with 400 CANNOT_MESSAGE_SELF and creates or reuses thread for valid peer', async () => {
      const dmRepo: Partial<IDirectMessageRepository> = {
        findOrCreateThread: vi.fn().mockResolvedValue({ thread: makeThread(), created: false }),
      };
      const participantsRepo: Pick<IParticipantRepository, 'findById'> = {
        findById: vi.fn().mockResolvedValue(makeParticipant(USER_B)),
      };
      const profileRepo: Pick<IProfileRepository, 'findProfileByParticipantId'> = {
        findProfileByParticipantId: vi.fn().mockResolvedValue({ handle: 'bob_h' } as never),
      };

      await expect(
        openOrContinueDirectThread(
          { caller: makeParticipant(USER_A), peerId: USER_A },
          { dmRepo, participantsRepo, profileRepo }
        )
      ).rejects.toMatchObject({ status: 400, code: 'CANNOT_MESSAGE_SELF' });

      const reused = await openOrContinueDirectThread(
        { caller: makeParticipant(USER_A), peerId: USER_B },
        { dmRepo, participantsRepo, profileRepo }
      );
      expect(reused.created).toBe(false);
      expect(reused.thread.peer).toEqual({ id: USER_B, handle: 'bob_h' });
    });
  });

  describe('listDmInbox', () => {
    it('rejects blank participantId with 401 UNAUTHORIZED', async () => {
      await expect(listDmInbox('   ')).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('orders threads by most recent activity descending and filters out unrelated threads', async () => {
      const olderThread = makeThread({
        id: THREAD_AB,
        participant_low_id: USER_A,
        participant_high_id: USER_B,
        last_message_at: '2026-11-09T10:00:00.000Z',
      });
      const newerThread = makeThread({
        id: THREAD_AC,
        participant_low_id: USER_A,
        participant_high_id: USER_C,
        last_message_at: '2026-11-09T14:00:00.000Z',
      });
      const unrelatedThread = makeThread({
        id: '33333333-3333-4333-8333-333333333333',
        participant_low_id: USER_B,
        participant_high_id: USER_C,
      });

      const msgOld = makeMessage({
        id: '10000000-0000-4000-8000-000000000001',
        thread_id: THREAD_AB,
        created_at: '2026-11-09T10:00:00.000Z',
      });
      const msgNew = makeMessage({
        id: '10000000-0000-4000-8000-000000000002',
        thread_id: THREAD_AC,
        created_at: '2026-11-09T14:00:00.000Z',
      });

      const dmRepo: Partial<IDirectMessageRepository> = {
        listThreadsForParticipant: vi
          .fn()
          .mockResolvedValue([olderThread, unrelatedThread, newerThread]),
        findLatestMessagesForThreads: vi.fn().mockResolvedValue(
          new Map([
            [THREAD_AB, msgOld],
            [THREAD_AC, msgNew],
          ])
        ),
      };
      const profileRepo: Pick<IProfileRepository, 'findProfileByParticipantId'> = {
        findProfileByParticipantId: vi.fn(async (id: string) => {
          if (id === USER_B) return { handle: 'bob_handle' } as never;
          if (id === USER_C) return { handle: 'carol_handle' } as never;
          return null;
        }),
      };

      const inbox = await listDmInbox(USER_A, { dmRepo, profileRepo });
      expect(inbox.isEmpty).toBe(false);
      expect(inbox.threads.map((t) => t.id)).toEqual([THREAD_AC, THREAD_AB]);
      expect(inbox.threads[0].peer.handle).toBe('carol_handle');
      expect(inbox.threads[1].peer.handle).toBe('bob_handle');
    });
  });

  describe('getDmThread & listDmThreadMessages', () => {
    it('sorts messages oldest-first chronologically and sets isEmpty=true when no messages exist', async () => {
      const m1 = makeMessage({
        id: '10000000-0000-4000-8000-000000000001',
        author_id: USER_A,
        body: 'First',
        created_at: '2026-11-09T10:00:00.000Z',
      });
      const m2 = makeMessage({
        id: '10000000-0000-4000-8000-000000000002',
        author_id: USER_B,
        body: 'Second',
        created_at: '2026-11-09T10:05:00.000Z',
      });

      const dmRepo: Partial<IDirectMessageRepository> = {
        findThreadById: vi.fn().mockResolvedValue(makeThread()),
        listMessagesByThread: vi.fn().mockResolvedValue([m2, m1]),
      };
      const profileRepo: Pick<IProfileRepository, 'findProfileByParticipantId'> = {
        findProfileByParticipantId: vi.fn(async (id: string) =>
          id === USER_A ? ({ handle: 'alice_h' } as never) : ({ handle: 'bob_h' } as never)
        ),
      };

      const detail = await listDmThreadMessages(
        { threadId: THREAD_AB, participantId: USER_A },
        { dmRepo, profileRepo }
      );
      expect(detail.isEmpty).toBe(false);
      expect(detail.messages.map((m) => m.body)).toEqual(['First', 'Second']);
      expect(detail.thread.lastMessage?.body).toBe('Second');

      vi.mocked(dmRepo.listMessagesByThread!).mockResolvedValue([]);
      const emptyDetail = await getDmThread(
        { threadId: THREAD_AB, participantId: USER_A },
        { dmRepo, profileRepo }
      );
      expect(emptyDetail.isEmpty).toBe(true);
      expect(emptyDetail.messages).toEqual([]);
    });

    it('throws 403 FORBIDDEN_NOT_THREAD_PARTICIPANT for blank IDs or third-party caller', async () => {
      const dmRepo: Partial<IDirectMessageRepository> = {
        findThreadById: vi.fn().mockResolvedValue(makeThread()),
      };
      await expect(
        getDmThread({ threadId: '', participantId: USER_A }, { dmRepo })
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN_NOT_THREAD_PARTICIPANT' });

      await expect(
        getDmThread({ threadId: THREAD_AB, participantId: USER_C }, { dmRepo })
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN_NOT_THREAD_PARTICIPANT' });
    });
  });

  describe('sendDmMessage', () => {
    it('enforces body validation, peer eligibility, block rules, and DB trigger error mapping', async () => {
      const dmRepo: Partial<IDirectMessageRepository> = {
        findThreadById: vi.fn().mockResolvedValue(makeThread()),
        createMessage: vi.fn().mockResolvedValue(makeMessage({ body: 'Clean message' })),
      };
      const participantsRepo: Pick<IParticipantRepository, 'findById'> = {
        findById: vi.fn().mockResolvedValue(makeParticipant(USER_B)),
      };
      const profileRepo: Pick<IProfileRepository, 'findProfileByParticipantId'> = {
        findProfileByParticipantId: vi.fn().mockResolvedValue({ handle: 'alice_h' } as never),
      };
      const blockRepo: Pick<IParticipantBlockRepository, 'findBlockState'> = {
        findBlockState: vi.fn().mockResolvedValue({ blockedByMe: false, blockedByThem: false }),
      };
      const deps = { dmRepo, participantsRepo, profileRepo, blockRepo };

      // Blank body
      await expect(
        sendDmMessage({ threadId: THREAD_AB, authorId: USER_A, body: '   ' }, deps)
      ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

      // Overlong body
      await expect(
        sendDmMessage({ threadId: THREAD_AB, authorId: USER_A, body: 'x'.repeat(4001) }, deps)
      ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

      // Database trigger error mapped on write (same neutral code as the guard)
      vi.mocked(dmRepo.createMessage!).mockRejectedValueOnce(
        new Error('DM_PEER_SUSPENDED: peer suspended at write time')
      );
      await expect(
        sendDmMessage({ threadId: THREAD_AB, authorId: USER_A, body: 'Hello' }, deps)
      ).rejects.toMatchObject({ status: 403, code: 'DM_PEER_UNAVAILABLE' });

      // Happy path
      const created = await sendDmMessage(
        { threadId: THREAD_AB, authorId: USER_A, body: '  Clean message  ' },
        deps
      );
      expect(created.body).toBe('Clean message');
      expect(created.authorHandle).toBe('alice_h');
    });

    describe('denials use the same codes as the route guard (#435)', () => {
      const send = (
        peer: ReturnType<typeof makeParticipant> | null,
        blocks: { blockedByMe: boolean; blockedByThem: boolean } = { blockedByMe: false, blockedByThem: false }
      ) => {
        const createMessage = vi.fn().mockResolvedValue(makeMessage({ body: 'Hello' }));
        const promise = sendDmMessage(
          { threadId: THREAD_AB, authorId: USER_A, body: 'Hello' },
          {
            dmRepo: { findThreadById: vi.fn().mockResolvedValue(makeThread()), createMessage },
            participantsRepo: { findById: vi.fn().mockResolvedValue(peer) },
            profileRepo: { findProfileByParticipantId: vi.fn().mockResolvedValue(null) },
            blockRepo: { findBlockState: vi.fn().mockResolvedValue(blocks) },
          }
        );
        return { promise, createMessage };
      };

      it.each([
        ['suspended', () => makeParticipant(USER_B, { is_suspended: true })],
        ['deactivated', () => makeParticipant(USER_B, { is_deactivated: true })],
        ['unverified', () => makeParticipant(USER_B, { is_verified: false })],
        ['not a participant account', () => makeParticipant(USER_B, { role: 'ADMIN' })],
        ['missing', () => null],
      ])('a %s peer is refused with DM_PEER_UNAVAILABLE and nothing is written', async (_label, peer) => {
        const { promise, createMessage } = send(peer());
        await expect(promise).rejects.toMatchObject({ status: 403, code: 'DM_PEER_UNAVAILABLE' });
        expect(createMessage).not.toHaveBeenCalled();
      });

      it('a person who was blocked gets exactly the same answer as for a suspended peer', async () => {
        const blocked = await send(makeParticipant(USER_B), { blockedByMe: false, blockedByThem: true }).promise.catch((e) => e);
        const suspended = await send(makeParticipant(USER_B, { is_suspended: true })).promise.catch((e) => e);
        expect([blocked.status, blocked.code, blocked.message]).toEqual([suspended.status, suspended.code, suspended.message]);
        expect(blocked.code).toBe('DM_PEER_UNAVAILABLE');
        expect(blocked.message).not.toMatch(/block/i);
      });

      it('only the person who set the block is told: DM_BLOCKED_BY_YOU', async () => {
        const { promise, createMessage } = send(makeParticipant(USER_B), { blockedByMe: true, blockedByThem: false });
        await expect(promise).rejects.toMatchObject({ status: 403, code: 'DM_BLOCKED_BY_YOU' });
        expect(createMessage).not.toHaveBeenCalled();
      });

      it('when both people blocked each other, the sender is told about their own block', async () => {
        const { promise } = send(makeParticipant(USER_B), { blockedByMe: true, blockedByThem: true });
        await expect(promise).rejects.toMatchObject({ code: 'DM_BLOCKED_BY_YOU' });
      });

      it('an eligible peer with no blocks can be messaged', async () => {
        const { promise, createMessage } = send(makeParticipant(USER_B));
        await expect(promise).resolves.toMatchObject({ body: 'Hello' });
        expect(createMessage).toHaveBeenCalledTimes(1);
      });
    });
  });
});
