import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moderationRepository } from '../db/moderation.repository.js';
import { moderationTargetRepository } from '../db/moderationTarget.repository.js';
import type { ModerationCase, ModerationTargetType } from '../db/types.js';
import {
  createModerationCase,
  loadSanitizedTarget,
} from './moderationCases.js';

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const channelId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';

function caseRow(targetType: ModerationTargetType, targetId: string): ModerationCase {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    target_type: targetType,
    target_id: targetId,
    reason: 'Abusive chat content',
    status: 'Open',
    created_by: adminId,
    report_count: 0,
    flagged_url: null,
    created_at: '2026-11-10T00:00:00.000Z',
    updated_at: '2026-11-10T00:00:00.000Z',
  };
}

describe('chat moderation target validation (US-033 / #392)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['chat_channel', channelId, 'chatChannelExists'],
    ['chat_message', messageId, 'chatMessageExists'],
  ] as const)('creates a case only after the %s target resolves', async (targetType, targetId, lookup) => {
    vi.spyOn(moderationTargetRepository, lookup).mockResolvedValue(true);
    const createSpy = vi
      .spyOn(moderationRepository, 'createCase')
      .mockResolvedValue(caseRow(targetType, targetId));

    const result = await createModerationCase({
      actorParticipantId: adminId,
      actorRole: 'ADMIN',
      targetType,
      targetId,
      reason: 'Abusive chat content',
    });

    expect(result).toMatchObject({ targetType, targetId });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        target_type: targetType,
        target_id: targetId,
        flagged_url: null,
      })
    );
  });

  it('rejects a valid channel UUID when it is labelled as a chat message', async () => {
    const channelLookup = vi
      .spyOn(moderationTargetRepository, 'chatChannelExists')
      .mockResolvedValue(true);
    vi.spyOn(moderationTargetRepository, 'chatMessageExists').mockResolvedValue(false);
    const createSpy = vi.spyOn(moderationRepository, 'createCase');

    await expect(
      createModerationCase({
        actorParticipantId: adminId,
        actorRole: 'ADMIN',
        targetType: 'chat_message',
        targetId: channelId,
        reason: 'Wrong entity type',
      })
    ).rejects.toMatchObject({ status: 404, code: 'TARGET_NOT_FOUND' });

    expect(channelLookup).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns only an identity reference until privacy-safe evidence ships in #394', async () => {
    vi.spyOn(moderationTargetRepository, 'chatMessageExists').mockResolvedValue(true);

    const target = await loadSanitizedTarget('chat_message', messageId, null);

    expect(target).toEqual({
      type: 'chat_message',
      chatMessage: { id: messageId },
    });
    expect(JSON.stringify(target)).not.toMatch(/body|email|author|credential|token|otp/i);
  });
});
