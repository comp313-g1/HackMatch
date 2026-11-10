import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { chatRepository } from '../db/chat.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import { publicPayloadHasPrivateChatKey } from '../services/chatPrivacy.js';
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

    it('creates the channel on first open when the team has none yet (#431), then opens it', async () => {
      // Looked up twice while empty (the route, then inside provisioning), then the channel exists.
      vi.mocked(chatRepository.findChannelByTeamId)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(channel);
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue({
        id: TEAM_ID,
        name: 'Alpha Squad',
        owner_participant_id: member.id,
        recruitment_status: 'Open',
        disbanded_at: null,
      } as never);
      vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockResolvedValue({ channel, created: true });

      const res = await request(app).get(BASE).set(auth);

      expect(res.status).toBe(200);
      expect(res.body.channel).toMatchObject({ id: CHANNEL_ID, teamId: TEAM_ID });
      expect(chatRepository.provisionOrLinkTeamChannel).toHaveBeenCalledTimes(1);
      expect(chatRepository.provisionOrLinkTeamChannel).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: TEAM_ID, created_by: member.id })
      );
    });

    it('404 TEAM_CHANNEL_NOT_FOUND when the team has no channel and cannot get one (disbanded)', async () => {
      vi.mocked(chatRepository.findChannelByTeamId).mockResolvedValue(null);
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue({
        id: TEAM_ID,
        name: 'Alpha Squad',
        owner_participant_id: member.id,
        recruitment_status: 'Disbanded',
        disbanded_at: '2026-11-01T00:00:00.000Z',
      } as never);
      const provision = vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel');

      const res = await request(app).get(BASE).set(auth);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TEAM_CHANNEL_NOT_FOUND');
      expect(provision).not.toHaveBeenCalled();
    });

    it('a non-member never causes a channel to be created', async () => {
      vi.mocked(teamsRepository.findConfirmedTeamIdsForParticipant).mockResolvedValue([OTHER_TEAM_ID]);
      vi.mocked(chatRepository.findChannelByTeamId).mockResolvedValue(null);
      const provision = vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel');

      const res = await request(app).get(BASE).set(auth);

      expect(res.status).toBe(403);
      expect(provision).not.toHaveBeenCalled();
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

    it.each([
      ['TEAM_CHANNEL_READ_ONLY', 'TEAM_CHANNEL_READ_ONLY'],
      ['TEAM_CHANNEL_NOT_A_MEMBER', 'FORBIDDEN_NOT_TEAM_MEMBER'],
      ['TEAM_CHANNEL_ACCOUNT_SUSPENDED', 'ACCOUNT_SUSPENDED'],
    ])('turns the database lifecycle guard %s into a 403 (%s) when state changes after the gate', async (dbCode, apiCode) => {
      vi.mocked(chatRepository.createMessage).mockRejectedValue(new Error(dbCode));
      const res = await request(app).post(`${BASE}/messages`).set(auth).send({ body: 'late' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(apiCode);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toContain('late');
    });

    it('does not hide unrelated storage failures as 403', async () => {
      vi.mocked(chatRepository.createMessage).mockRejectedValue(new Error('connection reset'));
      const res = await request(app).post(`${BASE}/messages`).set(auth).send({ body: 'x' });
      expect(res.status).toBeGreaterThanOrEqual(500);
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

  describe('stale membership, account state, validation redaction, and message-field privacy (US-031 / #384)', () => {
    it.each(['Removed', 'Released'] as const)(
      'denies a former member whose membership transitioned to %s on read and write while preserving history for active teammates',
      async (_staleStatus) => {
        const formerMember: Participant = {
          ...member,
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          firebase_uid: 'fb-former',
          email: 'former@example.com',
        };
        const historicalMsg: ChatMessage = {
          id: '55555555-5555-4555-8555-555555555555',
          channel_id: CHANNEL_ID,
          author_id: formerMember.id,
          body: 'Earlier contribution before leaving',
          created_at: '2026-10-21T00:30:00.000Z',
        };

        // 1. Active confirmed member can still read the former member's historical message
        vi.mocked(chatRepository.listMessagesByChannel).mockResolvedValue([historicalMsg, message]);
        const activeRead = await request(app).get(`${BASE}/messages`).set(auth);
        expect(activeRead.status).toBe(200);
        expect(activeRead.body.messages.map((m: { body: string }) => m.body)).toEqual([
          'Earlier contribution before leaving',
          'secret plan',
        ]);

        // 2. Former member (no longer in Confirmed list) is denied on GET /chat, GET /messages, and POST /messages
        mockVerifyIdToken.mockResolvedValue({ ...token, uid: formerMember.firebase_uid });
        vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(formerMember);
        vi.mocked(participantsRepository.findById).mockResolvedValue(formerMember);
        vi.mocked(teamsRepository.findConfirmedTeamIdsForParticipant).mockResolvedValue([]);
        vi.mocked(chatRepository.findChannelByTeamId).mockClear();
        vi.mocked(chatRepository.listMessagesByChannel).mockClear();
        vi.mocked(chatRepository.createMessage).mockClear();

        for (const res of [
          await request(app).get(BASE).set(auth),
          await request(app).get(`${BASE}/messages`).set(auth),
          await request(app).post(`${BASE}/messages`).set(auth).send({ body: 'try post after removal' }),
        ]) {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_MEMBER');
          expect(JSON.stringify(res.body)).not.toContain('Earlier contribution');
          expect(JSON.stringify(res.body)).not.toContain('secret plan');
        }
        expect(chatRepository.findChannelByTeamId).not.toHaveBeenCalled();
        expect(chatRepository.listMessagesByChannel).not.toHaveBeenCalled();
        expect(chatRepository.createMessage).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['unverified PART', { is_verified: false }, 'EMAIL_NOT_VERIFIED'],
      ['suspended PART', { is_suspended: true }, 'ACCOUNT_SUSPENDED'],
      ['deactivated PART', { is_deactivated: true, is_suspended: true }, 'ACCOUNT_SUSPENDED'],
    ] as const)('denies %s with 403 (%s) before checking team membership or messages', async (_label, patch, expectedCode) => {
      const blocked: Participant = { ...member, ...patch };
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(blocked);
      vi.mocked(participantsRepository.findById).mockResolvedValue(blocked);

      const res = await request(app).get(`${BASE}/messages`).set(auth);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(expectedCode);
      expect(teamsRepository.findConfirmedTeamIdsForParticipant).not.toHaveBeenCalled();
      expect(chatRepository.listMessagesByChannel).not.toHaveBeenCalled();
    });

    it('denies missing MFA claim with 403 MFA_REQUIRED before checking membership', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-member',
        email: 'member@example.com',
        role: 'PART',
        auth_time: AUTH_TIME,
      } as unknown as DecodedIdToken);

      const res = await request(app).get(BASE).set(auth);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
      expect(teamsRepository.findConfirmedTeamIdsForParticipant).not.toHaveBeenCalled();
    });

    it('redacts sensitive fields in validation error submitted echo and preserves message draft (FR-089 / NR-017)', async () => {
      const res = await request(app).post(`${BASE}/messages`).set(auth).send({
        body: '   ',
        email: 'member@example.com',
        password: 'SecretPassword!',
        otp: '654321',
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.submitted).toMatchObject({
        body: '   ',
        email: '[redacted]',
        password: '[redacted]',
        otp: '[redacted]',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/member@example\.com|SecretPassword!|654321/);
    });

    it('scrubs poisoned repository fields from channel and message responses (FR-089 / FR-090)', async () => {
      vi.mocked(chatRepository.findChannelByTeamId).mockResolvedValue({
        ...channel,
        email: 'owner@example.com',
        password: 'leaked-password',
        otp_hash: 'leaked-otp',
        firebase_uid: 'fb-owner',
        shared_contact_handle: '@private_discord',
        workspace_notes: 'Confidential workspace notes',
      } as never);
      vi.mocked(chatRepository.listMessagesByChannel).mockResolvedValue([
        {
          ...message,
          email: 'member@example.com',
          password: 'leaked-password',
          otp_hash: 'leaked-otp',
          firebase_uid: 'fb-member',
          shared_contact_handle: '@private_discord',
          mfa_secret: 'totp-secret',
        } as never,
      ]);

      const chRes = await request(app).get(BASE).set(auth);
      expect(chRes.status).toBe(200);
      expect(publicPayloadHasPrivateChatKey(chRes.body)).toBe(false);
      expect(chRes.body.privacy).toMatchObject({
        credentialsIncluded: false,
        otpsIncluded: false,
        emailsIncluded: false,
      });

      const msgRes = await request(app).get(`${BASE}/messages`).set(auth);
      expect(msgRes.status).toBe(200);
      expect(publicPayloadHasPrivateChatKey(msgRes.body)).toBe(false);
      expect(JSON.stringify(msgRes.body)).not.toMatch(
        /owner@example\.com|member@example\.com|leaked-password|leaked-otp|fb-owner|fb-member|@private_discord|Confidential workspace notes|totp-secret/
      );
    });
  });
});
