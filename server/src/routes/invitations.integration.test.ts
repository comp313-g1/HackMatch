/**
 * US-017 Issue a Team Invitation — Integration Suite (#168)
 *
 * Exercises invitation issuance, listing, cancel, acceptance revalidation, and
 * permissions across the Express middleware pipeline
 * (Firebase token → MFA → active → PART → verified → owner / invitee).
 *
 * Maps to acceptance tests:
 *   US-017-T1 Pending + 48h expiry
 *   US-017-T2 duplicate pending slot / invitee rejected
 *   US-017-T3 expired acceptance rejected
 *   US-017-T4 owner cancel + status alerts
 *   US-017-T5 non-owner / locked team denied
 *   US-017-T6 slot closed before accept → unusable
 *
 * Auth/validation failure paths included for repeatable evidence of
 * server-side validation and authorization (401 / 403 MFA / verified / suspended).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import {
  AUTH_TIME,
  ownerParticipant,
  otherParticipant,
  sampleEventId,
  sampleParts,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
  sampleVacancyId,
  validOwnerDecodedToken,
  validOtherDecodedToken,
  validTokenHeader,
  otherTokenHeader,
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

const invitePath = `/api/teams/${sampleTeamId}/invitations`;
const invitationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const acceptPath = `/api/invitations/${invitationId}/accept`;
const cancelPath = `/api/invitations/${invitationId}`;

const inviteBody = {
  vacancyId: sampleVacancyId,
  inviteeParticipantId: otherParticipant.id,
  source: 'direct' as const,
};

function mockEligibleIssuanceContext(overrides?: {
  vacancyStatus?: 'Open' | 'Filled';
  recruitment_status?: 'Open' | 'Locked' | 'Disbanded';
  eventStatus?: 'Published' | 'Archived' | 'Disabled';
  isLooking?: boolean;
  confirmedIds?: string[];
  byInvitee?: { id: string } | null;
  bySlot?: { id: string } | null;
}): void {
  vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
  vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
    ...sampleParts,
    team: {
      ...sampleTeam,
      recruitment_status: overrides?.recruitment_status ?? 'Open',
    },
    event: {
      max_team_size: 4,
      status: overrides?.eventStatus ?? 'Published',
      end_date: '2099-01-01T00:00:00.000Z',
    },
    vacancies: [{ ...sampleVacancy, status: overrides?.vacancyStatus ?? 'Open' }],
  });
  vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue(
    overrides?.confirmedIds ?? [ownerParticipant.id]
  );
  vi.spyOn(teamsRepository, 'findPendingInvitationConflicts').mockResolvedValue({
    byInvitee: (overrides?.byInvitee as never) ?? null,
    bySlot: (overrides?.bySlot as never) ?? null,
  });
  vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
  vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
    participantId: otherParticipant.id,
    isLooking: overrides?.isLooking ?? true,
    desiredRole: 'Frontend',
    commitmentHours: 10,
    goal: 'Learning',
    updatedAt: null,
  });
}

function mockPendingInvitationForAccept(overrides?: {
  expiresAt?: string;
  vacancyStatus?: 'Open' | 'Filled';
  participantId?: string;
}): void {
  vi.spyOn(teamsRepository, 'findInvitationById').mockResolvedValue({
    id: invitationId,
    team_id: sampleTeamId,
    event_id: sampleEventId,
    vacancy_id: sampleVacancyId,
    participant_id: overrides?.participantId ?? otherParticipant.id,
    request_type: 'Invitation',
    status: 'Pending',
    cancel_reason: null,
    resolved_at: null,
    expires_at: overrides?.expiresAt ?? '2099-01-01T00:00:00.000Z',
    created_at: '2026-10-19T12:00:00.000Z',
    updated_at: '2026-10-19T12:00:00.000Z',
  });
  vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
    ...sampleParts,
    team: sampleTeam,
    event: {
      max_team_size: 4,
      status: 'Published',
      end_date: '2099-01-01T00:00:00.000Z',
    },
    vacancies: [
      { ...sampleVacancy, status: overrides?.vacancyStatus ?? 'Open' },
    ],
  });
  vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue([
    ownerParticipant.id,
  ]);
  vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
}

function tokenWithoutMfa(): DecodedIdToken {
  return {
    uid: ownerParticipant.firebase_uid,
    email: ownerParticipant.email,
    role: 'PART',
    auth_time: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

describe('US-017 Invitations Integration Suite (permissions, issuance, cancel, accept) #168', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    mockEligibleIssuanceContext();
  });

  describe('US-017-T1: Pending invitation with 48-hour expiry', () => {
    it('issues Pending invitation and returns expiresAt (happy path)', async () => {
      const createdAt = '2026-10-19T15:00:00.000Z';
      const expiresAt = '2026-10-21T15:00:00.000Z';
      vi.spyOn(teamsRepository, 'issueTeamInvitation').mockResolvedValue({
        invitation: {
          id: invitationId,
          team_id: sampleTeamId,
          event_id: sampleEventId,
          vacancy_id: sampleVacancyId,
          participant_id: otherParticipant.id,
          request_type: 'Invitation',
          status: 'Pending',
          cancel_reason: null,
          resolved_at: null,
          expires_at: expiresAt,
          created_at: createdAt,
          updated_at: createdAt,
        },
        expiresAt,
        vacancyRole: 'Frontend',
        teamName: 'HackMatch Innovators',
      });

      const res = await request(app)
        .post(invitePath)
        .set('Authorization', validTokenHeader)
        .send(inviteBody);

      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.invitation).toMatchObject({
        status: 'Pending',
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        expiresAt,
        source: 'direct',
      });
      const ttlMs =
        new Date(expiresAt).getTime() - new Date(createdAt).getTime();
      expect(ttlMs).toBe(48 * 60 * 60 * 1000);
    });

    it('lists outbound invitations for the owner including Pending + expiry', async () => {
      const expiresAt = '2026-10-21T15:00:00.000Z';
      vi.spyOn(teamsRepository, 'listTeamInvitations').mockResolvedValue([
        {
          invitation: {
            id: invitationId,
            team_id: sampleTeamId,
            event_id: sampleEventId,
            vacancy_id: sampleVacancyId,
            participant_id: otherParticipant.id,
            request_type: 'Invitation',
            status: 'Pending',
            cancel_reason: null,
            resolved_at: null,
            expires_at: expiresAt,
            created_at: '2026-10-19T15:00:00.000Z',
            updated_at: '2026-10-19T15:00:00.000Z',
          },
          inviteeHandle: 'other_dev',
          inviteeDisplayName: 'Other Participant',
          vacancyRole: 'Frontend',
          teamName: 'HackMatch Innovators',
        },
      ]);

      const res = await request(app).get(invitePath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.empty).toBe(false);
      expect(res.body.invitations[0]).toMatchObject({
        status: 'Pending',
        expiresAt,
        vacancyRole: 'Frontend',
      });
    });
  });

  describe('US-017-T2: duplicate pending invitations rejected', () => {
    it('rejects when invitee already has Pending on team', async () => {
      mockEligibleIssuanceContext({
        byInvitee: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      });
      const issueSpy = vi.spyOn(teamsRepository, 'issueTeamInvitation');

      const res = await request(app)
        .post(invitePath)
        .set('Authorization', validTokenHeader)
        .send(inviteBody);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_PENDING_INVITATION');
      expect(res.body.errors.inviteeParticipantId).toMatch(/pending invitation already exists/i);
      expect(issueSpy).not.toHaveBeenCalled();
    });

    it('rejects when open slot already has Pending invite', async () => {
      mockEligibleIssuanceContext({
        bySlot: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      });
      const issueSpy = vi.spyOn(teamsRepository, 'issueTeamInvitation');

      const res = await request(app)
        .post(invitePath)
        .set('Authorization', validTokenHeader)
        .send(inviteBody);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SLOT_PENDING_INVITATION_EXISTS');
      expect(res.body.errors.vacancyId).toMatch(/already has a pending invitation/i);
      expect(issueSpy).not.toHaveBeenCalled();
    });
  });

  describe('US-017-T3: expired invitation acceptance rejected', () => {
    it('returns 409 INVITATION_EXPIRED when past 48h TTL', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
      mockPendingInvitationForAccept({ expiresAt: '2020-01-01T00:00:00.000Z' });
      vi.spyOn(teamsRepository, 'markInvitationExpiredIfDue').mockResolvedValue({
        invitation: {
          id: invitationId,
          team_id: sampleTeamId,
          event_id: sampleEventId,
          vacancy_id: sampleVacancyId,
          participant_id: otherParticipant.id,
          request_type: 'Invitation',
          status: 'Expired',
          cancel_reason: null,
          resolved_at: '2020-01-01T00:00:00.000Z',
          expires_at: '2020-01-01T00:00:00.000Z',
          created_at: '2019-12-30T00:00:00.000Z',
          updated_at: '2020-01-01T00:00:00.000Z',
        },
        changed: true,
      });

      const res = await request(app)
        .post(acceptPath)
        .set('Authorization', otherTokenHeader)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVITATION_EXPIRED');
      expect(res.body.errors.invitationId).toMatch(/expired/i);
    });
  });

  describe('US-017-T4: owner cancel Pending invitation', () => {
    it('cancels invitation and returns owner + invitee status alerts', async () => {
      vi.spyOn(teamsRepository, 'cancelTeamInvitation').mockResolvedValue({
        invitation: {
          id: invitationId,
          team_id: sampleTeamId,
          event_id: sampleEventId,
          vacancy_id: sampleVacancyId,
          participant_id: otherParticipant.id,
          request_type: 'Invitation',
          status: 'Canceled',
          cancel_reason: 'OWNER_CANCELED',
          resolved_at: '2026-10-19T15:00:00.000Z',
          expires_at: '2026-10-21T12:00:00.000Z',
          created_at: '2026-10-19T12:00:00.000Z',
          updated_at: '2026-10-19T15:00:00.000Z',
        },
        changed: true,
        idempotent: false,
        teamName: 'HackMatch Innovators',
        vacancyRole: 'Frontend',
        alerts: [
          {
            audience: 'invitee',
            type: 'team_invitation_canceled',
            message: 'Your invitation was canceled by the team owner.',
          },
          {
            audience: 'owner',
            type: 'team_invitation_canceled',
            message: 'You canceled the pending invitation.',
          },
        ],
        notice: 'Pending invitation canceled. Quota for this slot and invitee is released.',
      });

      const res = await request(app)
        .delete(cancelPath)
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.invitation.status).toBe('Canceled');
      expect(res.body.alerts).toHaveLength(2);
      expect(res.body.alerts.map((a: { audience: string }) => a.audience).sort()).toEqual([
        'invitee',
        'owner',
      ]);
      expect(res.body.notice).toMatch(/canceled/i);
    });
  });

  describe('US-017-T5: non-owner and locked team denied', () => {
    it('rejects non-owner issuance with 403 FORBIDDEN_NOT_TEAM_OWNER', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

      const res = await request(app)
        .post(invitePath)
        .set('Authorization', otherTokenHeader)
        .send({
          ...inviteBody,
          inviteeParticipantId: ownerParticipant.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
    });

    it('rejects non-owner list with 403 FORBIDDEN_NOT_TEAM_OWNER', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

      const res = await request(app).get(invitePath).set('Authorization', otherTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
    });

    it('rejects non-owner cancel with 403', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
      vi.spyOn(teamsRepository, 'cancelTeamInvitation').mockRejectedValue({
        message: 'FORBIDDEN_NOT_TEAM_OWNER',
        code: 'P0001',
      });

      const res = await request(app)
        .delete(cancelPath)
        .set('Authorization', otherTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
    });

    it('rejects locked team issuance with 409 TEAM_NOT_MUTABLE', async () => {
      mockEligibleIssuanceContext({ recruitment_status: 'Locked' });

      const res = await request(app)
        .post(invitePath)
        .set('Authorization', validTokenHeader)
        .send(inviteBody);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TEAM_NOT_MUTABLE');
    });
  });

  describe('US-017-T6: slot closed before accept', () => {
    it('returns 409 VACANCY_NOT_OPEN when vacancy is Filled', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
      mockPendingInvitationForAccept({ vacancyStatus: 'Filled' });

      const res = await request(app)
        .post(acceptPath)
        .set('Authorization', otherTokenHeader)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('VACANCY_NOT_OPEN');
    });
  });

  describe('Permissions matrix: auth, MFA, verified, suspended', () => {
    it.each([
      {
        name: 'POST issue',
        run: () => request(app).post(invitePath).send(inviteBody),
      },
      {
        name: 'GET list',
        run: () => request(app).get(invitePath),
      },
      {
        name: 'DELETE cancel',
        run: () => request(app).delete(cancelPath),
      },
      {
        name: 'POST accept',
        run: () => request(app).post(acceptPath).send({}),
      },
    ])('rejects unauthenticated $name with 401', async ({ run }) => {
      const res = await run();
      expect(res.status).toBe(401);
    });

    it.each([
      {
        name: 'POST issue',
        run: () =>
          request(app).post(invitePath).set('Authorization', validTokenHeader).send(inviteBody),
      },
      {
        name: 'GET list',
        run: () => request(app).get(invitePath).set('Authorization', validTokenHeader),
      },
      {
        name: 'DELETE cancel',
        run: () => request(app).delete(cancelPath).set('Authorization', validTokenHeader),
      },
    ])('rejects $name without MFA claim with 403 MFA_REQUIRED', async ({ run }) => {
      mockVerifyIdToken.mockResolvedValue(tokenWithoutMfa());

      const res = await run();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it.each([
      {
        name: 'POST issue',
        run: () =>
          request(app).post(invitePath).set('Authorization', validTokenHeader).send(inviteBody),
      },
      {
        name: 'GET list',
        run: () => request(app).get(invitePath).set('Authorization', validTokenHeader),
      },
      {
        name: 'DELETE cancel',
        run: () => request(app).delete(cancelPath).set('Authorization', validTokenHeader),
      },
    ])('rejects unverified owner on $name with 403 EMAIL_NOT_VERIFIED', async ({ run }) => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        is_verified: false,
      });

      const res = await run();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it.each([
      {
        name: 'POST issue',
        run: () =>
          request(app).post(invitePath).set('Authorization', validTokenHeader).send(inviteBody),
      },
      {
        name: 'GET list',
        run: () => request(app).get(invitePath).set('Authorization', validTokenHeader),
      },
      {
        name: 'DELETE cancel',
        run: () => request(app).delete(cancelPath).set('Authorization', validTokenHeader),
      },
    ])('rejects suspended owner on $name with 403 ACCOUNT_SUSPENDED', async ({ run }) => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        is_suspended: true,
      });

      const res = await run();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('rejects non-invitee accept with 403 FORBIDDEN_NOT_INVITEE', async () => {
      mockPendingInvitationForAccept();

      const res = await request(app)
        .post(acceptPath)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_INVITEE');
    });
  });

  describe('Invalid input and eligibility failure handling', () => {
    it('rejects invalid vacancy UUID with 400 VALIDATION_ERROR and field errors', async () => {
      const res = await request(app)
        .post(invitePath)
        .set('Authorization', validTokenHeader)
        .send({
          vacancyId: 'not-a-uuid',
          inviteeParticipantId: otherParticipant.id,
          source: 'direct',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.vacancyId).toBeTruthy();
    });

    it('rejects invalid invitee UUID with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(invitePath)
        .set('Authorization', validTokenHeader)
        .send({
          vacancyId: sampleVacancyId,
          inviteeParticipantId: 'bad',
          source: 'direct',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.inviteeParticipantId).toBeTruthy();
    });

    it('returns 409 when invitee is not Looking for Team', async () => {
      mockEligibleIssuanceContext({ isLooking: false });

      const res = await request(app)
        .post(invitePath)
        .set('Authorization', validTokenHeader)
        .send(inviteBody);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVITEE_NOT_AVAILABLE');
      expect(res.body.errors.inviteeParticipantId).toMatch(/Looking for Team/i);
    });

    it('returns 409 when vacancy is not open at issuance', async () => {
      mockEligibleIssuanceContext({ vacancyStatus: 'Filled' });

      const res = await request(app)
        .post(invitePath)
        .set('Authorization', validTokenHeader)
        .send(inviteBody);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('VACANCY_NOT_OPEN');
      expect(res.body.errors.vacancyId).toMatch(/open slot/i);
    });

    it('returns empty outbound list message when owner has no invitations', async () => {
      vi.spyOn(teamsRepository, 'listTeamInvitations').mockResolvedValue([]);

      const res = await request(app).get(invitePath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.empty).toBe(true);
      expect(res.body.invitations).toEqual([]);
      expect(res.body.message).toMatch(/No invitations yet/i);
    });
  });
});
