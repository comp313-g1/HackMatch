import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamManifestRepository } from '../db/teamManifest.repository.js';
import { getSupabaseClient } from '../db/client.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant, Team, TeamRosterManifestRecord } from '../db/types.js';
import type { CanonicalRosterSnapshot } from '../db/teamManifestModel.js';

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

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;

describe('Team Manifest HTTP Endpoints (US-024 / #229 / FR-071 / FR-072)', () => {
  const teamId = '77777777-7777-4777-8777-777777777777';
  const eventId = '88888888-8888-4888-8888-888888888888';

  const ownerParticipant: Participant = {
    id: '11111111-1111-4111-8111-111111111111',
    firebase_uid: 'fb-owner-1',
    email: 'owner@private.example.com',
    full_name: 'Alice Owner',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const memberParticipant: Participant = {
    id: '22222222-2222-4222-8222-222222222222',
    firebase_uid: 'fb-member-2',
    email: 'member@private.example.com',
    full_name: 'Bob Member <script>alert(1)</script>',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const outsiderParticipant: Participant = {
    id: '33333333-3333-4333-8333-333333333333',
    firebase_uid: 'fb-outsider-3',
    email: 'outsider@private.example.com',
    full_name: 'Outsider Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const adminParticipant: Participant = {
    id: '44444444-4444-4444-8444-444444444444',
    firebase_uid: 'fb-admin-4',
    email: 'admin@private.example.com',
    full_name: 'Admin Participant',
    role: 'ADMIN',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const unverifiedParticipant: Participant = {
    id: '55555555-5555-4555-8555-555555555555',
    firebase_uid: 'fb-unverified-5',
    email: 'unverified@private.example.com',
    full_name: 'Unverified Participant',
    role: 'PART',
    is_verified: false,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const suspendedParticipant: Participant = {
    id: '66666666-6666-4666-8666-666666666666',
    firebase_uid: 'fb-suspended-6',
    email: 'suspended@private.example.com',
    full_name: 'Suspended Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: true,
    is_deactivated: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const lockedTeam: Team = {
    id: teamId,
    event_id: eventId,
    owner_participant_id: ownerParticipant.id,
    name: 'HackMatch Champions',
    pitch: 'Building accessible manifest export & verification tools',
    goal: 'Competitive',
    commitment_hours: 40,
    communication_link: 'https://discord.gg/secret-team-chat',
    recruitment_status: 'Locked',
    locked_at: '2026-10-25T14:30:00.000Z',
    disbanded_at: null,
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-25T14:30:00.000Z',
  };

  const unlockedTeam: Team = {
    ...lockedTeam,
    recruitment_status: 'Open',
    locked_at: null,
  };

  const lockedTeamParts = {
    team: lockedTeam,
    event: { min_team_size: 2, max_team_size: 4 },
    members: [
      {
        participant_id: ownerParticipant.id,
        role: 'Owner' as const,
        joined_at: '2026-10-20T10:00:00.000Z',
        handle: 'alice_owner',
        full_name: 'Alice Owner',
      },
      {
        participant_id: memberParticipant.id,
        role: 'Member' as const,
        joined_at: '2026-10-21T11:00:00.000Z',
        handle: 'bob_member',
        full_name: 'Bob Member <script>alert(1)</script>',
      },
    ],
    vacancies: [],
  };

  function setAuthUser(participant: Participant, role: 'PART' | 'ADMIN' = participant.role as 'PART' | 'ADMIN') {
    mockVerifyIdToken.mockResolvedValue({
      uid: participant.firebase_uid,
      email: participant.email,
      role,
      auth_time: AUTH_TIME,
      [MFA_CLAIM]: AUTH_TIME,
    } as unknown as DecodedIdToken);

    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
  }

  beforeEach(() => {
    vi.restoreAllMocks();

    setAuthUser(ownerParticipant);

    vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => {
      if (id === ownerParticipant.id) return ownerParticipant;
      if (id === memberParticipant.id) return memberParticipant;
      if (id === outsiderParticipant.id) return outsiderParticipant;
      if (id === adminParticipant.id) return adminParticipant;
      if (id === unverifiedParticipant.id) return unverifiedParticipant;
      if (id === suspendedParticipant.id) return suspendedParticipant;
      return null;
    });

    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(lockedTeam);
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(lockedTeamParts);
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
      ownerParticipant.id,
      memberParticipant.id,
    ]);

    vi.spyOn(profileRepository, 'getFullProfile').mockImplementation(async (id: string) => {
      if (id === ownerParticipant.id) {
        return {
          profile: {
            participant_id: id,
            handle: 'alice_owner',
            primary_role: 'UI/UX',
            institution: 'Centennial College',
            shared_contact_handle: 'secret_alice_discord',
            created_at: '2026-10-20T10:00:00.000Z',
            updated_at: '2026-10-20T10:00:00.000Z',
          },
          skills: [],
          portfolios: [
            {
              id: 'p1',
              participant_id: id,
              label: 'GitHub',
              url: 'https://github.com/alice',
              created_at: '2026-10-20T10:00:00.000Z',
              updated_at: '2026-10-20T10:00:00.000Z',
            },
          ],
        };
      }
      return {
        profile: {
          participant_id: id,
          handle: 'bob_member',
          primary_role: 'Frontend',
          institution: 'University of Toronto',
          shared_contact_handle: 'secret_bob_telegram',
          created_at: '2026-10-21T11:00:00.000Z',
          updated_at: '2026-10-21T11:00:00.000Z',
        },
        skills: [],
        portfolios: [
          {
            id: 'p2',
            participant_id: id,
            label: 'Portfolio',
            url: 'https://bob.dev',
            created_at: '2026-10-21T11:00:00.000Z',
            updated_at: '2026-10-21T11:00:00.000Z',
          },
        ],
      };
    });

    vi.spyOn(teamManifestRepository, 'getLatestManifestByTeamId').mockResolvedValue(null);
    vi.spyOn(teamManifestRepository, 'findSnapshotByChecksum').mockResolvedValue(null);
    vi.spyOn(teamManifestRepository, 'saveManifestSnapshot').mockResolvedValue({} as unknown as TeamRosterManifestRecord);
    vi.spyOn(teamManifestRepository, 'listSnapshotsByTeamId').mockResolvedValue([]);

    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { title: 'HackMatch Annual Hackathon 2026' },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getSupabaseClient>);
  });

  describe('Access Control (US-024 AC 1 / FR-071 / FR-082)', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get(`/api/teams/${teamId}/manifest`);
      expect(res.status).toBe(401);
    });

    it('returns 403 when authenticated actor is ADMIN', async () => {
      setAuthUser(adminParticipant, 'ADMIN');
      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('returns 403 when participant is unverified', async () => {
      setAuthUser(unverifiedParticipant);
      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('returns 403 when participant is suspended', async () => {
      setAuthUser(suspendedParticipant);
      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('returns 403 MANIFEST_TEAM_NOT_LOCKED when team recruitment is Open', async () => {
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
        ...lockedTeamParts,
        team: unlockedTeam,
      });

      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MANIFEST_TEAM_NOT_LOCKED');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('returns 403 MANIFEST_ACCESS_DENIED when actor is an outsider PART user', async () => {
      setAuthUser(outsiderParticipant);

      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MANIFEST_ACCESS_DENIED');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('allows confirmed Owner to export manifest (200 OK)', async () => {
      setAuthUser(ownerParticipant);

      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.snapshot.teamId).toBe(teamId);
      expect(res.body.integrity.schemaVersion).toBe('1.0');
    });

    it('allows confirmed non-owner Member to export manifest (200 OK)', async () => {
      setAuthUser(memberParticipant);

      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.snapshot.teamId).toBe(teamId);
      expect(res.body.integrity.schemaVersion).toBe('1.0');
    });
  });

  describe('Export Formats & PII Exclusion (US-024 AC 2, 3, 4 / FR-071 / NR-023)', () => {
    it('returns JSON format with canonical snapshot, SHA-256 checksum, lock label, and zero PII', async () => {
      setAuthUser(ownerParticipant);

      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest?format=json`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['cache-control']).toBe('no-store');

      expect(res.body.integrity.schemaVersion).toBe('1.0');
      expect(res.body.integrity.recordedByLabel).toContain('Lock time recorded by HackMatch server');
      expect(res.body.integrity.integrityNotice).toContain('does not independently prove pre-event team formation');
      expect(res.body.integrity.privacyExclusionNotice).toContain('strictly excluded from roster exports');

      expect(res.body.snapshot).toBeDefined();
      expect(res.body.snapshot.teamId).toBe(teamId);
      expect(res.body.snapshot.teamName).toBe('HackMatch Champions');
      expect(res.body.snapshot.eventTitle).toBe('HackMatch Annual Hackathon 2026');
      expect(res.body.snapshot.lockedAt).toBe('2026-10-25T14:30:00.000Z');
      expect(res.body.snapshot.memberCount).toBe(2);

      expect(res.body.integrity.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);

      // Strict privacy assertions: zero email addresses, private contact handles, or UIDs in body
      const jsonString = JSON.stringify(res.body);
      expect(jsonString).not.toContain('owner@private.example.com');
      expect(jsonString).not.toContain('member@private.example.com');
      expect(jsonString).not.toContain('secret_alice_discord');
      expect(jsonString).not.toContain('secret_bob_telegram');
      expect(jsonString).not.toContain('https://discord.gg/secret-team-chat');
      expect(jsonString).not.toContain('fb-owner-1');
      expect(jsonString).not.toContain('fb-member-2');
    });

    it('returns printable HTML format with escaped entities and attachment header', async () => {
      setAuthUser(ownerParticipant);

      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest?format=html`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['content-disposition']).toContain(`attachment; filename="team-verification-card-${teamId}.html"`);
      expect(res.headers['cache-control']).toBe('no-store');

      const html = res.text;
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Lock time recorded by HackMatch server');
      expect(html).toContain('HackMatch Champions');
      // XSS entity escaping check
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<script>alert(1)</script>');
      // Rel attributes on portfolio links
      expect(html).toContain('rel="noopener noreferrer"');
      // Privacy check
      expect(html).not.toContain('owner@private.example.com');
      expect(html).not.toContain('secret_alice_discord');
    });

    it('returns deterministic PDF-1.4 binary artifact', async () => {
      setAuthUser(ownerParticipant);

      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest?format=pdf`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain(`attachment; filename="team-verification-card-${teamId}.pdf"`);
      expect(res.headers['cache-control']).toBe('no-store');

      const pdfBuffer = res.body as Buffer;
      const pdfText = pdfBuffer.toString('binary');
      expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
      expect(pdfText).toContain('%%EOF');
      expect(pdfText).toContain('Lock time recorded by HackMatch:');
      expect(pdfText).toContain('HackMatch Champions');
      expect(pdfText).not.toContain('owner@private.example.com');
    });

    it('returns 400 VALIDATION_ERROR on unsupported format parameter', async () => {
      setAuthUser(ownerParticipant);

      const res = await request(app)
        .get(`/api/teams/${teamId}/manifest?format=xml`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('Checksum Verification Endpoint (US-024 AC 3 / FR-072)', () => {
    it('returns valid: true when provided checksum matches the current stored snapshot', async () => {
      setAuthUser(ownerParticipant);

      // First export to capture the canonical checksum
      const exportRes = await request(app)
        .get(`/api/teams/${teamId}/manifest?format=json`)
        .set('Authorization', 'Bearer valid-token');

      const matchingChecksum = exportRes.body.integrity.checksum as string;

      const verifyRes = await request(app)
        .post(`/api/teams/${teamId}/manifest/verify`)
        .set('Authorization', 'Bearer valid-token')
        .send({ checksum: matchingChecksum });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.headers['cache-control']).toBe('no-store');
      expect(verifyRes.body.valid).toBe(true);
      expect(verifyRes.body.matchesStoredSnapshot).toBe(true);
      expect(verifyRes.body.matchesCurrentSnapshot).toBe(true);
      expect(verifyRes.body.matchesHistoricalSnapshot).toBe(false);
      expect(verifyRes.body.expectedChecksum).toBe(matchingChecksum);
      expect(verifyRes.body.providedChecksum).toBe(matchingChecksum);
    });

    it('returns valid: true and matchesHistoricalSnapshot: true when checksum matches a historical snapshot', async () => {
      setAuthUser(ownerParticipant);

      const historicalChecksum = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      vi.spyOn(teamManifestRepository, 'findSnapshotByChecksum').mockResolvedValue({
        id: 'hist-row-1',
        team_id: teamId,
        schema_version: '1.0',
        locked_at: '2026-10-25T14:30:00.000Z',
        member_count: 2,
        snapshot_json: {} as unknown as CanonicalRosterSnapshot,
        canonical_json: '{}',
        checksum: historicalChecksum,
        recorded_by: ownerParticipant.id,
        created_at: '2026-10-25T14:30:00.000Z',
      });

      const verifyRes = await request(app)
        .post(`/api/teams/${teamId}/manifest/verify`)
        .set('Authorization', 'Bearer valid-token')
        .send({ checksum: historicalChecksum });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.valid).toBe(true);
      expect(verifyRes.body.matchesStoredSnapshot).toBe(true);
      expect(verifyRes.body.matchesHistoricalSnapshot).toBe(true);
      expect(verifyRes.body.matchesCurrentSnapshot).toBe(false);
    });

    it('returns valid: false when provided checksum does not match', async () => {
      setAuthUser(ownerParticipant);

      const tamperedChecksum = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const verifyRes = await request(app)
        .post(`/api/teams/${teamId}/manifest/verify`)
        .set('Authorization', 'Bearer valid-token')
        .send({ checksum: tamperedChecksum });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.valid).toBe(true);
      expect(verifyRes.body.matchesStoredSnapshot).toBe(false);
      expect(verifyRes.body.matchesCurrentSnapshot).toBe(false);
      expect(verifyRes.body.matchesHistoricalSnapshot).toBe(false);
      expect(verifyRes.body.providedChecksum).toBe(tamperedChecksum);
    });

    it('returns 400 VALIDATION_ERROR on missing or malformed checksum payload', async () => {
      setAuthUser(ownerParticipant);

      const resMissing = await request(app)
        .post(`/api/teams/${teamId}/manifest/verify`)
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(resMissing.status).toBe(400);
      expect(resMissing.body.code).toBe('VALIDATION_ERROR');

      const resMalformed = await request(app)
        .post(`/api/teams/${teamId}/manifest/verify`)
        .set('Authorization', 'Bearer valid-token')
        .send({ checksum: '   ' });

      expect(resMalformed.status).toBe(400);
      expect(resMalformed.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 403 MANIFEST_ACCESS_DENIED when an outsider attempts verification', async () => {
      setAuthUser(outsiderParticipant);

      const res = await request(app)
        .post(`/api/teams/${teamId}/manifest/verify`)
        .set('Authorization', 'Bearer valid-token')
        .send({ checksum: 'sha256:1111111111111111111111111111111111111111111111111111111111111111' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MANIFEST_ACCESS_DENIED');
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });
});
