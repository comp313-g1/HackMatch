import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleTeamId,
  sampleVacancyId,
  validOtherDecodedToken,
  otherTokenHeader,
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

const applicationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const withdrawPath = `/api/applications/${applicationId}/withdraw`;
const minePath = '/api/applications/mine';

describe('GET /api/applications/mine + POST withdraw (US-018 / #175 / FR-055)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
  });

  it('rejects unauthenticated list with 401', async () => {
    const res = await request(app).get(minePath);
    expect(res.status).toBe(401);
  });

  it('lists applicant applications with Pending Review labels', async () => {
    vi.spyOn(teamsRepository, 'listMyApplications').mockResolvedValue([
      {
        application: {
          id: applicationId,
          team_id: sampleTeamId,
          event_id: sampleEventId,
          vacancy_id: sampleVacancyId,
          participant_id: otherParticipant.id,
          request_type: 'Application',
          status: 'Pending',
          cancel_reason: null,
          resolved_at: null,
          expires_at: null,
          message: 'Ready',
          created_at: '2026-10-19T12:00:00.000Z',
          updated_at: '2026-10-19T12:00:00.000Z',
        },
        vacancyRole: 'Frontend',
        teamName: 'HackMatch Innovators',
      },
    ]);

    const res = await request(app).get(minePath).set('Authorization', otherTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.applications).toHaveLength(1);
    expect(res.body.applications[0]).toMatchObject({
      status: 'Pending',
      statusLabel: 'Pending Review',
      withdrawable: true,
    });
  });

  it('rejects unauthenticated withdraw with 401', async () => {
    const res = await request(app).post(withdrawPath);
    expect(res.status).toBe(401);
  });

  it('withdraws Pending application and returns alerts (happy path / US-018-T5)', async () => {
    vi.spyOn(teamsRepository, 'withdrawTeamApplication').mockResolvedValue({
      application: {
        id: applicationId,
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Application',
        status: 'Withdrawn',
        cancel_reason: 'APPLICANT_WITHDRAWN',
        resolved_at: '2026-10-19T16:00:00.000Z',
        expires_at: null,
        message: 'Ready',
        created_at: '2026-10-19T12:00:00.000Z',
        updated_at: '2026-10-19T16:00:00.000Z',
      },
      changed: true,
      idempotent: false,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      alerts: [
        {
          audience: 'applicant',
          type: 'team_application_withdrawn',
          message: 'You withdrew your application.',
        },
        {
          audience: 'owner',
          type: 'team_application_withdrawn',
          message: 'An applicant withdrew their Pending Review application.',
        },
      ],
      notice:
        'Pending Review application withdrawn. Your pending quota for this event is released.',
    });

    const res = await request(app)
      .post(withdrawPath)
      .set('Authorization', otherTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.application.status).toBe('Withdrawn');
    expect(res.body.alerts).toHaveLength(2);
    expect(res.body.notice).toMatch(/withdrawn/i);
    expect(teamsRepository.withdrawTeamApplication).toHaveBeenCalledWith(
      otherParticipant.id,
      applicationId
    );
  });

  it('returns 200 idempotent when application is already Withdrawn', async () => {
    vi.spyOn(teamsRepository, 'withdrawTeamApplication').mockResolvedValue({
      application: {
        id: applicationId,
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Application',
        status: 'Withdrawn',
        cancel_reason: 'APPLICANT_WITHDRAWN',
        resolved_at: '2026-10-19T15:00:00.000Z',
        expires_at: null,
        message: null,
        created_at: '2026-10-19T12:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      changed: false,
      idempotent: true,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      alerts: [],
      notice: 'Application was already withdrawn.',
    });

    const res = await request(app)
      .post(withdrawPath)
      .set('Authorization', otherTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.changed).toBe(false);
  });

  it('returns 409 APPLICATION_NOT_WITHDRAWABLE for non-Pending rows', async () => {
    vi.spyOn(teamsRepository, 'withdrawTeamApplication').mockRejectedValue({
      message: 'APPLICATION_NOT_WITHDRAWABLE',
      code: 'P0001',
      detail: JSON.stringify({ status: 'Accepted' }),
    });

    const res = await request(app)
      .post(withdrawPath)
      .set('Authorization', otherTokenHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPLICATION_NOT_WITHDRAWABLE');
  });

  it('returns 403 FORBIDDEN_NOT_APPLICANT when actor is not the applicant', async () => {
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'withdrawTeamApplication').mockRejectedValue({
      message: 'FORBIDDEN_NOT_APPLICANT',
      code: 'P0001',
    });

    const res = await request(app).post(withdrawPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_APPLICANT');
  });
});
