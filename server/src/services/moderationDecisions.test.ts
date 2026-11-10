import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LINK_REMOVAL_NOTICE,
  REDACTED_PITCH,
  decideModerationCase,
} from './moderationDecisions.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { getSupabaseClient } from '../db/client.js';
import type { ModerationCase, Team } from '../db/types.js';

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

const openCase: ModerationCase = {
  id: '11111111-1111-4111-8111-111111111111',
  target_type: 'team',
  target_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reason: 'Spam pitch',
  status: 'Open',
  created_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  report_count: 0,
  flagged_url: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

const team: Team = {
  id: openCase.target_id,
  event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  owner_participant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Phishy',
  pitch: 'Bad pitch',
  goal: 'Learning',
  commitment_hours: 10,
  communication_link: 'https://evil.example/phish',
  recruitment_status: 'Open',
  locked_at: null,
  disbanded_at: null,
  moderation_status: 'None',
  moderation_hidden_at: null,
  link_removal_notice: null,
  created_at: '2026-10-18T01:00:00.000Z',
  updated_at: '2026-10-18T01:00:00.000Z',
};

function mockClient(handlers: {
  teamsUpdate?: Record<string, unknown>;
  notificationsInsert?: boolean;
  eventsSelect?: { id: string; is_link_disabled: boolean; official_url: string } | null;
}) {
  const from = vi.fn((table: string) => {
    if (table === 'teams') {
      return {
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: handlers.teamsUpdate ?? {}, error: null })),
        })),
      };
    }
    if (table === 'participant_notifications') {
      return {
        insert: vi.fn(async () => ({ data: {}, error: null })),
      };
    }
    if (table === 'events') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: handlers.eventsSelect ?? null,
              error: null,
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: {}, error: null })),
        })),
      };
    }
    if (table === 'participant_profiles') {
      return {
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: {}, error: null })),
        })),
      };
    }
    return {};
  });
  vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);
  return from;
}

describe('decideModerationCase (US-026 / #242)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('dismisses an open case and writes an action record', async () => {
    mockClient({});
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    const insertSpy = vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-1',
      actor_id: openCase.created_by,
      target_type: 'moderation_team',
      target_id: openCase.target_id,
      action_type: 'moderation_dismiss',
      reason: 'Not actionable',
      outcome: 'case_dismissed',
      safe_state_summary: {},
      created_at: '2026-10-18T12:00:00.000Z',
    });
    vi.spyOn(moderationRepository, 'resolveCase').mockResolvedValue({
      ...openCase,
      status: 'Dismissed',
      last_action_type: 'dismiss',
      resolved_at: '2026-10-18T12:00:00.000Z',
    });

    const result = await decideModerationCase({
      actorParticipantId: openCase.created_by,
      actorRole: 'ADMIN',
      caseId: openCase.id,
      action: 'dismiss',
      reason: 'Not actionable',
    });

    expect(result.outcome).toBe('case_dismissed');
    expect(result.case.status).toBe('Dismissed');
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'moderation_dismiss',
        reason: 'Not actionable',
        safe_state_summary: expect.objectContaining({
          credentialsIncluded: false,
          privateContactsIncluded: false,
          privateWorkspaceAccessGranted: false,
        }),
      })
    );
  });

  it('redacts team pitch', async () => {
    const from = mockClient({ teamsUpdate: { pitch: REDACTED_PITCH } });
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team);
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-2',
      actor_id: openCase.created_by,
      target_type: 'moderation_team',
      target_id: openCase.target_id,
      action_type: 'moderation_redact',
      reason: 'Offensive pitch',
      outcome: 'content_redacted',
      safe_state_summary: {},
      created_at: '2026-10-18T12:00:00.000Z',
    });
    vi.spyOn(moderationRepository, 'resolveCase').mockResolvedValue({
      ...openCase,
      status: 'Resolved',
      last_action_type: 'redact',
      resolved_at: '2026-10-18T12:00:00.000Z',
    });

    const result = await decideModerationCase({
      actorParticipantId: openCase.created_by,
      actorRole: 'ADMIN',
      caseId: openCase.id,
      action: 'redact',
      reason: 'Offensive pitch',
    });

    expect(result.outcome).toBe('content_redacted');
    expect(from).toHaveBeenCalledWith('teams');
  });

  it('hides a team listing and preserves memberships in the summary', async () => {
    const from = mockClient({});
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team);
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-3',
      actor_id: openCase.created_by,
      target_type: 'moderation_team',
      target_id: openCase.target_id,
      action_type: 'moderation_hide',
      reason: 'Phishing listing',
      outcome: 'listing_hidden',
      safe_state_summary: {},
      created_at: '2026-10-18T12:00:00.000Z',
    });
    vi.spyOn(moderationRepository, 'resolveCase').mockResolvedValue({
      ...openCase,
      status: 'Resolved',
      last_action_type: 'hide',
      resolved_at: '2026-10-18T12:00:00.000Z',
    });

    const result = await decideModerationCase({
      actorParticipantId: openCase.created_by,
      actorRole: 'ADMIN',
      caseId: openCase.id,
      action: 'hide',
      reason: 'Phishing listing',
    });

    expect(result.outcome).toBe('listing_hidden');
    expect(result.safeStateSummary.effects).toEqual(
      expect.objectContaining({ membershipsPreserved: true, moderationStatus: 'Hidden' })
    );
    // US-026 / #244 — hide must never touch historical membership rows.
    expect(from).toHaveBeenCalledWith('teams');
    expect(from).not.toHaveBeenCalledWith('team_memberships');
  });

  it('disables a team communication link with removal notice', async () => {
    mockClient({
      eventsSelect: {
        id: team.event_id,
        is_link_disabled: false,
        official_url: 'https://other.example',
      },
    });
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue({
      ...openCase,
      target_type: 'url',
      flagged_url: 'https://evil.example/phish',
    });
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team);
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-4',
      actor_id: openCase.created_by,
      target_type: 'moderation_url',
      target_id: openCase.target_id,
      action_type: 'moderation_disable_url',
      reason: 'Confirmed phishing',
      outcome: 'url_disabled',
      safe_state_summary: {},
      created_at: '2026-10-18T12:00:00.000Z',
    });
    vi.spyOn(moderationRepository, 'resolveCase').mockResolvedValue({
      ...openCase,
      status: 'Resolved',
      last_action_type: 'disable_url',
      resolved_at: '2026-10-18T12:00:00.000Z',
    });

    const result = await decideModerationCase({
      actorParticipantId: openCase.created_by,
      actorRole: 'ADMIN',
      caseId: openCase.id,
      action: 'disable_url',
      reason: 'Confirmed phishing',
    });

    expect(result.outcome).toBe('url_disabled');
    expect(result.safeStateSummary.effects).toEqual(
      expect.objectContaining({
        communicationLinkRemoved: true,
        linkRemovalNotice: LINK_REMOVAL_NOTICE,
      })
    );
  });

  it('warns a team listing and notifies the owner', async () => {
    mockClient({});
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(openCase);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(team);
    vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-warn',
      actor_id: openCase.created_by,
      target_type: 'moderation_team',
      target_id: openCase.target_id,
      action_type: 'moderation_warn',
      reason: 'Borderline pitch',
      outcome: 'warning_recorded',
      safe_state_summary: {},
      created_at: '2026-10-18T12:00:00.000Z',
    });
    vi.spyOn(moderationRepository, 'resolveCase').mockResolvedValue({
      ...openCase,
      status: 'Resolved',
      last_action_type: 'warn',
      resolved_at: '2026-10-18T12:00:00.000Z',
    });

    const result = await decideModerationCase({
      actorParticipantId: openCase.created_by,
      actorRole: 'ADMIN',
      caseId: openCase.id,
      action: 'warn',
      reason: 'Borderline pitch',
    });

    expect(result.outcome).toBe('warning_recorded');
    expect(result.safeStateSummary.effects).toEqual(
      expect.objectContaining({ moderationStatus: 'Warned', ownerNotified: true })
    );
  });

  it('rejects decisions on already closed cases', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue({
      ...openCase,
      status: 'Dismissed',
    });
    await expect(
      decideModerationCase({
        actorParticipantId: openCase.created_by,
        actorRole: 'ADMIN',
        caseId: openCase.id,
        action: 'warn',
        reason: 'Too late',
      })
    ).rejects.toMatchObject({ code: 'CASE_CLOSED', status: 409 });
  });

  it('does not route a chat target through legacy team/profile mutations', async () => {
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue({
      ...openCase,
      target_type: 'chat_message',
    });
    const actionRecordSpy = vi.spyOn(moderationRepository, 'insertActionRecord');
    const resolveSpy = vi.spyOn(moderationRepository, 'resolveCase');
    const teamLookupSpy = vi.spyOn(teamsRepository, 'findTeamById');

    await expect(
      decideModerationCase({
        actorParticipantId: openCase.created_by,
        actorRole: 'ADMIN',
        caseId: openCase.id,
        action: 'redact',
        reason: 'Chat controls are not implemented yet',
      })
    ).rejects.toMatchObject({ code: 'INVALID_TARGET', status: 400 });

    expect(teamLookupSpy).not.toHaveBeenCalled();
    expect(actionRecordSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('dismisses a chat case with complete privacy-safe action metadata (#397)', async () => {
    mockClient({});
    const chatCase: ModerationCase = {
      ...openCase,
      target_type: 'chat_message',
      target_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      reason: '[Harassment] Participant report',
      report_count: 1,
    };
    vi.spyOn(moderationRepository, 'findById').mockResolvedValue(chatCase);
    const insertSpy = vi.spyOn(moderationRepository, 'insertActionRecord').mockResolvedValue({
      id: 'rec-chat-dismiss',
      actor_id: openCase.created_by,
      target_type: 'moderation_chat_message',
      target_id: chatCase.target_id,
      action_type: 'moderation_dismiss',
      reason: 'Reviewed; no actionable violation',
      outcome: 'case_dismissed',
      safe_state_summary: {},
      created_at: '2026-11-10T13:00:00.000Z',
    });
    const resolveSpy = vi.spyOn(moderationRepository, 'resolveCase').mockImplementation(
      async (_caseId, input) => ({
        ...chatCase,
        status: input.status,
        last_action_type: input.lastActionType,
        resolved_at: input.resolvedAt,
      })
    );

    const result = await decideModerationCase({
      actorParticipantId: openCase.created_by,
      actorRole: 'ADMIN',
      caseId: chatCase.id,
      action: 'dismiss',
      reason: 'Reviewed; no actionable violation',
    });

    expect(result).toMatchObject({
      action: 'dismiss',
      outcome: 'case_dismissed',
      case: { status: 'Dismissed', targetType: 'chat_message', targetId: chatCase.target_id },
    });
    expect(insertSpy).toHaveBeenCalledWith({
      actor_id: openCase.created_by,
      target_type: 'moderation_chat_message',
      target_id: chatCase.target_id,
      action_type: 'moderation_dismiss',
      reason: 'Reviewed; no actionable violation',
      outcome: 'case_dismissed',
      safe_state_summary: expect.objectContaining({
        caseId: chatCase.id,
        action: 'dismiss',
        outcome: 'case_dismissed',
        targetType: 'chat_message',
        targetId: chatCase.target_id,
        credentialsIncluded: false,
        privateContactsIncluded: false,
        privateWorkspaceAccessGranted: false,
        effects: {
          caseId: chatCase.id,
          targetType: 'chat_message',
          targetId: chatCase.target_id,
          status: 'Dismissed',
        },
      }),
    });
    expect(resolveSpy).toHaveBeenCalledWith(chatCase.id, {
      status: 'Dismissed',
      lastActionType: 'dismiss',
      resolvedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
    expect(JSON.stringify(result.safeStateSummary)).not.toMatch(
      /"(?:body|messageBody|participantEmail|email|password|otp|otp_hash|token|refresh_token|firebase_uid)"/i
    );
  });

  it('rejects a PART decision before loading the chat case (#397)', async () => {
    const lookupSpy = vi.spyOn(moderationRepository, 'findById');
    const actionRecordSpy = vi.spyOn(moderationRepository, 'insertActionRecord');

    await expect(
      decideModerationCase({
        actorParticipantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        actorRole: 'PART',
        caseId: openCase.id,
        action: 'dismiss',
        reason: 'Unauthorized attempt',
      })
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN_ROLE' });

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(actionRecordSpy).not.toHaveBeenCalled();
  });
});
