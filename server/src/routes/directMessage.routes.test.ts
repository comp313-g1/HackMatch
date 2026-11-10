import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { directMessageRepository } from '../db/directMessage.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
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
const peer: Participant = { ...base, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', firebase_uid: 'fb-peer', email: 'peer@example.com', full_name: 'Peer Person' };

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

/** Lookup table used for both the auth middleware (caller) and the peer check. */
let directory: Record<string, Participant | null>;

describe('POST /api/direct-messages/threads (US-032 / #386 / FR-091)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(token);
    directory = { [caller.id]: caller, [peer.id]: peer };
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(caller);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => directory[id] ?? null);
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
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/leak@example\.com|caller@example\.com|peer@example\.com|Peer Person|firebase_uid|fb-peer/);
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
      expect(Object.keys(res.body.thread).sort()).toEqual(['createdAt', 'id', 'peer', 'updatedAt']);
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
