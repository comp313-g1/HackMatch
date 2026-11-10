import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { chatRepository } from '../db/chat.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { ChatChannel, ChatMessage, Participant } from '../db/types.js';

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
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_TEAM_ID = '33333333-3333-4333-8333-333333333333';
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const BASE = `/api/teams/${TEAM_ID}/chat`;

describe('Member-gated team channel endpoints (US-031 / #381 / FR-090)', () => {
  const member: Participant = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    firebase_uid: 'fb-member',
    email: 'member@example.com',
    full_name: 'Member',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
  };
  const admin: Participant = { ...member, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', role: 'ADMIN' };

  const token = {
    uid: 'fb-member',
    email: 'member@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const channel: ChatChannel = {
    id: CHANNEL_ID,
    title: 'Team channel',
    description: 'Private',
    created_by: member.id,
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
    channel_type: 'team',
    team_id: TEAM_ID,
  } as ChatChannel;

  const message: ChatMessage = {
    id: '44444444-4444-4444-8444-444444444444',
    channel_id: CHANNEL_ID,
    author_id: member.id,
    body: 'secret plan',
    created_at: '2026-10-21T01:00:00.000Z',
  } as ChatMessage;

  const auth = { Authorization: 'Bearer valid-mfa-token' };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(token);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(member);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(member);
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockResolvedValue([TEAM_ID]);
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(channel);
    vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([message]);
    vi.spyOn(chatRepository, 'createMessage').mockResolvedValue(message);
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      handle: 'alice',
      email: 'leak@example.com',
    } as never);
  });

  describe('denial (no content leaks)', () => {
    it('401 for Visitors on every route', async () => {
      expect((await request(app).get(BASE)).status).toBe(401);
      expect((await request(app).get(`${BASE}/messages`)).status).toBe(401);
      expect((await request(app).post(`${BASE}/messages`).send({ body: 'x' })).status).toBe(401);
    });

    it('403 for a participant who is not a confirmed member, with no channel or message data', async () => {
      vi.mocked(teamsRepository.findConfirmedTeamIdsForParticipant).mockResolvedValue([OTHER_TEAM_ID]);
      for (const res of [
        await request(app).get(BASE).set(auth),
        await request(app).get(`${BASE}/messages`).set(auth),
        await request(app).post(`${BASE}/messages`).set(auth).send({ body: 'hi' }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: 'Only confirmed team members can use this team channel.',
          code: 'FORBIDDEN_NOT_TEAM_MEMBER',
        });
        expect(res.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify(res.body)).not.toContain('secret plan');
      }
      expect(chatRepository.findChannelByTeamId).not.toHaveBeenCalled();
      expect(chatRepository.listMessagesByChannel).not.toHaveBeenCalled();
      expect(chatRepository.createMessage).not.toHaveBeenCalled();
    });

    it('returns the identical 403 whether or not the team/channel exists', async () => {
      vi.mocked(teamsRepository.findConfirmedTeamIdsForParticipant).mockResolvedValue([]);
      vi.mocked(chatRepository.findChannelByTeamId).mockResolvedValue(null);
      const res = await request(app).get(BASE).set(auth);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_MEMBER');
    });

    it('403 for an ADMIN without membership', async () => {
      mockVerifyIdToken.mockResolvedValue({ ...token, role: 'ADMIN' });
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(admin);
      vi.mocked(participantsRepository.findById).mockResolvedValue(admin);
      const res = await request(app).get(`${BASE}/messages`).set(auth);
      expect(res.status).toBe(403);
      expect(chatRepository.listMessagesByChannel).not.toHaveBeenCalled();
    });

    it('does not let membership of another team open this one', async () => {
      vi.mocked(teamsRepository.findConfirmedTeamIdsForParticipant).mockResolvedValue([OTHER_TEAM_ID]);
      const res = await request(app).post(`${BASE}/messages`).set(auth).send({ body: 'hi' });
      expect(res.status).toBe(403);
    });

    it('400 for a malformed team id before any lookup', async () => {
      const res = await request(app).get('/api/teams/not-a-uuid/chat').set(auth);
      expect(res.status).toBe(400);
      expect(teamsRepository.findConfirmedTeamIdsForParticipant).not.toHaveBeenCalled();
    });
  });

  describe('confirmed members', () => {
    it('opens the private channel with a safe projection', async () => {
      const res = await request(app).get(BASE).set(auth);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.channel).toMatchObject({ id: CHANNEL_ID, teamId: TEAM_ID });
      expect(chatRepository.findChannelByTeamId).toHaveBeenCalledWith(TEAM_ID);
    });

    it('404 TEAM_CHANNEL_NOT_FOUND when the team has no channel yet', async () => {
      vi.mocked(chatRepository.findChannelByTeamId).mockResolvedValue(null);
      const res = await request(app).get(BASE).set(auth);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TEAM_CHANNEL_NOT_FOUND');
    });

    it('fails closed if the stored channel is not this team\'s team channel', async () => {
      vi.mocked(chatRepository.findChannelByTeamId).mockResolvedValue({
        ...channel,
        team_id: OTHER_TEAM_ID,
      } as ChatChannel);
      expect((await request(app).get(`${BASE}/messages`).set(auth)).status).toBe(404);
      vi.mocked(chatRepository.findChannelByTeamId).mockResolvedValue({
        ...channel,
        channel_type: 'public',
      } as ChatChannel);
      expect((await request(app).get(`${BASE}/messages`).set(auth)).status).toBe(404);
    });

    it('lists messages with author handle only (no email/firebase fields); empty list is 200', async () => {
      const res = await request(app).get(`${BASE}/messages`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0]).toMatchObject({ authorHandle: 'alice', body: 'secret plan' });
      expect(JSON.stringify(res.body)).not.toMatch(/leak@example\.com|member@example\.com|firebase_uid/i);
      expect(Object.keys(res.body.messages[0]).sort()).toEqual(
        ['authorHandle', 'authorId', 'body', 'channelId', 'createdAt', 'id']
      );

      vi.mocked(chatRepository.listMessagesByChannel).mockResolvedValue([]);
      const empty = await request(app).get(`${BASE}/messages`).set(auth);
      expect(empty.status).toBe(200);
      expect(empty.body.messages).toEqual([]);
    });

    it('sends a message authored by the caller into the team channel only', async () => {
      const spoof = await request(app)
        .post(`${BASE}/messages`)
        .set(auth)
        .send({ body: 'secret plan', author_id: 'x', channel_id: 'y' });
      expect(spoof.status).toBe(400); // client cannot choose author or channel
      expect(chatRepository.createMessage).not.toHaveBeenCalled();

      const res = await request(app).post(`${BASE}/messages`).set(auth).send({ body: 'secret plan' });
      expect(res.status).toBe(201);
      expect(res.body.message.authorHandle).toBe('alice');
      expect(chatRepository.createMessage).toHaveBeenCalledWith({
        channel_id: CHANNEL_ID,
        author_id: member.id,
        body: 'secret plan',
      });
    });

    it('rejects an empty body with 400 and echoes the draft; nothing is stored', async () => {
      const res = await request(app).post(`${BASE}/messages`).set(auth).send({ body: '   ' });
      expect(res.status).toBe(400);
      expect(chatRepository.createMessage).not.toHaveBeenCalled();
    });

    it('rejects an over-long body with 400 and keeps the draft; nothing is stored', async () => {
      const res = await request(app).post(`${BASE}/messages`).set(auth).send({ body: 'a'.repeat(4001) });
      expect(res.status).toBe(400);
      expect(res.body.submitted).toBeDefined();
      expect(chatRepository.createMessage).not.toHaveBeenCalled();
    });
  });

  it('keeps team channels out of the public chat endpoints (US-030 unchanged)', async () => {
    vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(channel);
    const res = await request(app).get(`/api/chat/channels/${CHANNEL_ID}/messages`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CHANNEL_NOT_FOUND');
  });
});
