import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { directMessageRepository } from '../db/directMessage.repository.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { requireDirectThreadParticipant, requireDirectThreadSendAccess } from './requireDirectThreadParticipant.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THREAD_ID = '44444444-4444-4444-8444-444444444444';

const person = (id: string, over: Partial<Participant> = {}): Participant => ({
  id,
  firebase_uid: `fb-${id}`,
  email: `${id}@example.com`,
  full_name: 'N',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  created_at: 'c',
  updated_at: 'u',
  ...over,
});
const thread = { id: THREAD_ID, participant_low_id: A, participant_high_id: B, last_message_at: 'c', created_at: 'c', updated_at: 'u' };

let current: Participant | undefined;
function makeApp() {
  const app = express();
  app.use(express.json());
  // Stand-in for the real auth chain: it only has to provide req.participant (or nothing).
  app.use((req, _res, next) => {
    if (current) req.participant = current;
    next();
  });
  app.get('/threads/:threadId/messages', requireDirectThreadParticipant, (_req, res) => {
    res.json({ ok: true, peer: res.locals.directThread.peerId });
  });
  app.post('/threads/:threadId/messages', requireDirectThreadSendAccess, (_req, res) => {
    res.status(201).json({ ok: true });
  });
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'internal' });
  });
  return app;
}

describe('direct thread guards (US-032 / #388 / FR-091)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    current = person(A);
    vi.spyOn(directMessageRepository, 'findThreadById').mockResolvedValue(thread);
    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => (id === B ? person(B) : id === A ? person(A) : null));
    vi.spyOn(participantBlockRepository, 'findBlockState').mockResolvedValue({ blockedByMe: false, blockedByThem: false });
  });

  const read = () => request(makeApp()).get(`/threads/${THREAD_ID}/messages`);
  const send = () => request(makeApp()).post(`/threads/${THREAD_ID}/messages`).send({ body: 'hi' });

  describe('read access: only the two participants', () => {
    it('lets both participants read and tells the handler who the peer is', async () => {
      const a = await read();
      expect(a.status).toBe(200);
      expect(a.body.peer).toBe(B);
      current = person(B);
      expect((await read()).body.peer).toBe(A);
    });

    it('403 for an unrelated participant, identical to a thread that does not exist', async () => {
      current = person(C);
      const unrelated = await read();
      vi.mocked(directMessageRepository.findThreadById).mockResolvedValue(null);
      current = person(A);
      const missing = await read();
      expect(unrelated.status).toBe(403);
      expect(unrelated.body).toEqual(missing.body);
      expect(unrelated.body.code).toBe('FORBIDDEN_NOT_THREAD_PARTICIPANT');
      expect(unrelated.headers['cache-control']).toBe('no-store');
    });

    it('403 for an unverified, suspended or ADMIN caller even if they are in the thread', async () => {
      for (const over of [{ is_verified: false }, { is_suspended: true }, { is_deactivated: true }, { role: 'ADMIN' as const }]) {
        current = person(A, over);
        const res = await read();
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('DM_ACCOUNT_NOT_ELIGIBLE');
      }
    });

    it('403 and no data when there is no participant at all (visitor that slipped past)', async () => {
      current = undefined;
      const res = await read();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DM_ACCOUNT_NOT_ELIGIBLE');
      expect(directMessageRepository.findThreadById).not.toHaveBeenCalled();
    });

    it('400 for a malformed thread id, before any lookup', async () => {
      const res = await request(makeApp()).get('/threads/not-a-uuid/messages');
      expect(res.status).toBe(400);
      expect(directMessageRepository.findThreadById).not.toHaveBeenCalled();
    });

    it('a peer who is blocked or suspended can still be READ from (history stays readable)', async () => {
      vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue({ blockedByMe: true, blockedByThem: true });
      vi.mocked(participantsRepository.findById).mockResolvedValue(person(B, { is_suspended: true }));
      expect((await read()).status).toBe(200);
    });
  });

  describe('send access: participants, eligible peer, no blocks', () => {
    it('allows two eligible, unblocked participants', async () => {
      expect((await send()).status).toBe(201);
    });

    it('403 for an unrelated participant with the same body as a missing thread', async () => {
      current = person(C);
      const res = await send();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_THREAD_PARTICIPANT');
    });

    it.each([
      ['unverified', { is_verified: false }],
      ['suspended', { is_suspended: true }],
      ['deactivated', { is_deactivated: true }],
    ])('403 DM_PEER_UNAVAILABLE when the peer is %s', async (_l, over) => {
      vi.mocked(participantsRepository.findById).mockResolvedValue(person(B, over));
      const res = await send();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DM_PEER_UNAVAILABLE');
    });

    it('403 DM_BLOCKED_BY_YOU when the caller blocked the peer', async () => {
      vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue({ blockedByMe: true, blockedByThem: false });
      const res = await send();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DM_BLOCKED_BY_YOU');
    });

    it('403 DM_PEER_UNAVAILABLE (not a block message) when the peer blocked the caller', async () => {
      vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue({ blockedByMe: false, blockedByThem: true });
      const res = await send();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DM_PEER_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/block/i);
    });

    it('the handler never runs when access is denied', async () => {
      vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue({ blockedByMe: false, blockedByThem: true });
      const res = await send();
      expect(res.body.ok).toBeUndefined();
    });

    it('storage failures are not turned into a denial', async () => {
      vi.mocked(participantBlockRepository.findBlockState).mockRejectedValue(new Error('db down'));
      expect((await send()).status).toBe(500);
    });
  });
});
