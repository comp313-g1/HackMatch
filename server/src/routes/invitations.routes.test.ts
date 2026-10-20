import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeamId,
  sampleVacancyId,
  sampleEventId,
  sampleTeam,
  sampleParts,
  sampleVacancy,
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

function mockEligibleIssuanceContext(overrides?: {
  vacancyStatus?: 'Open' | 'Filled';
  recruitment_status?: 'Open' | 'Locked' | 'Disbanded';
  eventStatus?: 'Published' | 'Archived' | 'Disabled';
  isLooking?: boolean;
  confirmedIds?: string[];
  byInvitee?: { id: string } | null;
  bySlot?: { id: string } | null;
}): void {
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

describe('POST /api/teams/:teamId/invitations (US-017 / FR-048 / #163)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    mockEligibleIssuanceContext();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post(invitePath).send({
      vacancyId: sampleVacancyId,
      inviteeParticipantId: otherParticipant.id,
      source: 'recommendation',
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-owners with 403', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', otherTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: ownerParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
  });

  it('rejects invalid body with 400 and field errors (draft fields preserved by client)', async () => {
    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: 'bad',
        inviteeParticipantId: otherParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.vacancyId).toBeTruthy();
  });

  it('creates a Pending invitation from recommendation source (happy path)', async () => {
    const expiresAt = '2026-10-21T15:00:00.000Z';
    vi.spyOn(teamsRepository, 'issueTeamInvitation').mockResolvedValue({
      invitation: {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Invitation',
        status: 'Pending',
        cancel_reason: null,
        resolved_at: null,
        expires_at: expiresAt,
        message: null,
        created_at: '2026-10-19T15:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      expiresAt,
      vacancyRole: 'Frontend',
      teamName: 'HackMatch Innovators',
    });

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.invitation).toMatchObject({
      status: 'Pending',
      source: 'recommendation',
      vacancyId: sampleVacancyId,
      inviteeParticipantId: otherParticipant.id,
      expiresAt,
    });
    expect(teamsRepository.issueTeamInvitation).toHaveBeenCalledWith(
      ownerParticipant.id,
      sampleTeamId,
      sampleVacancyId,
      otherParticipant.id
    );
  });

  it('returns 409 + vacancyId field error when slot is not open (#163)', async () => {
    mockEligibleIssuanceContext({ vacancyStatus: 'Filled' });
    const issueSpy = vi.spyOn(teamsRepository, 'issueTeamInvitation');

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'direct',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VACANCY_NOT_OPEN');
    expect(res.body.errors.vacancyId).toMatch(/open slot/i);
    expect(issueSpy).not.toHaveBeenCalled();
  });

  it('returns 409 when team is locked (#163 / US-017-T5)', async () => {
    mockEligibleIssuanceContext({ recruitment_status: 'Locked' });

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'direct',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEAM_NOT_MUTABLE');
  });

  it('allows invitation issuance when event is archived as long as team is Open (US-017 event-free)', async () => {
    mockEligibleIssuanceContext({ eventStatus: 'Archived' });
    vi.spyOn(teamsRepository, 'issueTeamInvitation').mockResolvedValue({
      invitation: {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Invitation',
        status: 'Pending',
        cancel_reason: null,
        resolved_at: null,
        expires_at: '2026-10-21T15:00:00.000Z',
        message: null,
        created_at: '2026-10-19T15:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      expiresAt: '2026-10-21T15:00:00.000Z',
      vacancyRole: 'Frontend',
      teamName: 'HackMatch Innovators',
    });

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'direct',
      });

    expect(res.status).toBe(201);
    expect(res.body.invitation.status).toBe('Pending');
  });

  it('returns 409 + invitee field error when invitee is not Looking for Team (#163)', async () => {
    mockEligibleIssuanceContext({ isLooking: false });

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'direct',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVITEE_NOT_AVAILABLE');
    expect(res.body.errors.inviteeParticipantId).toMatch(/Looking for Team/i);
  });

  it('returns 409 when invitee is already confirmed for the event (#163)', async () => {
    mockEligibleIssuanceContext({
      confirmedIds: [ownerParticipant.id, otherParticipant.id],
    });

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'direct',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVITEE_ALREADY_CONFIRMED');
    expect(res.body.errors.inviteeParticipantId).toBeTruthy();
  });

  it('returns 409 + invitee field error when invitee already has Pending on team (#164)', async () => {
    mockEligibleIssuanceContext({
      byInvitee: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    const issueSpy = vi.spyOn(teamsRepository, 'issueTeamInvitation');

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_PENDING_INVITATION');
    expect(res.body.errors.inviteeParticipantId).toMatch(/pending invitation already exists/i);
    expect(issueSpy).not.toHaveBeenCalled();
  });

  it('returns 409 + vacancy field error when slot already has Pending invite (#164 / T2)', async () => {
    mockEligibleIssuanceContext({
      bySlot: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    });
    const issueSpy = vi.spyOn(teamsRepository, 'issueTeamInvitation');

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'direct',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_PENDING_INVITATION_EXISTS');
    expect(res.body.errors.vacancyId).toMatch(/already has a pending invitation/i);
    expect(issueSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/teams/:teamId/invitations (US-017 / #162)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get(invitePath);
    expect(res.status).toBe(401);
  });

  it('rejects non-owners with 403 FORBIDDEN_NOT_TEAM_OWNER', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app).get(invitePath).set('Authorization', otherTokenHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
  });

  it('returns empty outbound list for the owner', async () => {
    vi.spyOn(teamsRepository, 'listTeamInvitations').mockResolvedValue([]);

    const res = await request(app).get(invitePath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.empty).toBe(true);
    expect(res.body.invitations).toEqual([]);
    expect(res.body.message).toMatch(/No invitations yet/i);
  });

  it('returns outbound invitations for the owner (happy path)', async () => {
    const expiresAt = '2026-10-21T15:00:00.000Z';
    vi.spyOn(teamsRepository, 'listTeamInvitations').mockResolvedValue([
      {
        invitation: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          team_id: sampleTeamId,
          event_id: sampleEventId,
          vacancy_id: sampleVacancyId,
          participant_id: otherParticipant.id,
          request_type: 'Invitation',
          status: 'Pending',
          cancel_reason: null,
          resolved_at: null,
          expires_at: expiresAt,
          message: null,
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
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0]).toMatchObject({
      inviteeHandle: 'other_dev',
      vacancyRole: 'Frontend',
      status: 'Pending',
      expiresAt,
    });
  });
});
