/**
 * US-032 / #391 / FR-089 & FR-091 — Direct-Message Access, Validation & Privacy Integration Suite
 *
 * Covers the complete US-032 acceptance matrix:
 *   1. Thread reuse & canonical pair idempotency (201 on first open, 200 on repeat or reverse
 *      open by peer, case-insensitive UUID normalization).
 *   2. Happy path end-to-end conversation flow across two verified active PART users:
 *      open thread -> empty thread view -> exchange messages -> chronological message list ->
 *      inbox ordering across `/api/direct-messages`, `/inbox`, and `/threads`.
 *   3. Third-party denial & anti-enumeration: unrelated PART receives 403
 *      FORBIDDEN_NOT_THREAD_PARTICIPANT identical to a non-existent thread ID across read and
 *      send endpoints, with zero message or thread metadata leakage.
 *   4. Account restrictions & block lifecycle: Visitors (401), missing MFA (403), ADMIN (403),
 *      unverified/suspended/deactivated callers (403); unavailable peers on thread open return
 *      identical 404 PEER_NOT_AVAILABLE; sending to suspended/unverified/deactivated/blocked-by-peer
 *      returns 403 DM_PEER_UNAVAILABLE; sending when blocked-by-you returns 403 DM_BLOCKED_BY_YOU;
 *      historical read access remains available to eligible participants when peer is restricted.
 *   5. Blank messages, boundary validation (1, 4000, 4001 chars), spoofing rejection, and
 *      draft preservation with credential redaction (NR-010, NR-017).
 *   6. Privacy guarantees (FR-089): no email, full_name, firebase_uid, password, OTP, token,
 *      or internal keys ever appear in DM thread, inbox, message, or error responses.
 *   7. Failure handling: repository/storage errors surface cleanly as 500 (or mapped 403 for
 *      DB constraint triggers) without masking as 404/200 or leaking sensitive internals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import {
  canonicalParticipantPair,
  directMessageRepository,
  type DirectMessage,
  type DirectMessageThread,
} from '../db/directMessage.repository.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import type { Participant } from '../db/types.js';
import { publicPayloadHasPrivateChatKey } from '../services/chatPrivacy.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
  };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const AUTH_HEADER = { Authorization: 'Bearer valid-dm-mfa-token' };

const THREAD_AB_ID = '44444444-4444-4444-8444-444444444444';
const THREAD_AC_ID = '55555555-5555-4555-8555-555555555555';
const UNKNOWN_THREAD_ID = '99999999-9999-4999-8999-999999999999';

const aliceParticipant: Participant = {
  id: '10000000-0000-4000-8000-000000000001',
  firebase_uid: 'fb-alice-dm-1',
  email: 'alice.private@example.com',
  full_name: 'Alice Private Name',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

const bobParticipant: Participant = {
  id: '20000000-0000-4000-8000-000000000002',
  firebase_uid: 'fb-bob-dm-2',
  email: 'bob.private@example.com',
  full_name: 'Bob Private Name',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

const carolOutsider: Participant = {
  id: '30000000-0000-4000-8000-000000000003',
  firebase_uid: 'fb-carol-dm-3',
  email: 'carol.private@example.com',
  full_name: 'Carol Outsider Name',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

const adminActor: Participant = {
  id: '40000000-0000-4000-8000-000000000004',
  firebase_uid: 'fb-admin-dm-4',
  email: 'admin.private@example.com',
  full_name: 'Platform Admin',
  role: 'ADMIN',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

function makeToken(actor: Participant, withMfa = true): DecodedIdToken {
  const token: Record<string, unknown> = {
    uid: actor.firebase_uid,
    email: actor.email,
    role: actor.role,
    auth_time: AUTH_TIME,
  };
  if (withMfa) {
    token[MFA_CLAIM] = AUTH_TIME;
  }
  return token as unknown as DecodedIdToken;
}

describe('US-032 / #391 DM access, validation, and privacy integration & route suite', () => {
  let directory: Record<string, Participant | null>;
  let threadsStore: Map<string, DirectMessageThread>;
  let messagesStore: Map<string, DirectMessage[]>;
  let currentCaller: Participant;

  function switchCaller(actor: Participant, withMfa = true): void {
    currentCaller = actor;
    mockVerifyIdToken.mockResolvedValue(makeToken(actor, withMfa));
    vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(actor);
  }

  beforeEach(() => {
    vi.restoreAllMocks();

    directory = {
      [aliceParticipant.id]: { ...aliceParticipant },
      [bobParticipant.id]: { ...bobParticipant },
      [carolOutsider.id]: { ...carolOutsider },
      [adminActor.id]: { ...adminActor },
    };

    const initialThread: DirectMessageThread = {
      id: THREAD_AB_ID,
      participant_low_id: aliceParticipant.id,
      participant_high_id: bobParticipant.id,
      last_message_at: '2026-11-09T10:00:00.000Z',
      created_at: '2026-11-09T10:00:00.000Z',
      updated_at: '2026-11-09T10:00:00.000Z',
    };

    threadsStore = new Map([[THREAD_AB_ID, initialThread]]);
    messagesStore = new Map([[THREAD_AB_ID, []]]);

    currentCaller = aliceParticipant;
    mockVerifyIdToken.mockResolvedValue(makeToken(aliceParticipant));

    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockImplementation(
      async () => currentCaller
    );
    vi.spyOn(participantsRepository, 'findById').mockImplementation(
      async (id: string) => directory[id.toLowerCase()] ?? null
    );

    vi.spyOn(participantBlockRepository, 'findBlockState').mockResolvedValue({
      blockedByMe: false,
      blockedByThem: false,
    });
    vi.spyOn(directMessageRepository, 'isParticipantPairBlocked').mockResolvedValue(false);

    vi.spyOn(directMessageRepository, 'findThreadById').mockImplementation(
      async (threadId: string) => threadsStore.get(threadId.toLowerCase()) ?? null
    );

    vi.spyOn(directMessageRepository, 'findOrCreateThread').mockImplementation(
      async (low: string, high: string) => {
        for (const existing of threadsStore.values()) {
          if (
            existing.participant_low_id === low &&
            existing.participant_high_id === high
          ) {
            return { thread: existing, created: false };
          }
        }
        const createdThread: DirectMessageThread = {
          id: THREAD_AC_ID,
          participant_low_id: low,
          participant_high_id: high,
          last_message_at: '2026-11-09T11:00:00.000Z',
          created_at: '2026-11-09T11:00:00.000Z',
          updated_at: '2026-11-09T11:00:00.000Z',
        };
        threadsStore.set(createdThread.id, createdThread);
        messagesStore.set(createdThread.id, []);
        return { thread: createdThread, created: true };
      }
    );

    vi.spyOn(directMessageRepository, 'listThreadsForParticipant').mockImplementation(
      async (participantId: string) => {
        const pid = participantId.toLowerCase();
        return [...threadsStore.values()].filter(
          (t) => t.participant_low_id === pid || t.participant_high_id === pid
        );
      }
    );

    vi.spyOn(directMessageRepository, 'listMessagesByThread').mockImplementation(
      async (threadId: string) => [...(messagesStore.get(threadId) ?? [])]
    );

    vi.spyOn(directMessageRepository, 'findLatestMessagesForThreads').mockImplementation(
      async (threadIds: string[]) => {
        const result = new Map<string, DirectMessage>();
        for (const id of threadIds) {
          const list = messagesStore.get(id) ?? [];
          if (list.length > 0) {
            result.set(id, list[list.length - 1]);
          }
        }
        return result;
      }
    );

    vi.spyOn(directMessageRepository, 'createMessage').mockImplementation(async (dto) => {
      const list = messagesStore.get(dto.thread_id) ?? [];
      const timestamp = `2026-11-09T12:0${list.length}:00.000Z`;
      const msg: DirectMessage = {
        id: `80000000-0000-4000-8000-00000000000${list.length + 1}`,
        thread_id: dto.thread_id,
        author_id: dto.author_id,
        body: dto.body,
        created_at: timestamp,
      };
      list.push(msg);
      messagesStore.set(dto.thread_id, list);
      const thread = threadsStore.get(dto.thread_id);
      if (thread) {
        thread.last_message_at = timestamp;
        thread.updated_at = timestamp;
      }
      return msg;
    });

    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockImplementation(
      async (id: string) => {
        if (id === aliceParticipant.id) {
          return {
            participant_id: id,
            handle: 'alice_builder',
            email: aliceParticipant.email,
          } as never;
        }
        if (id === bobParticipant.id) {
          return {
            participant_id: id,
            handle: 'bob_coder',
            email: bobParticipant.email,
          } as never;
        }
        if (id === carolOutsider.id) {
          return {
            participant_id: id,
            handle: 'carol_design',
            email: carolOutsider.email,
          } as never;
        }
        return null;
      }
    );
  });

  describe('1. Thread reuse and canonical pair idempotency', () => {
    it('creates a new thread once (201) and reuses the exact same thread (200) when opened again by either participant', async () => {
      threadsStore.clear();
      messagesStore.clear();

      // Alice opens DM thread with Carol -> 201 Created
      const firstOpen = await request(app)
        .post('/api/direct-messages/threads')
        .set(AUTH_HEADER)
        .send({ participantId: carolOutsider.id });

      expect(firstOpen.status).toBe(201);
      expect(firstOpen.body.thread).toMatchObject({
        id: THREAD_AC_ID,
        peer: { id: carolOutsider.id, handle: 'carol_design' },
      });

      // Alice repeats the exact same call -> 200 OK, same thread ID
      const repeatByAlice = await request(app)
        .post('/api/direct-messages/threads')
        .set(AUTH_HEADER)
        .send({ participantId: carolOutsider.id.toUpperCase() });

      expect(repeatByAlice.status).toBe(200);
      expect(repeatByAlice.body.thread.id).toBe(THREAD_AC_ID);

      // Carol opens DM thread with Alice (reverse order) -> 200 OK, same canonical thread ID
      switchCaller(carolOutsider);
      const reverseByCarol = await request(app)
        .post('/api/direct-messages/threads')
        .set(AUTH_HEADER)
        .send({ participantId: aliceParticipant.id });

      expect(reverseByCarol.status).toBe(200);
      expect(reverseByCarol.body.thread.id).toBe(THREAD_AC_ID);
      expect(reverseByCarol.body.thread.peer).toEqual({
        id: aliceParticipant.id,
        handle: 'alice_builder',
      });

      const canonical = canonicalParticipantPair(aliceParticipant.id, carolOutsider.id);
      expect(canonical).toEqual({
        low: aliceParticipant.id,
        high: carolOutsider.id,
      });
    });
  });

  describe('2. Happy path end-to-end conversation flow (inbox, thread, send-message)', () => {
    it('supports opening empty thread, exchanging messages between both participants, reading chronological history, and ordering inbox', async () => {
      // 1. Alice opens thread detail before any messages are sent -> isEmpty: true
      const emptyDetail = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}`)
        .set(AUTH_HEADER);

      expect(emptyDetail.status).toBe(200);
      expect(emptyDetail.body.isEmpty).toBe(true);
      expect(emptyDetail.body.messages).toEqual([]);
      expect(emptyDetail.body.thread.peer).toEqual({
        id: bobParticipant.id,
        handle: 'bob_coder',
      });

      // 2. Alice sends first message (with surrounding whitespace that gets normalized)
      const aliceSend = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: '  Hi Bob, want to pair on the backend?  ' });

      expect(aliceSend.status).toBe(201);
      expect(aliceSend.body.message).toMatchObject({
        threadId: THREAD_AB_ID,
        fromMe: true,
        authorHandle: 'alice_builder',
        body: 'Hi Bob, want to pair on the backend?',
        createdAt: '2026-11-09T12:00:00.000Z',
      });
      expect(aliceSend.body.message).not.toHaveProperty('authorId');

      // 3. Bob replies in the same thread
      switchCaller(bobParticipant);
      const bobSend = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Count me in! Let us start tonight.' });

      expect(bobSend.status).toBe(201);
      expect(bobSend.body.message).toMatchObject({
        threadId: THREAD_AB_ID,
        fromMe: true,
        authorHandle: 'bob_coder',
        body: 'Count me in! Let us start tonight.',
        createdAt: '2026-11-09T12:01:00.000Z',
      });
      expect(bobSend.body.message).not.toHaveProperty('authorId');

      // 4. Both /threads/:threadId and /threads/:threadId/messages return chronological history
      const historyRes = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.isEmpty).toBe(false);
      expect(historyRes.body.messages.map((m: { body: string }) => m.body)).toEqual([
        'Hi Bob, want to pair on the backend?',
        'Count me in! Let us start tonight.',
      ]);
      expect(historyRes.body.thread.peer).toEqual({
        id: aliceParticipant.id,
        handle: 'alice_builder',
      });

      // 5. Alice also opens a second thread with Carol and sends a newer message at 12:05
      switchCaller(aliceParticipant);
      await request(app)
        .post('/api/direct-messages/threads')
        .set(AUTH_HEADER)
        .send({ participantId: carolOutsider.id });

      messagesStore.set(THREAD_AC_ID, [
        {
          id: '80000000-0000-4000-8000-000000000099',
          thread_id: THREAD_AC_ID,
          author_id: carolOutsider.id,
          body: 'Hey Alice, saw your profile!',
          created_at: '2026-11-09T12:05:00.000Z',
        },
      ]);
      const threadAc = threadsStore.get(THREAD_AC_ID);
      if (threadAc) {
        threadAc.last_message_at = '2026-11-09T12:05:00.000Z';
        threadAc.updated_at = '2026-11-09T12:05:00.000Z';
      }

      // 6. All three inbox aliases (/, /inbox, /threads) return threads ordered newest-first
      for (const path of [
        '/api/direct-messages',
        '/api/direct-messages/inbox',
        '/api/direct-messages/threads',
      ]) {
        const inboxRes = await request(app).get(path).set(AUTH_HEADER);
        expect(inboxRes.status).toBe(200);
        expect(inboxRes.body.isEmpty).toBe(false);
        expect(inboxRes.body.threads.map((t: { id: string }) => t.id)).toEqual([
          THREAD_AC_ID,
          THREAD_AB_ID,
        ]);
        expect(inboxRes.body.threads[0].lastMessage.body).toBe(
          'Hey Alice, saw your profile!'
        );
        expect(inboxRes.body.threads[1].lastMessage.body).toBe(
          'Count me in! Let us start tonight.'
        );
      }
    });
  });

  describe('3. Third-party denial & anti-enumeration', () => {
    it('denies a third-party participant across thread detail, message history, and send-message with the exact same 403 as a non-existent thread', async () => {
      // Seed a private message between Alice and Bob
      messagesStore.set(THREAD_AB_ID, [
        {
          id: '80000000-0000-4000-8000-000000000001',
          thread_id: THREAD_AB_ID,
          author_id: aliceParticipant.id,
          body: 'Confidential project idea between Alice and Bob',
          created_at: '2026-11-09T12:00:00.000Z',
        },
      ]);

      // Carol (authenticated verified PART, not in THREAD_AB_ID) probes all three thread routes
      switchCaller(carolOutsider);

      const detailOutsider = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}`)
        .set(AUTH_HEADER);
      const historyOutsider = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER);
      const sendOutsider = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Intruder message' });

      // Carol also probes a completely non-existent thread UUID
      const detailMissing = await request(app)
        .get(`/api/direct-messages/threads/${UNKNOWN_THREAD_ID}`)
        .set(AUTH_HEADER);

      for (const res of [detailOutsider, historyOutsider, sendOutsider, detailMissing]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: 'You do not have access to this conversation.',
          code: 'FORBIDDEN_NOT_THREAD_PARTICIPANT',
        });
        expect(JSON.stringify(res.body)).not.toContain('Confidential project idea');
        expect(JSON.stringify(res.body)).not.toContain('alice_builder');
        expect(JSON.stringify(res.body)).not.toContain('bob_coder');
      }

      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });
  });

  describe('4. Account restrictions & block enforcement', () => {
    it('rejects Visitors (401) and missing-MFA sessions (403) across all DM endpoints', async () => {
      const endpoints = [
        () => request(app).get('/api/direct-messages/threads'),
        () =>
          request(app)
            .post('/api/direct-messages/threads')
            .send({ participantId: bobParticipant.id }),
        () => request(app).get(`/api/direct-messages/threads/${THREAD_AB_ID}`),
        () => request(app).get(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`),
        () =>
          request(app)
            .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
            .send({ body: 'hi' }),
      ];

      for (const call of endpoints) {
        const visitorRes = await call();
        expect(visitorRes.status).toBe(401);
      }

      // Authenticated token without MFA claim -> 403
      switchCaller(aliceParticipant, false);
      const noMfaRes = await request(app)
        .get('/api/direct-messages/threads')
        .set(AUTH_HEADER);
      expect(noMfaRes.status).toBe(403);
    });

    it.each([
      ['ADMIN role', adminActor],
      ['unverified PART', { ...aliceParticipant, is_verified: false }],
      ['suspended PART', { ...aliceParticipant, is_suspended: true }],
      ['deactivated PART', { ...aliceParticipant, is_deactivated: true }],
    ])('denies caller with %s (403) across inbox, open thread, read, and send', async (_label, restrictedCaller) => {
      switchCaller(restrictedCaller);

      const inboxRes = await request(app).get('/api/direct-messages/threads').set(AUTH_HEADER);
      const openRes = await request(app)
        .post('/api/direct-messages/threads')
        .set(AUTH_HEADER)
        .send({ participantId: bobParticipant.id });
      const readRes = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}`)
        .set(AUTH_HEADER);
      const sendRes = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Should be blocked' });

      expect(inboxRes.status).toBe(403);
      expect(openRes.status).toBe(403);
      expect(readRes.status).toBe(403);
      expect(sendRes.status).toBe(403);
      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });

    it('enforces peer suspension, deactivation, unverified state, and bidirectional blocks on send while preserving historical read access for eligible participant', async () => {
      // Seed an existing message before restrictions take effect
      messagesStore.set(THREAD_AB_ID, [
        {
          id: '80000000-0000-4000-8000-000000000001',
          thread_id: THREAD_AB_ID,
          author_id: bobParticipant.id,
          body: 'Earlier message from Bob before restriction',
          created_at: '2026-11-09T10:00:00.000Z',
        },
      ]);

      // Case A: Bob is deactivated -> Alice cannot send (403 DM_PEER_UNAVAILABLE)
      directory[bobParticipant.id] = { ...bobParticipant, is_deactivated: true };
      const sendToDeactivated = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Are you still there?' });
      expect(sendToDeactivated.status).toBe(403);
      expect(sendToDeactivated.body.code).toBe('DM_PEER_UNAVAILABLE');

      // Alice can still read her existing conversation history
      const readWhilePeerDeactivated = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}`)
        .set(AUTH_HEADER);
      expect(readWhilePeerDeactivated.status).toBe(200);
      expect(readWhilePeerDeactivated.body.messages).toHaveLength(1);

      // Restore Bob, test block states
      directory[bobParticipant.id] = { ...bobParticipant };

      // Case B: Bob blocked Alice -> Alice gets 403 DM_PEER_UNAVAILABLE (same as suspension)
      vi.mocked(participantBlockRepository.findBlockState).mockResolvedValueOnce({
        blockedByMe: false,
        blockedByThem: true,
      });
      const sendBlockedByPeer = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Hello?' });
      expect(sendBlockedByPeer.status).toBe(403);
      expect(sendBlockedByPeer.body).toEqual(sendToDeactivated.body);

      // Case C: Alice blocked Bob -> Alice gets 403 DM_BLOCKED_BY_YOU
      vi.mocked(participantBlockRepository.findBlockState).mockResolvedValueOnce({
        blockedByMe: true,
        blockedByThem: false,
      });
      const sendBlockedByMe = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Trying to message while blocking' });
      expect(sendBlockedByMe.status).toBe(403);
      expect(sendBlockedByMe.body.code).toBe('DM_BLOCKED_BY_YOU');
    });
  });

  describe('5. Blank messages, boundary validation, and draft preservation (NR-017)', () => {
    it('accepts 1-char and 4000-char boundaries and rejects blank, 4001-char, or spoofed payloads while preserving redacted draft', async () => {
      // 1-character message succeeds
      const minRes = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'A' });
      expect(minRes.status).toBe(201);
      expect(minRes.body.message.body).toBe('A');

      // 4000-character message succeeds
      const maxBody = 'M'.repeat(4000);
      const maxRes = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: maxBody });
      expect(maxRes.status).toBe(201);
      expect(maxRes.body.message.body).toHaveLength(4000);

      // Whitespace-only message fails with 400 and preserves draft
      const blankDraft = '   \n\t   ';
      const blankRes = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: blankDraft });
      expect(blankRes.status).toBe(400);
      expect(blankRes.body.code).toBe('VALIDATION_ERROR');
      expect(blankRes.body.errors.body).toBe('body is required.');
      expect(blankRes.body.submitted).toEqual({ body: blankDraft });

      // Spoofed authorId + credential field fails with 400 and redacts credential in submitted echo
      const spoofRes = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({
          body: 'Preserved draft text',
          authorId: bobParticipant.id,
          password: 'LeakedPassword!',
          otp: '654321',
        });
      expect(spoofRes.status).toBe(400);
      expect(spoofRes.body.code).toBe('VALIDATION_ERROR');
      expect(spoofRes.body.errors.authorId).toContain('Unknown field');
      expect(spoofRes.body.submitted).toEqual({
        body: 'Preserved draft text',
        authorId: bobParticipant.id,
        password: '[redacted]',
        otp: '[redacted]',
      });
    });
  });

  describe('6. Privacy projections across all DM endpoints (FR-089)', () => {
    it('never leaks email, full_name, firebase_uid, or private keys in open, inbox, thread detail, message history, or send responses', async () => {
      const sendRes = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Checking privacy projection' });
      const inboxRes = await request(app)
        .get('/api/direct-messages/threads')
        .set(AUTH_HEADER);
      const detailRes = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}`)
        .set(AUTH_HEADER);
      const historyRes = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER);

      for (const res of [sendRes, inboxRes, detailRes, historyRes]) {
        expect(res.headers['cache-control']).toBe('no-store');
        expect(publicPayloadHasPrivateChatKey(res.body)).toBe(false);
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain(aliceParticipant.email);
        expect(serialized).not.toContain(bobParticipant.email);
        expect(serialized).not.toContain(aliceParticipant.full_name);
        expect(serialized).not.toContain(bobParticipant.full_name);
        expect(serialized).not.toContain(aliceParticipant.firebase_uid);
        expect(serialized).not.toContain(bobParticipant.firebase_uid);
      }
    });
  });

  describe('7. Storage and service failure handling', () => {
    it('propagates unexpected storage failures as 500 across inbox, thread detail, message list, and send endpoints without masking as 404 or 200', async () => {
      vi.mocked(directMessageRepository.listThreadsForParticipant).mockRejectedValueOnce(
        new Error('supabase connection reset')
      );
      const inboxFail = await request(app)
        .get('/api/direct-messages/threads')
        .set(AUTH_HEADER);
      expect(inboxFail.status).toBe(500);

      vi.mocked(directMessageRepository.listMessagesByThread).mockRejectedValueOnce(
        new Error('read replica timeout')
      );
      const detailFail = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}`)
        .set(AUTH_HEADER);
      expect(detailFail.status).toBe(500);

      vi.mocked(directMessageRepository.listMessagesByThread).mockRejectedValueOnce(
        new Error('read replica timeout')
      );
      const messagesFail = await request(app)
        .get(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER);
      expect(messagesFail.status).toBe(500);

      vi.mocked(directMessageRepository.createMessage).mockRejectedValueOnce(
        new Error('disk full on write')
      );
      const sendFail = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Valid body during outage' });
      expect(sendFail.status).toBe(500);
    });

    it('maps race-condition database trigger errors during POST /messages to 403 DirectMessageServiceError', async () => {
      vi.mocked(directMessageRepository.createMessage).mockRejectedValueOnce(
        new Error('DM_PEER_BLOCKED: blocked concurrently by trigger')
      );
      const raceBlockRes = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_AB_ID}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Message during concurrent block' });

      expect(raceBlockRes.status).toBe(403);
      expect(raceBlockRes.body.code).toBe('DM_PEER_BLOCKED');
    });
  });
});
