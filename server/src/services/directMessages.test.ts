import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DirectMessage,
  DirectMessageThread,
  IDirectMessageRepository,
} from '../db/directMessage.repository.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
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

    it.each([
      ['DM_PEER_BLOCKED: blocked pair', 'DM_PEER_BLOCKED'],
      ['PARTICIPANT_BLOCKED trigger error', 'DM_PEER_BLOCKED'],
      ['DM_PEER_SUSPENDED: peer suspended', 'DM_PEER_SUSPENDED'],
      ['DM_ACCOUNT_SUSPENDED: caller suspended', 'DM_PEER_SUSPENDED'],
      ['DM_PEER_UNVERIFIED: peer unverified', 'DM_PEER_UNVERIFIED'],
      ['DM_NOT_A_PARTICIPANT: author not in thread', 'DM_THREAD_ACCESS_DENIED'],
      ['DM_THREAD_ACCESS_DENIED: forbidden', 'DM_THREAD_ACCESS_DENIED'],
    ])('maps database trigger error "%s" to 403 %s', (dbMessage, expectedCode) => {
      const mapped = mapDirectMessageWriteError(new Error(dbMessage));
      expect(mapped).toBeInstanceOf(DirectMessageServiceError);
      expect(mapped?.status).toBe(403);
      expect(mapped?.code).toBe(expectedCode);
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

    it('throws 403 DM_THREAD_ACCESS_DENIED for blank IDs or third-party caller', async () => {
      const dmRepo: Partial<IDirectMessageRepository> = {
        findThreadById: vi.fn().mockResolvedValue(makeThread()),
      };
      await expect(
        getDmThread({ threadId: '', participantId: USER_A }, { dmRepo })
      ).rejects.toMatchObject({ status: 403, code: 'DM_THREAD_ACCESS_DENIED' });

      await expect(
        getDmThread({ threadId: THREAD_AB, participantId: USER_C }, { dmRepo })
      ).rejects.toMatchObject({ status: 403, code: 'DM_THREAD_ACCESS_DENIED' });
    });
  });

  describe('sendDmMessage', () => {
    it('enforces body validation, peer eligibility, block rules, and DB trigger error mapping', async () => {
      const dmRepo: Partial<IDirectMessageRepository> = {
        findThreadById: vi.fn().mockResolvedValue(makeThread()),
        isParticipantPairBlocked: vi.fn().mockResolvedValue(false),
        createMessage: vi.fn().mockResolvedValue(makeMessage({ body: 'Clean message' })),
      };
      const participantsRepo: Pick<IParticipantRepository, 'findById'> = {
        findById: vi.fn().mockResolvedValue(makeParticipant(USER_B)),
      };
      const profileRepo: Pick<IProfileRepository, 'findProfileByParticipantId'> = {
        findProfileByParticipantId: vi.fn().mockResolvedValue({ handle: 'alice_h' } as never),
      };

      // Blank body
      await expect(
        sendDmMessage(
          { threadId: THREAD_AB, authorId: USER_A, body: '   ' },
          { dmRepo, participantsRepo, profileRepo }
        )
      ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

      // Overlong body
      await expect(
        sendDmMessage(
          { threadId: THREAD_AB, authorId: USER_A, body: 'x'.repeat(4001) },
          { dmRepo, participantsRepo, profileRepo }
        )
      ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

      // Blocked pair in service check
      vi.mocked(dmRepo.isParticipantPairBlocked!).mockResolvedValueOnce(true);
      await expect(
        sendDmMessage(
          { threadId: THREAD_AB, authorId: USER_A, body: 'Hello' },
          { dmRepo, participantsRepo, profileRepo }
        )
      ).rejects.toMatchObject({ status: 403, code: 'DM_PEER_BLOCKED' });

      // Database trigger error mapped on write
      vi.mocked(dmRepo.createMessage!).mockRejectedValueOnce(
        new Error('DM_PEER_SUSPENDED: peer suspended at write time')
      );
      await expect(
        sendDmMessage(
          { threadId: THREAD_AB, authorId: USER_A, body: 'Hello' },
          { dmRepo, participantsRepo, profileRepo }
        )
      ).rejects.toMatchObject({ status: 403, code: 'DM_PEER_SUSPENDED' });

      // Happy path
      const created = await sendDmMessage(
        { threadId: THREAD_AB, authorId: USER_A, body: '  Clean message  ' },
        { dmRepo, participantsRepo, profileRepo }
      );
      expect(created.body).toBe('Clean message');
      expect(created.authorHandle).toBe('alice_h');
    });
  });
});
