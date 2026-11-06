import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  authorizeLockedTeamManifestMember,
  exportLockedTeamManifest,
  verifyLockedTeamManifestChecksum,
  refreshLockedTeamManifestsAfterPseudonymization,
  type TeamManifestDependencies,
} from './teamManifest.js';
import { TeamServiceError } from './teamErrors.js';
import type { Team, Participant } from '../db/types.js';
import type { CanonicalRosterSnapshot } from '../db/teamManifestModel.js';

describe('teamManifest service (US-024 / #228 / FR-071 / FR-072)', () => {
  const actorId = '11111111-1111-1111-1111-111111111111';
  const otherMemberId = '22222222-2222-2222-2222-222222222222';
  const outsiderId = '33333333-3333-3333-3333-333333333333';
  const teamId = '00000000-0000-0000-0000-000000000001';
  const eventId = '99999999-9999-9999-9999-999999999999';

  const sampleActor: Participant = {
    id: actorId,
    firebase_uid: 'fb_actor',
    email: 'actor@example.com',
    full_name: 'Alice Chen',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };

  const sampleOtherMember: Participant = {
    id: otherMemberId,
    firebase_uid: 'fb_bob',
    email: 'bob@example.com',
    full_name: 'Bob Smith',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };

  const sampleTeam: Team = {
    id: teamId,
    event_id: eventId,
    owner_participant_id: actorId,
    name: 'Alpha Innovators',
    pitch: 'Building a verification tool',
    goal: 'Competitive',
    commitment_hours: 40,
    communication_link: null,
    recruitment_status: 'Locked',
    locked_at: '2026-10-20T15:30:00.000Z',
    disbanded_at: null,
    created_at: '2026-10-15T00:00:00.000Z',
    updated_at: '2026-10-20T15:30:00.000Z',
  };

  const sampleMembers = [
    {
      participant_id: actorId,
      role: 'Owner' as const,
      joined_at: '2026-10-15T10:00:00.000Z',
      handle: 'alice_c',
      full_name: 'Alice Chen',
    },
    {
      participant_id: otherMemberId,
      role: 'Member' as const,
      joined_at: '2026-10-16T11:00:00.000Z',
      handle: 'bob_s',
      full_name: 'Bob Smith',
    },
  ];

  let mockDeps: TeamManifestDependencies;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockDeps = {
      participantsRepo: {
        findById: vi.fn().mockImplementation(async (id: string) => {
          if (id === actorId) return sampleActor;
          if (id === otherMemberId) return sampleOtherMember;
          return null;
        }),
      } as unknown as TeamManifestDependencies['participantsRepo'],

      teamsRepo: {
        getTeamViewParts: vi.fn().mockResolvedValue({
          team: { ...sampleTeam },
          event: { min_team_size: 2, max_team_size: 4 },
          members: [...sampleMembers],
          vacancies: [],
        }),
        listConfirmedParticipantIdsForTeam: vi.fn().mockResolvedValue([actorId, otherMemberId]),
      } as unknown as TeamManifestDependencies['teamsRepo'],

      profileRepo: {
        getFullProfile: vi.fn().mockImplementation(async (id: string) => {
          if (id === actorId) {
            return {
              profile: {
                participant_id: id,
                handle: 'alice_c',
                primary_role: 'Frontend',
                institution: 'Centennial College',
                shared_contact_handle: 'secret_discord_alice',
                created_at: '2026-10-15T00:00:00.000Z',
                updated_at: '2026-10-15T00:00:00.000Z',
              },
              skills: [],
              portfolios: [
                {
                  id: 'port_1',
                  participant_id: id,
                  label: 'GitHub',
                  url: 'https://github.com/alice',
                  created_at: '2026-10-15T00:00:00.000Z',
                  updated_at: '2026-10-15T00:00:00.000Z',
                },
              ],
            };
          }
          return {
            profile: {
              participant_id: id,
              handle: 'bob_s',
              primary_role: 'Backend',
              institution: null,
              shared_contact_handle: 'secret_phone_bob',
              created_at: '2026-10-15T00:00:00.000Z',
              updated_at: '2026-10-15T00:00:00.000Z',
            },
            skills: [],
            portfolios: [],
          };
        }),
      } as unknown as TeamManifestDependencies['profileRepo'],

      manifestRepo: {
        getLatestManifestByTeamId: vi.fn().mockResolvedValue(null),
        findSnapshotByChecksum: vi.fn().mockResolvedValue(null),
        saveManifestSnapshot: vi.fn().mockResolvedValue(undefined),
        listSnapshotsByTeamId: vi.fn().mockResolvedValue([]),
      } as unknown as TeamManifestDependencies['manifestRepo'],

      getSupabaseClient: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { title: 'Centennial Hackathon 2026' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
  });

  describe('authorizeLockedTeamManifestMember', () => {
    it('authorizes active verified confirmed member of locked team (US-024 AC 1)', async () => {
      const result = await authorizeLockedTeamManifestMember(actorId, teamId, mockDeps);
      expect(result.actor.id).toBe(actorId);
      expect(result.viewParts.team.id).toBe(teamId);
    });

    it('rejects unverified or deactivated participants', async () => {
      vi.mocked(mockDeps.participantsRepo.findById).mockResolvedValue({
        ...sampleActor,
        is_verified: false,
      });

      await expect(authorizeLockedTeamManifestMember(actorId, teamId, mockDeps)).rejects.toThrow(
        TeamServiceError
      );
      await expect(authorizeLockedTeamManifestMember(actorId, teamId, mockDeps)).rejects.toMatchObject({
        code: 'MANIFEST_ACCESS_DENIED',
      });
    });

    it('rejects if team is not locked (recruitment_status !== "Locked" or locked_at is null)', async () => {
      vi.mocked(mockDeps.teamsRepo.getTeamViewParts).mockResolvedValue({
        team: { ...sampleTeam, recruitment_status: 'Open', locked_at: null },
        event: { min_team_size: 2, max_team_size: 4 },
        members: [...sampleMembers],
        vacancies: [],
      });

      await expect(authorizeLockedTeamManifestMember(actorId, teamId, mockDeps)).rejects.toThrow(
        TeamServiceError
      );
      await expect(authorizeLockedTeamManifestMember(actorId, teamId, mockDeps)).rejects.toMatchObject({
        code: 'MANIFEST_TEAM_NOT_LOCKED',
      });
    });

    it('rejects if participant is not a confirmed member of the team', async () => {
      vi.mocked(mockDeps.participantsRepo.findById).mockResolvedValue({
        ...sampleActor,
        id: outsiderId,
      });

      await expect(authorizeLockedTeamManifestMember(outsiderId, teamId, mockDeps)).rejects.toThrow(
        TeamServiceError
      );
      await expect(authorizeLockedTeamManifestMember(outsiderId, teamId, mockDeps)).rejects.toMatchObject({
        code: 'MANIFEST_ACCESS_DENIED',
      });
    });
  });

  describe('exportLockedTeamManifest', () => {
    it('generates canonical snapshot, computes checksum, and persists snapshot (happy path)', async () => {
      const payload = await exportLockedTeamManifest(actorId, teamId, mockDeps);

      expect(payload.teamId).toBe(teamId);
      expect(payload.snapshot.teamName).toBe('Alpha Innovators');
      expect(payload.snapshot.eventTitle).toBe('Centennial Hackathon 2026');
      expect(payload.snapshot.memberCount).toBe(2);

      // Checksum
      expect(payload.integrity.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(payload.integrity.organizerAcceptanceAssumed).toBe(false);

      // Members ordered: Owner first
      expect(payload.snapshot.members[0].participantId).toBe(actorId);
      expect(payload.snapshot.members[0].teamRole).toBe('Owner');
      expect(payload.snapshot.members[1].participantId).toBe(otherMemberId);
      expect(payload.snapshot.members[1].teamRole).toBe('Member');

      // Privacy scrubbing: email and sharedContactHandle are strictly stripped
      const rawPayload = payload as unknown as Record<string, unknown>;
      expect(rawPayload.email).toBeUndefined();
      expect(rawPayload.sharedContactHandle).toBeUndefined();
      expect(rawPayload.shared_contact_handle).toBeUndefined();

      // Verified save was called
      expect(mockDeps.manifestRepo.saveManifestSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId,
          checksum: payload.integrity.checksum,
          memberCount: 2,
        })
      );
    });
  });

  describe('verifyLockedTeamManifestChecksum', () => {
    it('verifies matching checksum against current stored snapshot', async () => {
      const payload = await exportLockedTeamManifest(actorId, teamId, mockDeps);
      const result = await verifyLockedTeamManifestChecksum(
        actorId,
        teamId,
        payload.integrity.checksum,
        mockDeps
      );

      expect(result.valid).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(true);
      expect(result.matchesCurrentSnapshot).toBe(true);
      expect(result.message).toContain('Checksum matches the stored server record');
    });

    it('verifies historical snapshot when candidate matches a prior record', async () => {
      const historicalHex = 'sha256:0000000000000000000000000000000000000000000000000000000000000001';
      vi.mocked(mockDeps.manifestRepo.findSnapshotByChecksum).mockResolvedValue({
        id: 'hist-id',
        team_id: teamId,
        schema_version: '1.0',
        locked_at: sampleTeam.locked_at!,
        member_count: 2,
        snapshot_json: {} as unknown as CanonicalRosterSnapshot,
        canonical_json: '{}',
        checksum: historicalHex,
        recorded_by: actorId,
        created_at: '2026-10-18T00:00:00.000Z',
      });

      const result = await verifyLockedTeamManifestChecksum(
        actorId,
        teamId,
        historicalHex,
        mockDeps
      );

      expect(result.valid).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(true);
      expect(result.matchesCurrentSnapshot).toBe(false);
      expect(result.matchesHistoricalSnapshot).toBe(true);
      expect(result.message).toContain('previous historical snapshot');
    });

    it('returns mismatch for unrecognized checksum', async () => {
      const unrecognized = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      const result = await verifyLockedTeamManifestChecksum(
        actorId,
        teamId,
        unrecognized,
        mockDeps
      );

      expect(result.valid).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(false);
      expect(result.message).toContain('does not match any stored server snapshot');
    });

    it('handles malformed candidate checksum gracefully', async () => {
      const result = await verifyLockedTeamManifestChecksum(
        actorId,
        teamId,
        'not-valid-hex',
        mockDeps
      );

      expect(result.valid).toBe(false);
      expect(result.matchesStoredSnapshot).toBe(false);
      expect(result.message).toContain('valid 64-character SHA-256');
    });
  });

  describe('refreshLockedTeamManifestsAfterPseudonymization', () => {
    it('regenerates and saves snapshot for locked teams without throwing', async () => {
      await expect(
        refreshLockedTeamManifestsAfterPseudonymization([teamId], mockDeps)
      ).resolves.not.toThrow();

      expect(mockDeps.manifestRepo.saveManifestSnapshot).toHaveBeenCalled();
    });
  });
});
