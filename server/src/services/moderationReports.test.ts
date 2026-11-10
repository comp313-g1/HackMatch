import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../db/client.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { chatRepository } from '../db/chat.repository.js';
import {
  clearModerationReportsStore,
  moderationReportsRepository,
} from '../db/moderationReports.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type {
  ChatChannel,
  ChatMessage,
  ModerationCase,
  Participant,
  Team,
} from '../db/types.js';
import {
  ReportServiceError,
  submitParticipantReport,
  verifyReportableTarget,
} from './moderationReports.js';

vi.mock('../db/client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('moderationReports service (US-025 / #235 / #237)', () => {
  const reporterId = '11111111-1111-4111-8111-111111111111';
  const targetId = '22222222-2222-4222-8222-222222222222';
  const testNow = new Date('2026-11-06T12:00:00.000Z');
  const channelId = '33333333-3333-4333-8333-333333333333';
  const teamId = '44444444-4444-4444-8444-444444444444';

  const publicChannel: ChatChannel = {
    id: channelId,
    title: 'General',
    description: 'Public participant forum',
    created_by: reporterId,
    channel_type: 'public',
    team_id: null,
    created_at: '2026-11-06T10:00:00.000Z',
    updated_at: '2026-11-06T10:00:00.000Z',
  };

  const targetMessage: ChatMessage = {
    id: targetId,
    channel_id: channelId,
    author_id: '99999999-9999-4999-8999-999999999999',
    body: 'Visible message content',
    created_at: '2026-11-06T11:00:00.000Z',
  };

  const mockTeam: Team = {
    id: targetId,
    event_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    owner_participant_id: '99999999-9999-4999-8999-999999999999',
    name: 'Alpha Team',
    pitch: 'Test team pitch',
    goal: 'Competitive',
    commitment_hours: 10,
    communication_link: 'https://discord.gg/alphateam',
    recruitment_status: 'Open',
    locked_at: null,
    disbanded_at: null,
    moderation_status: 'None',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };

  const mockTargetParticipant: Participant = {
    id: targetId,
    firebase_uid: 'uid-target-part',
    email: 'target@example.com',
    full_name: 'Target User',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearModerationReportsStore();
    vi.mocked(getSupabaseClient).mockImplementation(() => {
      throw new Error('Supabase client unconfigured in unit test');
    });
  });

  describe('verifyReportableTarget', () => {
    it('allows a public-forum message after resolving its persisted channel', async () => {
      vi.spyOn(chatRepository, 'findMessageById').mockResolvedValue(targetMessage);
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(publicChannel);

      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'chat_message',
          targetId,
          category: 'Harassment',
          explanation: 'Abusive public message',
          flaggedUrl: null,
        })
      ).resolves.toBeUndefined();
    });

    it('allows a private team message only for a current confirmed team member', async () => {
      const teamChannel: ChatChannel = {
        ...publicChannel,
        channel_type: 'team',
        team_id: teamId,
      };
      vi.spyOn(chatRepository, 'findMessageById').mockResolvedValue(targetMessage);
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(teamChannel);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue({
        ...mockTargetParticipant,
        id: reporterId,
      });
      vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
        reporterId,
      ]);

      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'chat_message',
          targetId,
          category: 'Harassment',
          explanation: null,
          flaggedUrl: null,
        })
      ).resolves.toBeUndefined();
    });

    it('conceals a private team message from an unrelated participant', async () => {
      const teamChannel: ChatChannel = {
        ...publicChannel,
        channel_type: 'team',
        team_id: teamId,
      };
      vi.spyOn(chatRepository, 'findMessageById').mockResolvedValue(targetMessage);
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(teamChannel);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue({
        ...mockTargetParticipant,
        id: reporterId,
      });
      vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([]);

      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'chat_message',
          targetId,
          category: 'Harassment',
          explanation: null,
          flaggedUrl: null,
        })
      ).rejects.toMatchObject({ status: 404, code: 'TARGET_NOT_FOUND' });
    });

    it('uses the same unavailable response for stale IDs and unsupported direct-message IDs', async () => {
      vi.spyOn(chatRepository, 'findMessageById').mockResolvedValue(null);

      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'chat_message',
          targetId,
          category: 'Harassment',
          explanation: null,
          flaggedUrl: null,
        })
      ).rejects.toMatchObject({
        status: 404,
        code: 'TARGET_NOT_FOUND',
        message: 'The specified chat message is not available for reporting.',
      });
    });

    it('allows a visible team listing', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(mockTeam);

      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'team',
          targetId,
          category: 'Spam',
          explanation: null,
          flaggedUrl: null,
        })
      ).resolves.toBeUndefined();
    });

    it('rejects a hidden or disbanded team with 404 TARGET_NOT_FOUND', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue({
        ...mockTeam,
        moderation_status: 'Hidden',
      });

      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'team',
          targetId,
          category: 'Spam',
          explanation: null,
          flaggedUrl: null,
        })
      ).rejects.toThrow(ReportServiceError);

      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue({
        ...mockTeam,
        recruitment_status: 'Disbanded',
      });

      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'team',
          targetId,
          category: 'Spam',
          explanation: null,
          flaggedUrl: null,
        })
      ).rejects.toThrow(ReportServiceError);
    });

    it('forbids self-reporting on profiles with 403 SELF_REPORT_FORBIDDEN', async () => {
      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'profile',
          targetId: reporterId,
          category: 'Harassment',
          explanation: null,
          flaggedUrl: null,
        })
      ).rejects.toThrow(ReportServiceError);

      try {
        await verifyReportableTarget(reporterId, {
          targetType: 'profile',
          targetId: reporterId,
          category: 'Harassment',
          explanation: null,
          flaggedUrl: null,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ReportServiceError);
        expect((err as ReportServiceError).status).toBe(403);
        expect((err as ReportServiceError).code).toBe('SELF_REPORT_FORBIDDEN');
      }
    });

    it('rejects suspended or deactivated profiles with 404 TARGET_NOT_FOUND', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue({
        ...mockTargetParticipant,
        is_suspended: true,
      });

      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'profile',
          targetId,
          category: 'Fake Account',
          explanation: null,
          flaggedUrl: null,
        })
      ).rejects.toThrow(ReportServiceError);
    });

    it('allows a published event target and rejects unpublished events', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValueOnce({
                  data: { id: targetId, status: 'Published' },
                  error: null,
                })
                .mockResolvedValueOnce({
                  data: { id: targetId, status: 'Draft' },
                  error: null,
                }),
            }),
          }),
        }),
      };
      vi.mocked(getSupabaseClient).mockReturnValue(
        mockSupabase as unknown as ReturnType<typeof getSupabaseClient>
      );

      // 1st call: Published -> passes
      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'event',
          targetId,
          category: 'Spam',
          explanation: null,
          flaggedUrl: null,
        })
      ).resolves.toBeUndefined();

      // 2nd call: Draft -> throws 404
      await expect(
        verifyReportableTarget(reporterId, {
          targetType: 'event',
          targetId,
          category: 'Spam',
          explanation: null,
          flaggedUrl: null,
        })
      ).rejects.toThrow(ReportServiceError);
    });
  });

  describe('submitParticipantReport', () => {
    it('connects an eligible message report to the existing moderation pipeline', async () => {
      vi.spyOn(chatRepository, 'findMessageById').mockResolvedValue(targetMessage);
      vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue(publicChannel);
      vi.spyOn(moderationRepository, 'findOpenCaseByTarget').mockResolvedValue(null);
      const createdCase: ModerationCase = {
        id: '55555555-5555-4555-8555-555555555555',
        target_type: 'chat_message',
        target_id: targetId,
        reason: '[Harassment] Abusive visible message',
        status: 'Open',
        created_by: reporterId,
        report_count: 1,
        flagged_url: null,
        created_at: testNow.toISOString(),
        updated_at: testNow.toISOString(),
      };
      const createCase = vi
        .spyOn(moderationRepository, 'createCase')
        .mockResolvedValue(createdCase);

      const receipt = await submitParticipantReport(
        reporterId,
        {
          targetType: 'chat_message',
          targetId,
          category: 'Harassment',
          explanation: 'Abusive visible message',
          flaggedUrl: null,
        },
        { now: () => testNow }
      );

      expect(createCase).toHaveBeenCalledWith(
        expect.objectContaining({
          target_type: 'chat_message',
          target_id: targetId,
          report_count: 1,
        })
      );
      expect(receipt).toMatchObject({
        caseId: createdCase.id,
        targetType: 'chat_message',
        targetId,
        category: 'Harassment',
        status: 'Received',
      });
      const reports = await moderationReportsRepository.findReportsByReporterSince(
        reporterId,
        new Date(testNow.getTime() - 1000)
      );
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        target_type: 'chat_message',
        target_id: targetId,
        case_id: createdCase.id,
      });
    });

    it('creates a new US-026 moderation case and returns a receipt confirmation when no case exists', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(mockTeam);
      vi.spyOn(moderationRepository, 'findOpenCaseByTarget').mockResolvedValue(
        null
      );

      const createdCase: ModerationCase = {
        id: '44444444-4444-4444-8444-444444444444',
        target_type: 'team',
        target_id: targetId,
        reason: '[Harassment] Inappropriate team pitch',
        status: 'Open',
        created_by: reporterId,
        report_count: 1,
        flagged_url: null,
        created_at: testNow.toISOString(),
        updated_at: testNow.toISOString(),
      };
      const createCaseSpy = vi
        .spyOn(moderationRepository, 'createCase')
        .mockResolvedValue(createdCase);

      const receipt = await submitParticipantReport(
        reporterId,
        {
          targetType: 'team',
          targetId,
          category: 'Harassment',
          explanation: 'Inappropriate team pitch',
          flaggedUrl: null,
        },
        { now: () => testNow }
      );

      expect(createCaseSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          target_type: 'team',
          target_id: targetId,
          report_count: 1,
        })
      );

      expect(receipt).toEqual({
        reportId: expect.any(String),
        caseId: createdCase.id,
        targetType: 'team',
        targetId,
        category: 'Harassment',
        status: 'Received',
        submittedAt: testNow.toISOString(),
        confirmationMessage:
          'Your report has been received and queued for administrator review.',
        rateLimit: {
          limit: 5,
          remaining: 4,
          windowSeconds: 3600,
        },
      });

      // Verify the report was actually persisted in repository
      const reports =
        await moderationReportsRepository.findReportsByReporterSince(
          reporterId,
          new Date(testNow.getTime() - 1000)
        );
      expect(reports).toHaveLength(1);
      expect(reports[0].case_id).toBe(createdCase.id);
    });

    it('increments report_count on an existing open case rather than duplicating the case', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(mockTeam);

      const existingCase: ModerationCase = {
        id: '55555555-5555-4555-8555-555555555555',
        target_type: 'team',
        target_id: targetId,
        reason: '[Spam] Initial report',
        status: 'Open',
        created_by: '88888888-8888-4888-8888-888888888888',
        report_count: 2,
        flagged_url: null,
        created_at: testNow.toISOString(),
        updated_at: testNow.toISOString(),
      };
      vi.spyOn(moderationRepository, 'findOpenCaseByTarget').mockResolvedValue(
        existingCase
      );

      const incrementSpy = vi
        .spyOn(moderationRepository, 'incrementCaseReportCount')
        .mockResolvedValue({
          ...existingCase,
          report_count: 3,
        });
      const createCaseSpy = vi.spyOn(moderationRepository, 'createCase');

      const receipt = await submitParticipantReport(
        reporterId,
        {
          targetType: 'team',
          targetId,
          category: 'Spam',
          explanation: 'Another report',
          flaggedUrl: null,
        },
        { now: () => testNow }
      );

      expect(incrementSpy).toHaveBeenCalledWith(existingCase.id);
      expect(createCaseSpy).not.toHaveBeenCalled();
      expect(receipt.caseId).toBe(existingCase.id);
      expect(receipt.rateLimit.remaining).toBe(4);
    });
  });
});
