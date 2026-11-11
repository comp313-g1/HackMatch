import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { directMessageRepository } from '../db/directMessage.repository.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { directMessagePayloadHasPrivateKey } from '../services/directMessagePrivacy.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { publicPayloadHasPrivateChatKey } from '../services/chatPrivacy.js';
import type { DirectMessage } from '../db/directMessage.repository.js';
import type { Participant } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = { verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) };
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
const URL = '/api/direct-messages/threads';
const THREAD_ID = '44444444-4444-4444-8444-444444444444';

const base: Participant = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  firebase_uid: 'fb-caller',
  email: 'caller@example.com',
  full_name: 'Caller',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  created_at: '2026-10-21T00:00:00.000Z',
  updated_at: '2026-10-21T00:00:00.000Z',
};
const caller = base;
const peer: Participant = {
  ...base,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  firebase_uid: 'fb-peer',
  email: 'peer@example.com',
  full_name: 'Peer Person',
};
const outsider: Participant = {
  ...base,
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  firebase_uid: 'fb-outsider',
  email: 'outsider@example.com',
  full_name: 'Outsider Person',
};

const token = {
  uid: 'fb-caller',
  email: 'caller@example.com',
  role: 'PART',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;
const auth = { Authorization: 'Bearer valid-mfa-token' };

const thread = {
  id: THREAD_ID,
  participant_low_id: caller.id, // aaaa... < bbbb...
  participant_high_id: peer.id,
  last_message_at: '2026-11-09T10:00:00.000Z',
  created_at: '2026-11-09T10:00:00.000Z',
  updated_at: '2026-11-09T10:00:00.000Z',
};

const message: DirectMessage = {
  id: '55555555-5555-4555-8555-555555555555',
  thread_id: THREAD_ID,
  author_id: caller.id,
  body: 'Hello direct message',
  created_at: '2026-11-09T10:05:00.000Z',
};

/** Lookup table used for both the auth middleware (caller) and the peer check. */
let directory: Record<string, Participant | null>;

describe('POST /api/direct-messages/threads (US-032 / #386 / FR-091)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(token);
    directory = { [caller.id]: caller, [peer.id]: peer };
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(caller);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => directory[id] ?? null);
    vi.spyOn(participantBlockRepository, 'findBlockState').mockResolvedValue({ blockedByMe: false, blockedByThem: false });
    vi.spyOn(directMessageRepository, 'findOrCreateThread').mockResolvedValue({ thread, created: true });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({ handle: 'pat', email: 'leak@example.com' } as never);
  });

  const open = (body: unknown = { participantId: peer.id }) => request(app).post(URL).set(auth).send(body as object);

  describe('access', () => {
    it('401 for Visitors', async () => {
      expect((await request(app).post(URL).send({ participantId: peer.id })).status).toBe(401);
      expect(directMessageRepository.findOrCreateThread).not.toHaveBeenCalled();
    });

    it('403 for unverified and suspended callers', async () => {
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue({ ...caller, is_verified: false });
      expect((await open()).status).toBe(403);
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue({ ...caller, is_suspended: true });
      expect((await open()).status).toBe(403);
      expect(directMessageRepository.findOrCreateThread).not.toHaveBeenCalled();
    });

    it('403 for an ADMIN caller', async () => {
      mockVerifyIdToken.mockResolvedValue({ ...token, role: 'ADMIN' });
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue({ ...caller, role: 'ADMIN' });
      expect((await open()).status).toBe(403);
      expect(directMessageRepository.findOrCreateThread).not.toHaveBeenCalled();
    });
  });

  describe('open or continue', () => {
    it('creates the thread (201) with a safe projection: peer id and handle only', async () => {
      const res = await open();
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.thread).toEqual({
        id: THREAD_ID,
        peer: { id: peer.id, handle: 'pat' },
        lastMessageAt: thread.last_message_at,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/leak@example\.com|caller@example\.com|peer@example\.com|Peer Person|firebase_uid|fb-peer/);
    });

    it('carries the direct-message privacy flags and no private key anywhere in the response (#390)', async () => {
      vi.mocked(profileRepository.findProfileByParticipantId).mockResolvedValue({
        handle: 'pat',
        email: 'leak@example.com',
        presence_status: 'Invisible',
        shared_contact_handle: '@secret',
        institution: 'Secret U',
      } as never);
      const res = await open();
      expect(res.body.privacy).toMatchObject({
        credentialsIncluded: false,
        otpsIncluded: false,
        emailsIncluded: false,
        presenceIncluded: false,
        contactDetailsIncluded: false,
      });
      expect(directMessagePayloadHasPrivateKey({ ...res.body, privacy: undefined })).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/leak@example\.com|Invisible|@secret|Secret U|participant_low_id|participant_high_id/);
    });

    it('returns the existing thread (200) on a repeat call, same thread id', async () => {
      const first = await open();
      vi.mocked(directMessageRepository.findOrCreateThread).mockResolvedValue({ thread, created: false });
      const second = await open();
      expect(first.body.thread.id).toBe(second.body.thread.id);
      expect(second.status).toBe(200);
    });

    it('addresses the SAME canonical pair whichever side opens it', async () => {
      await open();
      // Now the peer (higher id) opens a thread with the caller.
      mockVerifyIdToken.mockResolvedValue({ ...token, uid: 'fb-peer' });
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(peer);
      const res = await request(app).post(URL).set(auth).send({ participantId: caller.id });
      expect(res.status).toBe(201);
      const calls = vi.mocked(directMessageRepository.findOrCreateThread).mock.calls;
      expect(calls[0]).toEqual(calls[1]);
      expect(calls[0]).toEqual([caller.id, peer.id]);
      expect(res.body.thread.peer.id).toBe(caller.id); // each side sees the OTHER person
    });

    it('lower-cased/upper-cased ids resolve to the same pair', async () => {
      await open({ participantId: peer.id.toUpperCase() });
      expect(directMessageRepository.findOrCreateThread).toHaveBeenCalledWith(caller.id, peer.id);
    });

    it('takes the caller from the session, never from the body', async () => {
      const res = await open({ participantId: peer.id, callerId: 'x', participant: 'y' });
      expect(res.status).toBe(400);
      expect(directMessageRepository.findOrCreateThread).not.toHaveBeenCalled();
    });
  });

  describe('no enumeration of accounts or other private threads', () => {
    const unavailable = {
      'a peer that does not exist': () => { directory[peer.id] = null; },
      'a suspended peer': () => { directory[peer.id] = { ...peer, is_suspended: true }; },
      'a deactivated peer': () => { directory[peer.id] = { ...peer, is_deactivated: true }; },
      'an unverified peer': () => { directory[peer.id] = { ...peer, is_verified: false }; },
      'an ADMIN peer': () => { directory[peer.id] = { ...peer, role: 'ADMIN' }; },
    } as const;

    it.each(Object.entries(unavailable))('answers %s with the SAME 404 and creates nothing', async (_label, arrange) => {
      arrange();
      const res = await open();
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: 'That participant is not available for direct messages.',
        code: 'PEER_NOT_AVAILABLE',
      });
      expect(directMessageRepository.findOrCreateThread).not.toHaveBeenCalled();
    });

    it.each([
      ['the caller has blocked the peer', { blockedByMe: true, blockedByThem: false }],
      ['the peer has blocked the caller', { blockedByMe: false, blockedByThem: true }],
      ['both have blocked each other', { blockedByMe: true, blockedByThem: true }],
    ])('answers a block (%s) with the SAME 404 as any unavailable peer and creates nothing', async (_label, state) => {
      vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue(state);
      const res = await open();
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: 'That participant is not available for direct messages.',
        code: 'PEER_NOT_AVAILABLE',
      });
      expect(directMessageRepository.findOrCreateThread).not.toHaveBeenCalled();
    });

    it('does not tell an existing-thread peer from a never-messaged peer beyond the caller\'s own thread', async () => {
      // The only lookup key contains the caller, so a third party can never be probed.
      await open();
      const [low, high] = vi.mocked(directMessageRepository.findOrCreateThread).mock.calls[0];
      expect([low, high]).toContain(caller.id);
    });

    it('a peer who has a thread with someone ELSE gets the same response as any other peer', async () => {
      // The repository is keyed by (caller, peer); an unrelated thread between peer and a third
      // person is not consulted at all, so the response is identical in shape.
      const res = await open();
      expect(Object.keys(res.body).sort()).toEqual(['privacy', 'status', 'thread']);
      expect(Object.keys(res.body.thread).sort()).toEqual(['createdAt', 'id', 'lastMessageAt', 'peer', 'updatedAt']);
    });
  });

  describe('validation', () => {
    it('400 CANNOT_MESSAGE_SELF', async () => {
      const res = await open({ participantId: caller.id });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CANNOT_MESSAGE_SELF');
      expect(directMessageRepository.findOrCreateThread).not.toHaveBeenCalled();
    });

    it.each([
      ['missing participantId', {}],
      ['empty participantId', { participantId: '  ' }],
      ['non-uuid participantId', { participantId: 'not-a-uuid' }],
      ['numeric participantId', { participantId: 12 }],
      ['array participantId', { participantId: [peer.id] }],
      ['unknown field', { participantId: peer.id, extra: 1 }],
    ])('400 VALIDATION_ERROR for %s, with no thread created', async (_label, body) => {
      const res = await open(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toBeDefined();
      expect(directMessageRepository.findOrCreateThread).not.toHaveBeenCalled();
    });

    it('echoes the rejected draft with private keys redacted, never in the clear', async () => {
      const res = await open({ participantId: 'nope', email: 'me@example.com', password: 'pw', presence_status: 'Online' });
      expect(res.status).toBe(400);
      expect(res.body.submitted).toEqual({ participantId: 'nope', email: '[redacted]', password: '[redacted]', presence_status: '[redacted]' });
      expect(JSON.stringify(res.body)).not.toMatch(/me@example\.com|"pw"|Online/);
    });

    it('400 when the body is not a JSON object', async () => {
      const res = await request(app).post(URL).set(auth).send([1, 2]);
      expect(res.status).toBe(400);
    });
  });

  it('does not hide storage failures as a 404', async () => {
    vi.mocked(directMessageRepository.findOrCreateThread).mockRejectedValue(new Error('db down'));
    expect((await open()).status).toBeGreaterThanOrEqual(500);
  });
});

describe('DM inbox, thread, and send-message endpoints (US-032 / #387 / FR-089, FR-091)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(token);
    directory = { [caller.id]: caller, [peer.id]: peer, [outsider.id]: outsider };
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(caller);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => directory[id] ?? null);
    vi.spyOn(directMessageRepository, 'findThreadById').mockResolvedValue(thread);
    vi.spyOn(directMessageRepository, 'listThreadsForParticipant').mockResolvedValue([thread]);
    vi.spyOn(directMessageRepository, 'findLatestMessagesForThreads').mockResolvedValue(
      new Map([[THREAD_ID, message]])
    );
    vi.spyOn(directMessageRepository, 'listMessagesByThread').mockResolvedValue([message]);
    vi.spyOn(directMessageRepository, 'createMessage').mockResolvedValue(message);
    vi.spyOn(directMessageRepository, 'isParticipantPairBlocked').mockResolvedValue(false);
    vi.spyOn(participantBlockRepository, 'findBlockState').mockResolvedValue({
      blockedByMe: false,
      blockedByThem: false,
    });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockImplementation(
      async (id: string) => {
        if (id === caller.id) return { handle: 'caller_handle', email: 'caller@example.com' } as never;
        if (id === peer.id) return { handle: 'peer_handle', email: 'peer@example.com' } as never;
        return null;
      }
    );
  });

  describe('GET /api/direct-messages/threads (Inbox)', () => {
    it('lists inbox threads with safe peer handle and UTC timestamps', async () => {
      const res = await request(app).get('/api/direct-messages/threads').set(auth);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.isEmpty).toBe(false);
      expect(res.body.threads).toHaveLength(1);
      expect(res.body.threads[0]).toMatchObject({
        id: THREAD_ID,
        peer: { id: peer.id, handle: 'peer_handle' },
      });
      expect(res.body.threads[0].lastMessage).toMatchObject({
        id: message.id,
        body: 'Hello direct message',
        // The caller wrote this message, so it carries the CALLER's handle and fromMe (not the peer's).
        authorHandle: 'caller_handle',
        fromMe: true,
      });
      expect(publicPayloadHasPrivateChatKey(res.body)).toBe(false);
    });

    it('returns explicit empty inbox state when user has no threads', async () => {
      vi.mocked(directMessageRepository.listThreadsForParticipant).mockResolvedValue([]);
      const res = await request(app).get('/api/direct-messages/threads').set(auth);
      expect(res.status).toBe(200);
      expect(res.body.threads).toEqual([]);
      expect(res.body.isEmpty).toBe(true);
    });
  });

  describe('GET /api/direct-messages/threads/:threadId & /messages', () => {
    it('rejects malformed thread UUID with 400 VALIDATION_ERROR before database check', async () => {
      const res = await request(app).get('/api/direct-messages/threads/not-a-uuid').set(auth);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(directMessageRepository.findThreadById).not.toHaveBeenCalled();
    });

    it('returns thread detail and chronological messages with safe handle', async () => {
      const res = await request(app).get(`/api/direct-messages/threads/${THREAD_ID}`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.isEmpty).toBe(false);
      expect(res.body.thread.peer.handle).toBe('peer_handle');
      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0]).toMatchObject({
        id: message.id,
        body: 'Hello direct message',
        authorHandle: 'caller_handle',
      });
      expect(publicPayloadHasPrivateChatKey(res.body)).toBe(false);
    });

    it('denies third-party outsider with 403 FORBIDDEN_NOT_THREAD_PARTICIPANT without leaking message contents', async () => {
      mockVerifyIdToken.mockResolvedValue({ ...token, uid: 'fb-outsider' });
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(outsider);

      const res = await request(app).get(`/api/direct-messages/threads/${THREAD_ID}/messages`).set(auth);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_THREAD_PARTICIPANT');
      expect(JSON.stringify(res.body)).not.toContain('Hello direct message');
    });

    it('returns identical 403 FORBIDDEN_NOT_THREAD_PARTICIPANT for a non-existent thread', async () => {
      vi.mocked(directMessageRepository.findThreadById).mockResolvedValue(null);
      const res = await request(app).get(`/api/direct-messages/threads/${THREAD_ID}/messages`).set(auth);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_THREAD_PARTICIPANT');
    });
  });

  describe('POST /api/direct-messages/threads/:threadId/messages', () => {
    it('sends message successfully (201) with author handle and UTC timestamp', async () => {
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({ body: '  Hello direct message  ' });

      expect(res.status).toBe(201);
      expect(directMessageRepository.createMessage).toHaveBeenCalledWith({
        thread_id: THREAD_ID,
        author_id: caller.id,
        body: 'Hello direct message',
      });
      expect(res.body.message.authorHandle).toBe('caller_handle');
      expect(publicPayloadHasPrivateChatKey(res.body)).toBe(false);
    });

    it('rejects blank body with 400 and preserves draft in submitted echo (NR-017)', async () => {
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({ body: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.body).toBe('body is required.');
      expect(res.body.submitted).toEqual({ body: '   ' });
      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });

    it('rejects over-long body and redacts sensitive credentials from submitted echo (FR-089)', async () => {
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({
          body: 'x'.repeat(4001),
          password: 'SecretPassword123!',
          otp: '123456',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.body).toContain('4000');
      expect(res.body.submitted).toMatchObject({
        password: '[redacted]',
        otp: '[redacted]',
      });
      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });

    it('denies sending to a suspended peer with 403 DM_PEER_UNAVAILABLE', async () => {
      directory[peer.id] = { ...peer, is_suspended: true };
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DM_PEER_UNAVAILABLE');
      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });

    it('denies sending to an unverified peer with 403 DM_PEER_UNAVAILABLE', async () => {
      directory[peer.id] = { ...peer, is_verified: false };
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DM_PEER_UNAVAILABLE');
      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });

    it('denies sending when peer blocked caller with 403 DM_PEER_UNAVAILABLE', async () => {
      vi.spyOn(participantBlockRepository, 'findBlockState').mockResolvedValue({
        blockedByMe: false,
        blockedByThem: true,
      });
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DM_PEER_UNAVAILABLE');
      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });

    it('denies sending when caller blocked peer with 403 DM_BLOCKED_BY_YOU', async () => {
      vi.spyOn(participantBlockRepository, 'findBlockState').mockResolvedValue({
        blockedByMe: true,
        blockedByThem: false,
      });
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DM_BLOCKED_BY_YOU');
      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });
  });

  describe('privacy projections on every DM response (US-032 / #390 / FR-089, FR-091)', () => {
    const SENSITIVE = /caller@example\.com|peer@example\.com|firebase_uid|fb-|participant_low_id|participant_high_id|presence|Invisible/i;

    beforeEach(() => {
      vi.mocked(profileRepository.findProfileByParticipantId).mockImplementation(
        async (id: string) =>
          ({
            handle: id === caller.id ? 'caller_handle' : 'peer_handle',
            email: id === caller.id ? 'caller@example.com' : 'peer@example.com',
            presence_status: 'Invisible',
            shared_contact_handle: '@secret',
            institution: 'Secret U',
          }) as never
      );
    });

    const contract = (body: unknown) => {
      // The privacy flags legitimately name "presence"; check everything else.
      const text = JSON.stringify({ ...(body as object), privacy: undefined });
      expect(text).not.toMatch(SENSITIVE);
      expect(text).not.toMatch(/@secret|Secret U/);
      expect(directMessagePayloadHasPrivateKey({ ...(body as object), privacy: undefined })).toBe(false);
      expect((body as { privacy: Record<string, unknown> }).privacy).toMatchObject({
        credentialsIncluded: false,
        otpsIncluded: false,
        emailsIncluded: false,
        presenceIncluded: false,
        contactDetailsIncluded: false,
      });
    };

    it('inbox: no private keys, no account ids of authors, privacy flags present', async () => {
      const res = await request(app).get('/api/direct-messages/threads').set(auth);
      contract(res.body);
      expect(res.body.threads[0].lastMessage).not.toHaveProperty('authorId');
    });

    it('thread detail: messages show handle and fromMe, never the author account id', async () => {
      const res = await request(app).get(`/api/direct-messages/threads/${THREAD_ID}`).set(auth);
      expect(res.status).toBe(200);
      contract(res.body);
      expect(Object.keys(res.body.messages[0]).sort()).toEqual(['authorHandle', 'body', 'createdAt', 'fromMe', 'id', 'threadId']);
      expect(JSON.stringify(res.body.messages)).not.toContain(caller.id);
    });

    it('messages list: same projection', async () => {
      const res = await request(app).get(`/api/direct-messages/threads/${THREAD_ID}/messages`).set(auth);
      expect(res.status).toBe(200);
      contract(res.body);
      expect(res.body.messages[0]).toMatchObject({ fromMe: true, authorHandle: 'caller_handle' });
    });

    it('send: the created message is projected the same way', async () => {
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({ body: 'Hello direct message' });
      expect(res.status).toBe(201);
      contract(res.body);
      expect(res.body.message).toMatchObject({ fromMe: true, authorHandle: 'caller_handle', body: 'Hello direct message' });
      expect(res.body.message).not.toHaveProperty('authorId');
    });

    it('seen from the other participant, the same message is fromMe:false with the author handle', async () => {
      mockVerifyIdToken.mockResolvedValue({ ...token, uid: 'fb-peer' });
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(peer);
      const res = await request(app).get(`/api/direct-messages/threads/${THREAD_ID}/messages`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.messages[0]).toMatchObject({ fromMe: false, authorHandle: 'caller_handle' });
    });

    it('a rejected message draft is echoed with private keys redacted', async () => {
      const res = await request(app)
        .post(`/api/direct-messages/threads/${THREAD_ID}/messages`)
        .set(auth)
        .send({ body: '   ', email: 'me@example.com', presence_status: 'Online' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/me@example\.com|Online/);
    });
  });
});

describe('block and unblock a participant (#433 / US-032 / FR-091)', () => {
  const BLOCKS = `/api/direct-messages/blocks/${peer.id}`;
  /** Blocks currently stored: "blocker>blocked". */
  let blocks: Set<string>;

  const as = (who: Participant): void => {
    mockVerifyIdToken.mockResolvedValue({ ...token, uid: who.firebase_uid });
    vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(who);
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    blocks = new Set();
    mockVerifyIdToken.mockResolvedValue(token);
    directory = { [caller.id]: caller, [peer.id]: peer };
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(caller);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => directory[id] ?? null);
    // A small in-memory stand-in for the block table, so a block set by one request affects the next.
    vi.spyOn(participantBlockRepository, 'addBlock').mockImplementation(async (a: string, b: string) => {
      blocks.add(`${a}>${b}`);
    });
    vi.spyOn(participantBlockRepository, 'removeBlock').mockImplementation(async (a: string, b: string) => {
      blocks.delete(`${a}>${b}`);
    });
    vi.spyOn(participantBlockRepository, 'findBlockState').mockImplementation(async (a: string, b: string) => ({
      blockedByMe: blocks.has(`${a}>${b}`),
      blockedByThem: blocks.has(`${b}>${a}`),
    }));
    vi.spyOn(directMessageRepository, 'isParticipantPairBlocked').mockImplementation(async (a: string, b: string) =>
      blocks.has(`${a}>${b}`) || blocks.has(`${b}>${a}`)
    );
    vi.spyOn(directMessageRepository, 'findThreadById').mockResolvedValue(thread);
    vi.spyOn(directMessageRepository, 'listMessagesByThread').mockResolvedValue([]);
    vi.spyOn(directMessageRepository, 'createMessage').mockResolvedValue(message);
    vi.spyOn(directMessageRepository, 'findOrCreateThread').mockResolvedValue({ thread, created: true });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({ handle: 'pat' } as never);
  });

  const block = () => request(app).put(BLOCKS).set(auth);
  const unblock = () => request(app).delete(BLOCKS).set(auth);
  const send = () => request(app).post(`/api/direct-messages/threads/${THREAD_ID}/messages`).set(auth).send({ body: 'hi' });
  const detail = () => request(app).get(`/api/direct-messages/threads/${THREAD_ID}`).set(auth);

  describe('access', () => {
    it('401 for Visitors on both routes', async () => {
      expect((await request(app).put(BLOCKS)).status).toBe(401);
      expect((await request(app).delete(BLOCKS)).status).toBe(401);
      expect(participantBlockRepository.addBlock).not.toHaveBeenCalled();
      expect(participantBlockRepository.removeBlock).not.toHaveBeenCalled();
    });

    it('403 for unverified, suspended and ADMIN callers', async () => {
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue({ ...caller, is_verified: false });
      expect((await block()).status).toBe(403);
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue({ ...caller, is_suspended: true });
      expect((await unblock()).status).toBe(403);
      mockVerifyIdToken.mockResolvedValue({ ...token, role: 'ADMIN' });
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue({ ...caller, role: 'ADMIN' });
      expect((await block()).status).toBe(403);
      expect(participantBlockRepository.addBlock).not.toHaveBeenCalled();
    });

    it('400 for a malformed participant id on both routes, before any lookup', async () => {
      for (const res of [
        await request(app).put('/api/direct-messages/blocks/not-a-uuid').set(auth),
        await request(app).delete('/api/direct-messages/blocks/not-a-uuid').set(auth),
      ]) {
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.errors.participantId).toBeDefined();
      }
      expect(participantsRepository.findById).not.toHaveBeenCalledWith('not-a-uuid');
      expect(participantBlockRepository.addBlock).not.toHaveBeenCalled();
    });
  });

  describe('blocking', () => {
    it('blocks the participant and reports only the caller\'s own block', async () => {
      const res = await block();
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.status).toBe('ok');
      expect(res.body.youBlockedPeer).toBe(true);
      expect(participantBlockRepository.addBlock).toHaveBeenCalledWith(caller.id, peer.id);
      expect(res.body.privacy).toMatchObject({ credentialsIncluded: false, emailsIncluded: false });
    });

    it('is idempotent: blocking again gives the same answer and keeps one block', async () => {
      await block();
      const again = await block();
      expect(again.status).toBe(200);
      expect(again.body.youBlockedPeer).toBe(true);
      expect(blocks.size).toBe(1);
    });

    it('cannot block yourself', async () => {
      const res = await request(app).put(`/api/direct-messages/blocks/${caller.id}`).set(auth);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CANNOT_BLOCK_SELF');
      expect(participantBlockRepository.addBlock).not.toHaveBeenCalled();
    });

    it.each([
      ['a participant that does not exist', () => { directory[peer.id] = null; }],
      ['an administrator', () => { directory[peer.id] = { ...peer, role: 'ADMIN' }; }],
    ])('gives the same 404 for %s', async (_label, arrange) => {
      arrange();
      const res = await block();
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'That participant is not available.', code: 'PEER_NOT_AVAILABLE' });
      expect(participantBlockRepository.addBlock).not.toHaveBeenCalled();
    });

    it('the response contains no emails, names or internal ids', async () => {
      const res = await block();
      expect(JSON.stringify({ ...res.body, privacy: undefined })).not.toMatch(/@example\.com|fb-|firebase|full_name/i);
      expect(directMessagePayloadHasPrivateKey({ ...res.body, privacy: undefined })).toBe(false);
    });

    it('does not hide storage failures as a 404', async () => {
      vi.mocked(participantBlockRepository.addBlock).mockRejectedValue(new Error('db down'));
      expect((await block()).status).toBeGreaterThanOrEqual(500);
    });
  });

  describe('unblocking', () => {
    it('removes the block and reports it is gone', async () => {
      await block();
      const res = await unblock();
      expect(res.status).toBe(200);
      expect(res.body.youBlockedPeer).toBe(false);
      expect(blocks.size).toBe(0);
      expect(participantBlockRepository.removeBlock).toHaveBeenCalledWith(caller.id, peer.id);
    });

    it('gives the same answer when there was no block, or no such participant, so nothing can be probed', async () => {
      const none = await unblock();
      directory[peer.id] = null;
      const missing = await unblock();
      const unknown = await request(app).delete('/api/direct-messages/blocks/99999999-9999-4999-8999-999999999999').set(auth);
      for (const res of [none, missing, unknown]) {
        expect(res.status).toBe(200);
        expect(res.body.youBlockedPeer).toBe(false);
      }
    });

    it('only removes the caller\'s OWN block, never one the other person set', async () => {
      blocks.add(`${peer.id}>${caller.id}`); // the peer blocked the caller
      await unblock();
      expect(blocks.has(`${peer.id}>${caller.id}`)).toBe(true);
    });
  });

  describe('what a block does to messaging (acceptance)', () => {
    it('after blocking, the blocker is told and the blocked person gets the neutral refusal', async () => {
      await block();

      const blockerSend = await send();
      expect(blockerSend.status).toBe(403);
      expect(blockerSend.body.code).toBe('DM_BLOCKED_BY_YOU');
      expect(blockerSend.body.error).toMatch(/you have blocked this participant/i);

      as(peer);
      const blockedSend = await send();
      expect(blockedSend.status).toBe(403);
      expect(blockedSend.body.code).toBe('DM_PEER_UNAVAILABLE');
      expect(JSON.stringify(blockedSend.body)).not.toMatch(/block/i);
      expect(directMessageRepository.createMessage).not.toHaveBeenCalled();
    });

    it('opening a conversation with someone who has a block either way gives the usual 404', async () => {
      await block();
      const fromBlocker = await request(app).post(URL).set(auth).send({ participantId: peer.id });
      expect(fromBlocker.status).toBe(404);
      expect(fromBlocker.body.code).toBe('PEER_NOT_AVAILABLE');

      as(peer);
      const fromBlocked = await request(app).post(URL).set(auth).send({ participantId: caller.id });
      expect(fromBlocked.status).toBe(404);
      expect(fromBlocked.body).toEqual(fromBlocker.body);
    });

    it('unblocking restores sending for both people', async () => {
      await block();
      await unblock();

      const first = await send();
      expect(first.status).toBe(201);
      as(peer);
      const second = await send();
      expect(second.status).toBe(201);
    });

    it('the conversation view tells ONLY the blocker, and never reveals the other person\'s block', async () => {
      await block();
      const blockerView = await detail();
      expect(blockerView.status).toBe(200);
      expect(blockerView.body.thread.youBlockedPeer).toBe(true);

      as(peer);
      const blockedView = await detail();
      expect(blockedView.status).toBe(200);
      expect(blockedView.body.thread.youBlockedPeer).toBe(false);
      expect(JSON.stringify(blockedView.body)).not.toMatch(/blockedBy|blocker|"blocked"/i);
    });

    it('reading an existing conversation still works for both people while blocked', async () => {
      await block();
      expect((await detail()).status).toBe(200);
      as(peer);
      expect((await detail()).status).toBe(200);
    });

    it('after unblocking, the conversation view no longer says you blocked them', async () => {
      await block();
      await unblock();
      expect((await detail()).body.thread.youBlockedPeer).toBe(false);
    });
  });
});
