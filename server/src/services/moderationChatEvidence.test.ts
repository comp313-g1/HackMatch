import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moderationTargetRepository } from '../db/moderationTarget.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import {
  MODERATION_MESSAGE_CONTEXT_MAX_LENGTH,
  loadChatChannelEvidence,
  loadChatMessageEvidence,
  redactModerationText,
} from './moderationChatEvidence.js';

describe('privacy-safe chat moderation evidence (US-033 / #394)', () => {
  const channelId = '11111111-1111-4111-8111-111111111111';
  const messageId = '22222222-2222-4222-8222-222222222222';
  const authorId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('projects a private team channel through an explicit safe allowlist', async () => {
    vi.spyOn(moderationTargetRepository, 'findChatChannelEvidence').mockResolvedValue({
      id: channelId,
      title: 'Team room for owner@example.test',
      description: 'Never paste token=super-secret-token or OTP 123456 here',
      created_by: authorId,
      channel_type: 'team',
      created_at: '2026-11-10T08:30:00-05:00',
    });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: authorId,
      handle: 'safe_handle',
      primary_role: 'Backend',
      institution: 'Private institution',
      shared_contact_handle: 'private-contact',
      created_at: '2026-11-10T00:00:00.000Z',
      updated_at: '2026-11-10T00:00:00.000Z',
    });

    const result = await loadChatChannelEvidence(channelId);

    expect(result).toEqual({
      type: 'chat_channel',
      chatChannel: {
        id: channelId,
        availability: 'Available',
        channelType: 'team',
        title: 'Team room for [redacted email]',
        description: 'Never paste token: [redacted] or OTP: [redacted] here',
        creatorHandle: 'safe_handle',
        createdAt: '2026-11-10T13:30:00.000Z',
        contentRedacted: true,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /owner@example|super-secret-token|123456|private-contact|institution|created_by/i
    );
  });

  it('returns one redacted, bounded message context with handle and UTC time', async () => {
    const unrelatedConversation = 'UNRELATED_CONVERSATION_MUST_NOT_APPEAR';
    const longTail = 'ordinary context '.repeat(MODERATION_MESSAGE_CONTEXT_MAX_LENGTH / 5);
    vi.spyOn(moderationTargetRepository, 'findChatMessageEvidence').mockResolvedValue({
      id: messageId,
      author_id: authorId,
      body:
        'Contact user@example.test password=hunter2 OTP 654321 Bearer abc.def.ghi ' + longTail,
      created_at: '2026-11-10T10:00:00-05:00',
    });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: authorId,
      handle: 'message_author',
      primary_role: null,
      institution: unrelatedConversation,
      shared_contact_handle: 'hidden-contact',
      created_at: '2026-11-10T00:00:00.000Z',
      updated_at: '2026-11-10T00:00:00.000Z',
    });

    const result = await loadChatMessageEvidence(messageId);

    expect(result.type).toBe('chat_message');
    expect(result.chatMessage).toMatchObject({
      id: messageId,
      availability: 'Available',
      authorHandle: 'message_author',
      createdAt: '2026-11-10T15:00:00.000Z',
      messageContext: { redacted: true, truncated: true },
    });
    const payload = JSON.stringify(result);
    expect(payload).toContain('[redacted email]');
    expect(payload).toContain('[redacted]');
    expect(payload).not.toMatch(
      /user@example|hunter2|654321|abc\.def\.ghi|UNRELATED_CONVERSATION|hidden-contact/i
    );
  });

  it('redacts credential-like text independently of response-key scrubbing', () => {
    const result = redactModerationText(
      'api_key=abcdefghijklmnopqrstuvwxyz012345 token=https://x.test/?access_token=raw-token'
    );

    expect(result.redacted).toBe(true);
    expect(result.text).not.toMatch(/abcdefghijklmnopqrstuvwxyz012345|raw-token/);
  });

  it.each([
    ['chat channel', 'findChatChannelEvidence', loadChatChannelEvidence, 'chatChannel'],
    ['chat message', 'findChatMessageEvidence', loadChatMessageEvidence, 'chatMessage'],
  ] as const)('preserves a stale %s case with a safe unavailable target', async (_label, repoMethod, loader, key) => {
    vi.spyOn(moderationTargetRepository, repoMethod).mockResolvedValue(null);

    const result = await loader(channelId);

    expect(result).toEqual({
      type: key === 'chatChannel' ? 'chat_channel' : 'chat_message',
      [key]: { id: channelId, availability: 'Unavailable' },
    });
    expect(profileRepository.findProfileByParticipantId).toBeDefined();
  });

  it('uses null rather than email or full name when a public handle is absent', async () => {
    vi.spyOn(moderationTargetRepository, 'findChatMessageEvidence').mockResolvedValue({
      id: messageId,
      author_id: authorId,
      body: 'Moderated text',
      created_at: '2026-11-10T12:00:00.000Z',
    });
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(null);

    const result = await loadChatMessageEvidence(messageId);

    expect(result.chatMessage).toMatchObject({ authorHandle: null });
  });
});
