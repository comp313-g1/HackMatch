/**
 * US-019 / #186 — Invitation response transactions integration suite.
 *
 * Maps acceptance tests US-019-T1 … US-019-T6 across the Express pipeline:
 * Firebase Auth → MFA → active → PART → verified → respond/accept/leave handlers.
 *
 * Real Postgres concurrency / leave / lock invariants are covered separately by
 * invitations.db.integration.test.ts when RUN_DB_INTEGRATION=1. This suite is
 * deterministic and runs offline on every Vitest/CI invocation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import * as invitationAcceptance from '../services/invitationAcceptance.js';
import { TeamServiceError } from '../services/teamErrors.js';
import type { TeamRequest } from '../db/types.js';
import {
  otherParticipant,
  otherTokenHeader,
  ownerParticipant,
  sampleEventId,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
  sampleVacancyId,
  validOtherDecodedToken,
  validOwnerDecodedToken,
  validTokenHeader,
} from './team.testUtils.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
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

const invitationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const membershipId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const respondPath = `/api/invitations/${invitationId}/respond`;
const acceptPath = `/api/invitations/${invitationId}/accept`;
const leavePath = `/api/teams/${sampleTeamId}/leave`;

const pendingInvitation: TeamRequest = {
  id: invitationId,
  team_id: sampleTeamId,
  event_id: sampleEventId,
  vacancy_id: sampleVacancyId,
  participant_id: otherParticipant.id,
  request_type: 'Invitation',
  status: 'Pending',
  cancel_reason: null,
  resolved_at: null,
  expires_at: '2099-10-21T12:00:00.000Z',
  message: null,
  created_at: '2026-10-19T12:00:00.000Z',
  updated_at: '2026-10-19T12:00:00.000Z',
};

function acceptedPayload(overrides: Record<string, unknown> = {}) {
  const timestamp = '2026-10-20T12:00:00.000Z';
  return {
    accepted: true as const,
    invitation: {
      ...pendingInvitation,
      status: 'Accepted' as const,
      resolved_at: timestamp,
    },
    membership: {
      id: membershipId,
      team_id: sampleTeamId,
      event_id: sampleEventId,
      participant_id: otherParticipant.id,
      role: 'Member' as const,
      status: 'Confirmed' as const,
      removal_reason: null,
      joined_at: timestamp,
      ended_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    vacancy: { ...sampleVacancy, status: 'Filled' as const, updated_at: timestamp },
    teamName: sampleTeam.name,
    vacancyRole: sampleVacancy.role,
    memberCount: 2,
    maxTeamSize: 4,
    availabilityCleared: true,
    membershipCommitted: true,
    cascade: {
      winningRequestId: invitationId,
      eventInvitationsCanceled: 1,
      eventApplicationsWithdrawn: 1,
      slotRequestsCanceled: 0,
      teamRequestsCanceled: 0,
      teamNowFull: false,
    },
    notice:
      'Invitation accepted. Membership confirmed, the vacancy is filled, and competing pending requests for this event were cleared.',
    ...overrides,
  };
}

describe('US-019 Response Transactions Integration Suite (#186)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
  });

  describe('US-019-T1: accept confirms membership, fills slot, clears availability', () => {
    it('POST /respond accept returns committed membership + cascade summary', async () => {
      vi.spyOn(invitationAcceptance, 'acceptInvitation').mockResolvedValue(acceptedPayload());

      const res = await request(app)
        .post(respondPath)
        .set('Authorization', otherTokenHeader)
        .send({ decision: 'accept' });

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        decision: 'accept',
        membershipCommitted: true,
        invitation: { status: 'Accepted' },
        membership: { role: 'Member', status: 'Confirmed' },
        vacancy: { status: 'Filled' },
        cascade: {
          eventInvitationsCanceled: 1,
          eventApplicationsWithdrawn: 1,
        },
      });
      expect(res.body.notice).toMatch(/membership|competing/i);
    });

    it('POST /accept returns the same membership + availability-cleared outcome', async () => {
      vi.spyOn(teamsRepository, 'acceptTeamInvitation').mockResolvedValue(acceptedPayload());

      const res = await request(app)
        .post(acceptPath)
        .set('Authorization', otherTokenHeader)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.membership.status).toBe('Confirmed');
      expect(res.body.vacancy.status).toBe('Filled');
      expect(res.body.availabilityCleared).toBe(true);
    });
  });

  describe('US-019-T2: decline changes only that invitation and alerts the owner', () => {
    it('returns Declined with owner/invitee alerts and no membership/vacancy mutation markers', async () => {
      vi.spyOn(teamsRepository, 'declineTeamInvitation').mockResolvedValue({
        invitation: {
          ...pendingInvitation,
          status: 'Declined',
          cancel_reason: 'INVITEE_DECLINED',
          resolved_at: '2026-10-19T16:00:00.000Z',
        },
        changed: true,
        idempotent: false,
        teamName: sampleTeam.name,
        vacancyRole: 'Frontend',
        effects: {
          invitationChanged: true,
          ownerAlertCreated: true,
          inviteeAlertCreated: true,
          availabilityChanged: false,
          membershipChanged: false,
          vacancyChanged: false,
        },
        alerts: [
          {
            audience: 'invitee',
            type: 'team_invitation_declined',
            message: 'You declined the invitation.',
          },
          {
            audience: 'owner',
            type: 'team_invitation_declined',
            message: 'An invitee declined the pending invitation.',
          },
        ],
        notice: 'Invitation declined. The team owner has been notified. Your availability is unchanged.',
      });

      const res = await request(app)
        .post(respondPath)
        .set('Authorization', otherTokenHeader)
        .send({ decision: 'decline' });

      expect(res.status).toBe(200);
      expect(res.body.invitation.status).toBe('Declined');
      expect(res.body.effects).toMatchObject({
        invitationChanged: true,
        availabilityChanged: false,
        membershipChanged: false,
        vacancyChanged: false,
        ownerAlertCreated: true,
      });
      expect(res.body.alerts.some((a: { audience: string }) => a.audience === 'owner')).toBe(true);
      expect(res.body).not.toHaveProperty('membership');
    });
  });

  describe('US-019-T3: accept after fill or lock is rejected without success payload', () => {
    it.each([
      {
        label: 'team already full',
        code: 'CAPACITY_EXCEEDED' as const,
        details: { current: 4, max: 4 },
      },
      {
        label: 'vacancy already filled',
        code: 'VACANCY_NOT_OPEN' as const,
        details: { vacancyStatus: 'Filled' },
      },
      {
        label: 'team locked',
        code: 'TEAM_NOT_MUTABLE' as const,
        details: { reason: 'Locked' },
      },
    ])('respond accept rejects $label with 409 $code', async ({ code, details }) => {
      vi.spyOn(invitationAcceptance, 'acceptInvitation').mockRejectedValue(
        new TeamServiceError(code, details)
      );

      const res = await request(app)
        .post(respondPath)
        .set('Authorization', otherTokenHeader)
        .send({ decision: 'accept' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(code);
      expect(res.body).not.toHaveProperty('membership');
      expect(res.body).not.toHaveProperty('accepted');
      expect(JSON.stringify(res.body)).not.toMatch(/SELECT|password=/i);
    });
  });

  describe('US-019-T4: concurrent acceptance yields one success and one clear conflict', () => {
    it('parallel POST /accept calls surface one 200 and one 409 conflict', async () => {
      let calls = 0;
      vi.spyOn(teamsRepository, 'acceptTeamInvitation').mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          return acceptedPayload();
        }
        throw {
          message: 'INVITATION_ACCEPTANCE_CONFLICT',
          code: 'P0001',
          detail: JSON.stringify({
            invitationId,
            status: 'Accepted',
            reason: 'ALREADY_ACCEPTED',
            retryable: false,
          }),
        };
      });

      const [first, second] = await Promise.all([
        request(app).post(acceptPath).set('Authorization', otherTokenHeader).send({}),
        request(app).post(acceptPath).set('Authorization', otherTokenHeader).send({}),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const success = first.status === 200 ? first : second;
      const conflict = first.status === 409 ? first : second;
      expect(success.body.membership.status).toBe('Confirmed');
      expect(conflict.body).toMatchObject({
        code: 'INVITATION_ACCEPTANCE_CONFLICT',
        details: {
          status: 'Accepted',
          reason: 'ALREADY_ACCEPTED',
          retryable: false,
        },
      });
      expect(conflict.body).not.toHaveProperty('membership');
      expect(calls).toBe(2);
    });
  });

  describe('US-019-T5: confirmed non-owner leaves before lock', () => {
    it('POST /leave restores availability and returns an explicit notice', async () => {
      const leaveSpy = vi.spyOn(teamsRepository, 'leaveTeam').mockResolvedValue({
        leftParticipantId: otherParticipant.id,
        teamId: sampleTeamId,
        availabilityRestored: true,
        notice:
          'You left the team. Your Looking-for-Team availability for this event was restored.',
      });

      const res = await request(app)
        .post(leavePath)
        .set('Authorization', otherTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.availabilityRestored).toBe(true);
      expect(res.body.message).toMatch(/availability/i);
      expect(leaveSpy).toHaveBeenCalledWith(otherParticipant.id, sampleTeamId);
    });

    it('rejects leave after lock with 409 TEAM_NOT_MUTABLE', async () => {
      vi.spyOn(teamsRepository, 'leaveTeam').mockRejectedValue(
        new TeamServiceError('TEAM_NOT_MUTABLE', { reason: 'Locked' })
      );

      const res = await request(app)
        .post(leavePath)
        .set('Authorization', otherTokenHeader);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TEAM_NOT_MUTABLE');
      expect(res.body.details).toEqual({ reason: 'Locked' });
    });
  });

  describe('US-019-T6: wrong user respond / owner leave denied', () => {
    it('forbids a non-invitee from accepting via /respond', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      const acceptSpy = vi.spyOn(invitationAcceptance, 'acceptInvitation').mockRejectedValue(
        new TeamServiceError('FORBIDDEN_NOT_INVITEE')
      );

      const res = await request(app)
        .post(respondPath)
        .set('Authorization', validTokenHeader)
        .send({ decision: 'accept' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_INVITEE');
      expect(acceptSpy).toHaveBeenCalledWith({
        actorParticipantId: ownerParticipant.id,
        invitationId,
      });
    });

    it('rejects owner leave with 409 CANNOT_LEAVE_AS_OWNER (must disband)', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(teamsRepository, 'leaveTeam').mockRejectedValue(
        new TeamServiceError('CANNOT_LEAVE_AS_OWNER')
      );

      const res = await request(app)
        .post(leavePath)
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CANNOT_LEAVE_AS_OWNER');
      expect(res.body.error).toMatch(/disband/i);
    });

    it('rejects unauthenticated respond and leave with 401', async () => {
      const respondRes = await request(app).post(respondPath).send({ decision: 'accept' });
      const leaveRes = await request(app).post(leavePath);

      expect(respondRes.status).toBe(401);
      expect(leaveRes.status).toBe(401);
    });

    it('rejects invalid respond decision with 400 field error and no repository call', async () => {
      const acceptSpy = vi.spyOn(invitationAcceptance, 'acceptInvitation');
      const declineSpy = vi.spyOn(teamsRepository, 'declineTeamInvitation');

      const res = await request(app)
        .post(respondPath)
        .set('Authorization', otherTokenHeader)
        .send({ decision: 'maybe' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.decision).toMatch(/accept or decline/i);
      expect(acceptSpy).not.toHaveBeenCalled();
      expect(declineSpy).not.toHaveBeenCalled();
    });
  });
});
