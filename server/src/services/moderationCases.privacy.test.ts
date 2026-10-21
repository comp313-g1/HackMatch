import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getModerationCaseDetail, listModerationActionRecords } from './moderationCases.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { MODERATION_PRIVACY_NOTICE } from './moderationPrivacy.js';
import type { ModerationCase, Participant, Team } from '../db/types.js';

describe('moderation case privacy boundaries (US-026 / #245)', () => {
  const part: Participant = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    firebase_uid: 'fb-part-1',
    email: 'part@example.com',
    full_name: 'Ada Lovelace',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const team: Team = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    owner_participant_id: part.id,
    name: 'Phishy',
    pitch: 'Pitch',
    goal: 'Learning',
    commitment_hours: 10,
    communication_link: 'https://evil.example/x',
    recruitment_status: 'Open',
    locked_at: null,
    disbanded_at: null,
    created_at: '2026-10-18T01:00:00.000Z',
    updated_at: '2026-10-18T01:00:00.000Z',
  };

  const openCase: ModerationCase = {
    id: '11111111-1111-4111-8111-111111111111',
    target_type: 'team',
    target_id: team.id,
    reason: 'Spam',
    status: 'Open',
    created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    report_count: 0,
    flagged_url: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns sanitized team detail with privacy flags and no private contacts', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(part);
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: part.id,
      handle: 'ada',
      primary_role: 'Frontend',
      institution: null,
      shared_contact_handle: 'secret-discord#999',
      created_at: '2026-10-18T00:00:00.000Z',
      updated_at: '2026-10-18T00:00:00.000Z',
    });

    const detail = await getModerationCaseDetail(openCase.id);

    expect(detail.privacy).toEqual({
      credentialsIncluded: false,
      privateContactsIncluded: false,
      privateWorkspaceAccessGranted: false,
      notice: MODERATION_PRIVACY_NOTICE,
    });
    expect(detail.target.type).toBe('team');
    if (detail.target.type === 'team') {
      expect(detail.target.team.ownerHandle).toBe('ada');
    }
    const payload = JSON.stringify(detail);
    expect(payload).not.toMatch(/secret-discord|part@example\.com|fb-part-1/i);
    expect(detail.privacy.privateWorkspaceAccessGranted).toBe(false);
  });

  it('scrubs nested private keys from stored action-record summaries', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    vi.spyOn(moderationRepository, 'listActionRecordsForCase').mockResolvedValue([
      {
        id: 'rec-1',
        actor_id: openCase.created_by,
        target_type: 'moderation_team',
        target_id: team.id,
        action_type: 'moderation_hide',
        reason: 'Phishing',
        outcome: 'listing_hidden',
        safe_state_summary: {
          effects: {
            email: 'should-not-leak@example.com',
            shared_contact_handle: 'secret',
            workspaceNote: 'private note body',
            membershipsPreserved: true,
          },
        },
        created_at: '2026-10-18T12:00:00.000Z',
      },
    ]);

    const records = await listModerationActionRecords(openCase.id);

    expect(records).toHaveLength(1);
    expect(records[0]?.safeStateSummary.privateWorkspaceAccessGranted).toBe(false);
    expect(records[0]?.safeStateSummary.effects).toEqual({ membershipsPreserved: true });
    expect(JSON.stringify(records)).not.toMatch(
      /should-not-leak|shared_contact|workspaceNote|private note/i
    );
  });

  it('returns CASE_NOT_FOUND without leaking lookup internals (failure path)', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(null);
    await expect(getModerationCaseDetail(openCase.id)).rejects.toMatchObject({
      code: 'CASE_NOT_FOUND',
      status: 404,
    });
  });
});
