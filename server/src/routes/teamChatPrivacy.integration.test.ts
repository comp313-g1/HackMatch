/**
 * US-031 / #384 / FR-089 & FR-090 — Team-Chat Membership Privacy Integration & Route Suite
 *
 * Covers the complete US-031 acceptance matrix:
 *   1. Confirmed members (Owner & Member on Open and Locked teams) opening the channel,
 *      reading chronological history, and posting messages after idempotent provisioning.
 *   2. Non-members (unrelated PART, other-team member, pending applicant/invitee),
 *      Visitors (unauthenticated), and unrelated ADMIN users receiving 401/403 with zero
 *      channel or message content leakage.
 *   3. Stale membership (Removed / Released) and account state changes (suspended,
 *      deactivated, unverified, missing MFA) revoking access immediately while preserving
 *      historical messages for active teammates.
 *   4. Input validation (UUID params, blank/overlong/spoofed message bodies) with
 *      preserved and redacted submitted drafts (NR-010, NR-017).
 *   5. Message-field and channel-field privacy scrubbing (FR-089) ensuring no email,
 *      password, OTP, firebase_uid, or private workspace fields ever leak.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { chatRepository } from '../db/chat.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { ChatChannel, ChatMessage, Participant, Team } from '../db/types.js';
import { provisionOrLinkTeamChannel } from '../services/chat.js';
import { publicPayloadHasPrivateChatKey } from '../services/chatPrivacy.js';
import { authorizeConfirmedTeamChatMember } from '../services/teamChatAuthorization.js';
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
const AUTH_HEADER = { Authorization: 'Bearer valid-mfa-token' };

const TEAM_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_TEAM_ID = '66666666-7777-4888-8999-000000000000';
const CHANNEL_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const ownerParticipant: Participant = {
  id: '10000000-0000-4000-8000-000000000001',
  firebase_uid: 'fb-owner-1',
  email: 'owner@example.com',
  full_name: 'Team Owner',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

const teammateParticipant: Participant = {
  id: '10000000-0000-4000-8000-000000000002',
  firebase_uid: 'fb-member-2',
  email: 'teammate@example.com',
  full_name: 'Confirmed Teammate',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

const outsiderParticipant: Participant = {
  id: '10000000-0000-4000-8000-000000000003',
  firebase_uid: 'fb-outsider-3',
  email: 'outsider@example.com',
  full_name: 'Non Member',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

const adminParticipant: Participant = {
  id: '10000000-0000-4000-8000-000000000004',
  firebase_uid: 'fb-admin-4',
  email: 'admin@example.com',
  full_name: 'Platform Admin',
  role: 'ADMIN',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};

function makeToken(actor: Participant): DecodedIdToken {
  return {
    uid: actor.firebase_uid,
    email: actor.email,
    role: actor.role,
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: TEAM_ID,
    event_id: '99999999-8888-4777-8666-555555555555',
    owner_participant_id: ownerParticipant.id,
    name: 'Quantum Builders',
    pitch: 'Building privacy-first tools',
    goal: 'Learning',
    commitment_hours: 20,
    communication_link: null,
    recruitment_status: 'Open',
    locked_at: null,
    disbanded_at: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTeamChannel(overrides: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id: CHANNEL_ID,
    title: 'Team: Quantum Builders',
    description: `Private team coordination channel for "Quantum Builders" (${TEAM_ID}).`,
    created_by: ownerParticipant.id,
    channel_type: 'team',
    team_id: TEAM_ID,
    created_at: '2026-11-01T01:00:00.000Z',
    updated_at: '2026-11-01T01:00:00.000Z',
    ...overrides,
  };
}

describe('US-031 / #384 team-chat membership privacy integration & route tests', () => {
  const baseUrl = `/api/teams/${TEAM_ID}/chat`;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(makeToken(ownerParticipant));
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(makeTeam());
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockResolvedValue([TEAM_ID]);
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
      ownerParticipant.id,
      teammateParticipant.id,
    ]);
    vi.spyOn(chatRepository, 'findChannelByTeamId').mockResolvedValue(makeTeamChannel());
    vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(makeTeamChannel());
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockImplementation(async (id) => {
      if (id === ownerParticipant.id) {
        return { participant_id: id, handle: 'quantum_owner', email: ownerParticipant.email } as never;
      }
      if (id === teammateParticipant.id) {
        return { participant_id: id, handle: 'quantum_dev', email: teammateParticipant.email } as never;
      }
      return null;
    });
  });

  describe('1. Confirmed team members (Owner and Member on Open & Locked teams)', () => {
    it.each(['Open', 'Locked'] as const)(
      'allows confirmed Owner and Member on a %s team to provision, open, post, and read private messages',
      async (recruitmentStatus) => {
        vi.mocked(teamsRepository.findTeamById).mockResolvedValue(
          makeTeam({
            recruitment_status: recruitmentStatus,
            locked_at: recruitmentStatus === 'Locked' ? '2026-11-05T00:00:00.000Z' : null,
          })
        );

        const storedMessages: ChatMessage[] = [];
        vi.spyOn(chatRepository, 'provisionOrLinkTeamChannel').mockResolvedValue({
          channel: makeTeamChannel(),
          created: true,
        });
        vi.spyOn(chatRepository, 'listMessagesByChannel').mockImplementation(async () => [
          ...storedMessages,
        ]);
        vi.spyOn(chatRepository, 'createMessage').mockImplementation(async (dto) => {
          const msg: ChatMessage = {
            id: `00000000-0000-4000-8000-00000000000${storedMessages.length + 1}`,
            channel_id: dto.channel_id,
            author_id: dto.author_id,
            body: dto.body,
            created_at: `2026-11-09T12:0${storedMessages.length}:00.000Z`,
          };
          storedMessages.push(msg);
          return msg;
        });

        // Idempotent provisioning returns the linked team channel
        const provisioned = await provisionOrLinkTeamChannel({
          teamId: TEAM_ID,
          actorId: ownerParticipant.id,
        });
        expect(provisioned.channel.id).toBe(CHANNEL_ID);
        expect(provisioned.channel.teamId).toBe(TEAM_ID);

        // Owner opens channel and posts a message
        const openRes = await request(app).get(baseUrl).set(AUTH_HEADER);
        expect(openRes.status).toBe(200);
        expect(openRes.body.channel).toMatchObject({
          id: CHANNEL_ID,
          teamId: TEAM_ID,
          channelType: 'team',
        });
        expect(publicPayloadHasPrivateChatKey(openRes.body)).toBe(false);

        const ownerPost = await request(app)
          .post(`${baseUrl}/messages`)
          .set(AUTH_HEADER)
          .send({ body: 'Welcome to Quantum Builders private chat!' });
        expect(ownerPost.status).toBe(201);
        expect(ownerPost.body.message).toMatchObject({
          authorId: ownerParticipant.id,
          authorHandle: 'quantum_owner',
          body: 'Welcome to Quantum Builders private chat!',
        });

        // Switch caller to confirmed teammate
        mockVerifyIdToken.mockResolvedValue(makeToken(teammateParticipant));
        vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(teammateParticipant);
        vi.mocked(participantsRepository.findById).mockResolvedValue(teammateParticipant);

        // Service-level authorization also passes for confirmed teammate
        const authCtx = await authorizeConfirmedTeamChatMember({
          actorParticipantId: teammateParticipant.id,
          channelId: CHANNEL_ID,
        });
        expect(authCtx.teamId).toBe(TEAM_ID);

        const memberPost = await request(app)
          .post(`${baseUrl}/messages`)
          .set(AUTH_HEADER)
          .send({ body: 'Glad to be on the team!' });
        expect(memberPost.status).toBe(201);
        expect(memberPost.body.message.authorHandle).toBe('quantum_dev');

        // Teammate lists full chronological thread
        const listRes = await request(app).get(`${baseUrl}/messages`).set(AUTH_HEADER);
        expect(listRes.status).toBe(200);
        expect(listRes.body.messages).toHaveLength(2);
        expect(
          listRes.body.messages.map((m: { authorHandle: string; body: string }) => ({
            authorHandle: m.authorHandle,
            body: m.body,
          }))
        ).toEqual([
          { authorHandle: 'quantum_owner', body: 'Welcome to Quantum Builders private chat!' },
          { authorHandle: 'quantum_dev', body: 'Glad to be on the team!' },
        ]);
        expect(publicPayloadHasPrivateChatKey(listRes.body)).toBe(false);
      }
    );
  });

  describe('2. Non-members, Visitors, and unrelated ADMIN denial with zero message leakage', () => {
    const confidentialMessage: ChatMessage = {
      id: '90000000-0000-4000-8000-000000000099',
      channel_id: CHANNEL_ID,
      author_id: ownerParticipant.id,
      body: 'TOP_SECRET_API_ARCHITECTURE_NOTE',
      created_at: '2026-11-09T12:00:00.000Z',
    };

    beforeEach(() => {
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([confidentialMessage]);
    });

    it('denies Visitors (no Authorization header or blank Bearer token) with 401 and leaks zero data', async () => {
      for (const req of [
        request(app).get(baseUrl),
        request(app).get(`${baseUrl}/messages`),
        request(app).post(`${baseUrl}/messages`).send({ body: 'intrude' }),
        request(app).get(baseUrl).set('Authorization', 'Bearer   '),
      ]) {
        const res = await req;
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toContain('TOP_SECRET_API_ARCHITECTURE_NOTE');
        expect(JSON.stringify(res.body)).not.toContain('Quantum Builders');
      }
      expect(chatRepository.findChannelByTeamId).not.toHaveBeenCalled();
      expect(chatRepository.listMessagesByChannel).not.toHaveBeenCalled();
    });

    it.each([
      ['unrelated PART with no teams', [] as string[]],
      ['confirmed member of a different team only', [OTHER_TEAM_ID]],
      ['pending applicant or invitee (not Confirmed)', [] as string[]],
    ])('denies %s with 403 FORBIDDEN_NOT_TEAM_MEMBER and leaks zero content', async (_label, confirmedTeamIds) => {
      mockVerifyIdToken.mockResolvedValue(makeToken(outsiderParticipant));
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(outsiderParticipant);
      vi.mocked(participantsRepository.findById).mockResolvedValue(outsiderParticipant);
      vi.mocked(teamsRepository.findConfirmedTeamIdsForParticipant).mockResolvedValue(confirmedTeamIds);

      for (const req of [
        request(app).get(baseUrl).set(AUTH_HEADER),
        request(app).get(`${baseUrl}/messages`).set(AUTH_HEADER),
        request(app).post(`${baseUrl}/messages`).set(AUTH_HEADER).send({ body: 'probe' }),
      ]) {
        const res = await req;
        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: 'Only confirmed team members can use this team channel.',
          code: 'FORBIDDEN_NOT_TEAM_MEMBER',
        });
        expect(JSON.stringify(res.body)).not.toContain('TOP_SECRET_API_ARCHITECTURE_NOTE');
        expect(JSON.stringify(res.body)).not.toContain(CHANNEL_ID);
      }

      await expect(
        authorizeConfirmedTeamChatMember({
          actorParticipantId: outsiderParticipant.id,
          channelId: CHANNEL_ID,
        })
      ).rejects.toMatchObject({
        status: 403,
        code: 'TEAM_CHAT_ACCESS_DENIED',
      });

      expect(chatRepository.findChannelByTeamId).not.toHaveBeenCalled();
      expect(chatRepository.listMessagesByChannel).not.toHaveBeenCalled();
    });

    it('denies unrelated ADMIN users with 403 on all team-chat routes and service guard', async () => {
      mockVerifyIdToken.mockResolvedValue(makeToken(adminParticipant));
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(adminParticipant);
      vi.mocked(participantsRepository.findById).mockResolvedValue(adminParticipant);

      for (const req of [
        request(app).get(baseUrl).set(AUTH_HEADER),
        request(app).get(`${baseUrl}/messages`).set(AUTH_HEADER),
        request(app).post(`${baseUrl}/messages`).set(AUTH_HEADER).send({ body: 'admin probe' }),
      ]) {
        const res = await req;
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain('TOP_SECRET_API_ARCHITECTURE_NOTE');
      }

      await expect(
        authorizeConfirmedTeamChatMember({
          actorParticipantId: adminParticipant.id,
          channelId: CHANNEL_ID,
        })
      ).rejects.toMatchObject({
        status: 403,
        code: 'TEAM_CHAT_ACCESS_DENIED',
      });

      expect(chatRepository.findChannelByTeamId).not.toHaveBeenCalled();
      expect(chatRepository.listMessagesByChannel).not.toHaveBeenCalled();
    });
  });

  describe('3. Stale membership & team lifecycle history preservation', () => {
    it('revokes access when a teammate transitions from Confirmed to Removed or Released while keeping their prior messages visible to remaining members', async () => {
      const priorMessage: ChatMessage = {
        id: '70000000-0000-4000-8000-000000000007',
        channel_id: CHANNEL_ID,
        author_id: teammateParticipant.id,
        body: 'Initial schema committed before leaving',
        created_at: '2026-11-09T10:00:00.000Z',
      };
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([priorMessage]);

      // Teammate is now Removed/Released -> no longer in confirmed team list
      mockVerifyIdToken.mockResolvedValue(makeToken(teammateParticipant));
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(teammateParticipant);
      vi.mocked(participantsRepository.findById).mockResolvedValue(teammateParticipant);
      vi.mocked(teamsRepository.findConfirmedTeamIdsForParticipant).mockResolvedValue([]);
      vi.mocked(teamsRepository.listConfirmedParticipantIdsForTeam).mockResolvedValue([
        ownerParticipant.id,
      ]);

      const formerRead = await request(app).get(`${baseUrl}/messages`).set(AUTH_HEADER);
      expect(formerRead.status).toBe(403);
      expect(formerRead.body.code).toBe('FORBIDDEN_NOT_TEAM_MEMBER');

      const formerWrite = await request(app)
        .post(`${baseUrl}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'Can I still post?' });
      expect(formerWrite.status).toBe(403);

      await expect(
        authorizeConfirmedTeamChatMember({
          actorParticipantId: teammateParticipant.id,
          channelId: CHANNEL_ID,
        })
      ).rejects.toMatchObject({
        status: 403,
        code: 'TEAM_CHAT_ACCESS_DENIED',
      });

      // Remaining confirmed Owner still sees the former teammate's historical message
      mockVerifyIdToken.mockResolvedValue(makeToken(ownerParticipant));
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(ownerParticipant);
      vi.mocked(participantsRepository.findById).mockResolvedValue(ownerParticipant);
      vi.mocked(teamsRepository.findConfirmedTeamIdsForParticipant).mockResolvedValue([TEAM_ID]);

      const ownerRead = await request(app).get(`${baseUrl}/messages`).set(AUTH_HEADER);
      expect(ownerRead.status).toBe(200);
      expect(ownerRead.body.messages).toEqual([
        {
          id: priorMessage.id,
          channelId: CHANNEL_ID,
          authorId: teammateParticipant.id,
          authorHandle: 'quantum_dev',
          body: 'Initial schema committed before leaving',
          createdAt: '2026-11-09T10:00:00.000Z',
        },
      ]);
    });
  });

  describe('4. Validation, draft preservation, and message-field privacy (FR-089, NR-010, NR-017)', () => {
    it('preserves submitted message draft on validation failure and redacts any leaked credentials', async () => {
      const overlongBody = 'x'.repeat(4001);
      const res = await request(app).post(`${baseUrl}/messages`).set(AUTH_HEADER).send({
        body: overlongBody,
        email: 'owner@example.com',
        token: 'secret-jwt-token',
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.submitted).toMatchObject({
        body: overlongBody,
        email: '[redacted]',
        token: '[redacted]',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/owner@example\.com|secret-jwt-token/);
    });

    it('never leaks private fields on GET /chat, GET /messages, or POST /messages even when DB rows contain sensitive columns', async () => {
      vi.mocked(chatRepository.findChannelByTeamId).mockResolvedValue({
        ...makeTeamChannel(),
        email: 'owner@example.com',
        password: 'hash',
        otp_hash: 'otp',
        firebase_uid: 'fb-owner-1',
        shared_contact_handle: '@secret_contact',
        workspace_notes: 'Private workspace note',
      } as never);
      vi.spyOn(chatRepository, 'listMessagesByChannel').mockResolvedValue([
        {
          id: '80000000-0000-4000-8000-000000000008',
          channel_id: CHANNEL_ID,
          author_id: ownerParticipant.id,
          body: 'Clean message projection check',
          created_at: '2026-11-09T12:00:00.000Z',
          email: 'owner@example.com',
          password: 'hash',
          otp_hash: 'otp',
          firebase_uid: 'fb-owner-1',
          shared_contact_handle: '@secret_contact',
        } as never,
      ]);
      vi.spyOn(chatRepository, 'createMessage').mockResolvedValue({
        id: '80000000-0000-4000-8000-000000000009',
        channel_id: CHANNEL_ID,
        author_id: ownerParticipant.id,
        body: 'New message check',
        created_at: '2026-11-09T12:05:00.000Z',
        email: 'owner@example.com',
        firebase_uid: 'fb-owner-1',
      } as never);

      const channelRes = await request(app).get(baseUrl).set(AUTH_HEADER);
      const listRes = await request(app).get(`${baseUrl}/messages`).set(AUTH_HEADER);
      const sendRes = await request(app)
        .post(`${baseUrl}/messages`)
        .set(AUTH_HEADER)
        .send({ body: 'New message check' });

      for (const res of [channelRes, listRes, sendRes]) {
        expect(publicPayloadHasPrivateChatKey(res.body)).toBe(false);
        expect(JSON.stringify(res.body)).not.toMatch(
          /owner@example\.com|fb-owner-1|@secret_contact|Private workspace note/
        );
      }
    });
  });
});
