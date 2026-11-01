import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant, ParticipantHackathonHistory } from '../db/types.js';

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

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;

describe('Express Hackathon History Endpoints (US-007 / #US-007-T2)', () => {
  const ownerParticipant: Participant = {
    id: 'part-owner-1',
    firebase_uid: 'fb-owner-1',
    email: 'owner@example.com',
    full_name: 'Owner Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
  };

  const otherParticipant: Participant = {
    id: 'part-other-2',
    firebase_uid: 'fb-other-2',
    email: 'other@example.com',
    full_name: 'Other Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
  };

  const validOwnerToken = {
    uid: 'fb-owner-1',
    email: 'owner@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const validOtherToken = {
    uid: 'fb-other-2',
    email: 'other@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const sampleEntry: ParticipantHackathonHistory = {
    id: 'hist-1',
    participant_id: 'part-owner-1',
    event_name: 'Hack The North 2025',
    event_date: '2025-09-15',
    team_role: 'Frontend',
    project_title: 'EcoTrack',
    project_url: 'https://github.com/example/ecotrack',
    created_at: '2025-09-16T12:00:00.000Z',
    updated_at: '2025-09-16T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockReset();
  });

  describe('GET /api/profiles/me/history', () => {
    it('rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/profiles/me/history');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects requests without MFA claim with 403 MFA_REQUIRED', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-owner-1',
        role: 'PART',
        auth_time: AUTH_TIME,
      } as unknown as DecodedIdToken);

      const res = await request(app)
        .get('/api/profiles/me/history')
        .set('Authorization', 'Bearer token-no-mfa');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it('returns own history list with self-reported metadata for authenticated owner', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryByParticipantId').mockResolvedValue([sampleEntry]);

      const res = await request(app)
        .get('/api/profiles/me/history')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        participantId: 'part-owner-1',
        viewerCategory: 'OWNER',
        hackathonCount: 1,
        isSelfReported: true,
        history: [
          {
            id: 'hist-1',
            participantId: 'part-owner-1',
            eventName: 'Hack The North 2025',
            eventDate: '2025-09-15',
            teamRole: 'Frontend',
            projectTitle: 'EcoTrack',
            projectUrl: 'https://github.com/example/ecotrack',
          },
        ],
      });
    });
  });

  describe('POST /api/profiles/me/history', () => {
    it('rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/profiles/me/history')
        .send({ eventName: 'Hack' });
      expect(res.status).toBe(401);
    });

    it('rejects payload missing required fields with 400 VALIDATION_ERROR', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);

      const res = await request(app)
        .post('/api/profiles/me/history')
        .set('Authorization', 'Bearer valid-token')
        .send({ eventName: 'Hack The North' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('creates new history record and returns 201 with updated count', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryByParticipantId')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([sampleEntry]);
      vi.spyOn(profileRepository, 'createHistoryEntry').mockResolvedValue(sampleEntry);

      const res = await request(app)
        .post('/api/profiles/me/history')
        .set('Authorization', 'Bearer valid-token')
        .send({
          eventName: 'Hack The North 2025',
          eventDate: '2025-09-15',
          teamRole: 'Frontend',
          projectTitle: 'EcoTrack',
          projectUrl: 'https://github.com/example/ecotrack',
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Hackathon history record created successfully.');
      expect(res.body.entry.eventName).toBe('Hack The North 2025');
      expect(res.body.hackathonCount).toBe(1);
      expect(res.body.isSelfReported).toBe(true);
    });

    it('rejects duplicate history record with 409 DUPLICATE_HISTORY_RECORD', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryByParticipantId').mockResolvedValue([sampleEntry]);

      const res = await request(app)
        .post('/api/profiles/me/history')
        .set('Authorization', 'Bearer valid-token')
        .send({
          eventName: 'hack the north 2025',
          eventDate: '2025-09-15',
          teamRole: 'Frontend',
          projectTitle: 'ecotrack',
          projectUrl: 'https://github.com/example/ecotrack',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_HISTORY_RECORD');
    });

    it('rejects invalid HTTPS URL with 400 VALIDATION_ERROR and does not modify database', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      const createSpy = vi.spyOn(profileRepository, 'createHistoryEntry');

      const res = await request(app)
        .post('/api/profiles/me/history')
        .set('Authorization', 'Bearer valid-token')
        .send({
          eventName: 'Valid Event',
          eventDate: '2024-05-01',
          teamRole: 'Frontend',
          projectTitle: 'Valid Project',
          projectUrl: 'http://insecure.com',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects future event date with 400 VALIDATION_ERROR', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      const futureYear = new Date().getUTCFullYear() + 2;

      const res = await request(app)
        .post('/api/profiles/me/history')
        .set('Authorization', 'Bearer valid-token')
        .send({
          eventName: 'Future Hack',
          eventDate: `${futureYear}-01-01`,
          teamRole: 'Backend',
          projectTitle: 'Future Project',
          projectUrl: 'https://example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects when maximum limit of 20 history records is reached', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryByParticipantId').mockResolvedValue(
        Array(20).fill(sampleEntry)
      );

      const res = await request(app)
        .post('/api/profiles/me/history')
        .set('Authorization', 'Bearer valid-token')
        .send({
          eventName: 'Event 21',
          eventDate: '2024-01-01',
          teamRole: 'UI/UX',
          projectTitle: 'Project 21',
          projectUrl: 'https://example.com/p21',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('HISTORY_LIMIT_EXCEEDED');
    });
  });

  describe('PUT /api/profiles/me/history/:historyId', () => {
    it('returns 404 when record does not exist', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryEntryById').mockResolvedValue(null);

      const res = await request(app)
        .put('/api/profiles/me/history/non-existent')
        .set('Authorization', 'Bearer valid-token')
        .send({ eventName: 'New Name' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('HISTORY_RECORD_NOT_FOUND');
    });

    it('returns 403 when record belongs to another participant', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryEntryById').mockResolvedValue({
        ...sampleEntry,
        participant_id: 'part-other-2',
      });

      const res = await request(app)
        .put('/api/profiles/me/history/hist-1')
        .set('Authorization', 'Bearer valid-token')
        .send({ eventName: 'New Name' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_HISTORY_EDIT');
    });

    it('updates record and returns 200 with updated list', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryEntryById').mockResolvedValue(sampleEntry);
      vi.spyOn(profileRepository, 'findHistoryByParticipantId')
        .mockResolvedValueOnce([sampleEntry])
        .mockResolvedValueOnce([{ ...sampleEntry, project_title: 'EcoTrack V2' }]);
      vi.spyOn(profileRepository, 'updateHistoryEntry').mockResolvedValue({
        ...sampleEntry,
        project_title: 'EcoTrack V2',
      });

      const res = await request(app)
        .put('/api/profiles/me/history/hist-1')
        .set('Authorization', 'Bearer valid-token')
        .send({ projectTitle: 'EcoTrack V2' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Hackathon history record updated successfully.');
      expect(res.body.entry.projectTitle).toBe('EcoTrack V2');
    });
  });

  describe('DELETE /api/profiles/me/history/:historyId', () => {
    it('returns 404 when entry does not exist', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryEntryById').mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/profiles/me/history/non-existent')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('HISTORY_RECORD_NOT_FOUND');
    });

    it('returns 403 when entry belongs to someone else', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryEntryById').mockResolvedValue({
        ...sampleEntry,
        participant_id: 'part-other-2',
      });

      const res = await request(app)
        .delete('/api/profiles/me/history/hist-1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_HISTORY_EDIT');
    });

    it('removes record and returns 200 with remaining count', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'findHistoryEntryById').mockResolvedValue(sampleEntry);
      vi.spyOn(profileRepository, 'deleteHistoryEntry').mockResolvedValue(true);
      vi.spyOn(profileRepository, 'findHistoryByParticipantId').mockResolvedValue([]);

      const res = await request(app)
        .delete('/api/profiles/me/history/hist-1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Hackathon history record removed.');
      expect(res.body.deletedId).toBe('hist-1');
      expect(res.body.hackathonCount).toBe(0);
    });
  });

  describe('GET /api/profiles/:participantId/history', () => {
    it('returns target participant history for authenticated viewer', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(ownerParticipant);
      vi.spyOn(profileRepository, 'areConfirmedTeammates').mockResolvedValue(false);
      vi.spyOn(profileRepository, 'findHistoryByParticipantId').mockResolvedValue([sampleEntry]);

      const res = await request(app)
        .get('/api/profiles/part-owner-1/history')
        .set('Authorization', 'Bearer valid-other-token');

      expect(res.status).toBe(200);
      expect(res.body.participantId).toBe('part-owner-1');
      expect(res.body.viewerCategory).toBe('PART');
      expect(res.body.hackathonCount).toBe(1);
      expect(res.body.isSelfReported).toBe(true);
      expect(res.body.history).toHaveLength(1);
    });

    it('rejects cross-account mutation attempt on /:participantId/history with 403', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

      const res = await request(app)
        .post('/api/profiles/part-owner-1/history')
        .set('Authorization', 'Bearer valid-other-token')
        .send({
          eventName: 'Hacking',
          eventDate: '2025-01-01',
          teamRole: 'Backend',
          projectTitle: 'Proj',
          projectUrl: 'https://example.com/p',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_HISTORY_EDIT');
    });
  });
});
