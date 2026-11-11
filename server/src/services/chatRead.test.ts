import { describe, expect, it, vi } from 'vitest';
import type { IChatReadRepository } from '../db/chatRead.repository.js';
import type { Participant } from '../db/types.js';
import { markChatConversationRead } from './chatRead.js';

const participant: Participant = {
  id: '10000000-0000-4000-8000-000000000001',
  firebase_uid: 'fb-reader',
  email: 'reader@example.test',
  full_name: 'Reader',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
};
const input = {
  conversationType: 'channel' as const,
  conversationId: '20000000-0000-4000-8000-000000000002',
  messageId: '30000000-0000-4000-8000-000000000003',
};

function repository(): IChatReadRepository {
  return {
    markRead: vi.fn().mockResolvedValue({
      conversation_type: 'channel',
      conversation_id: input.conversationId,
      last_read_message_id: input.messageId,
      last_read_message_created_at: '2026-11-10T12:00:00.000Z',
      advanced: true,
      unread_count: 2,
      unread_mention_count: 1,
    }),
  };
}

describe('markChatConversationRead (US-034 / #401)', () => {
  it('authorizes first, calls the canonical storage type, and returns a safe result', async () => {
    const repo = repository();
    const authorize = vi.fn().mockResolvedValue(undefined);
    const result = await markChatConversationRead(participant, input, {
      repository: repo,
      authorize,
    });

    expect(authorize).toHaveBeenCalledWith(participant, input);
    expect(repo.markRead).toHaveBeenCalledWith({
      participantId: participant.id,
      conversationType: 'channel',
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
    expect(result).toEqual({
      conversationType: 'channel',
      conversationId: input.conversationId,
      readCursor: {
        messageId: input.messageId,
        createdAt: '2026-11-10T12:00:00.000Z',
      },
      advanced: true,
      unreadCount: 2,
      unreadMentionCount: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/email|body|password|otp|token|firebase/i);
  });

  it('maps directMessage to the persisted direct_message type', async () => {
    const repo = repository();
    vi.mocked(repo.markRead).mockResolvedValue({
      conversation_type: 'direct_message',
      conversation_id: input.conversationId,
      last_read_message_id: input.messageId,
      last_read_message_created_at: '2026-11-10T12:00:00.000Z',
      advanced: false,
      unread_count: 0,
      unread_mention_count: 0,
    });
    const result = await markChatConversationRead(
      participant,
      { ...input, conversationType: 'directMessage' },
      { repository: repo, authorize: vi.fn().mockResolvedValue(undefined) }
    );
    expect(repo.markRead).toHaveBeenCalledWith(expect.objectContaining({
      conversationType: 'direct_message',
    }));
    expect(result.conversationType).toBe('directMessage');
    expect(result.advanced).toBe(false);
  });

  it('denies ineligible accounts and authorization failures before storage', async () => {
    const repo = repository();
    const authorize = vi.fn().mockResolvedValue(undefined);
    await expect(markChatConversationRead(
      { ...participant, is_suspended: true },
      input,
      { repository: repo, authorize }
    )).rejects.toMatchObject({ status: 403, code: 'CHAT_READ_NOT_ELIGIBLE' });
    expect(authorize).not.toHaveBeenCalled();
    expect(repo.markRead).not.toHaveBeenCalled();

    const denied = vi.fn().mockRejectedValue(
      Object.assign(new Error('denied'), { status: 403, code: 'TEAM_CHAT_ACCESS_DENIED' })
    );
    await expect(markChatConversationRead(participant, input, {
      repository: repo,
      authorize: denied,
    })).rejects.toMatchObject({ status: 403 });
    expect(repo.markRead).not.toHaveBeenCalled();
  });

  it.each([
    ['CHAT_MARK_READ_POSITION_NOT_FOUND', 404, 'CHAT_READ_POSITION_NOT_FOUND'],
    ['CHAT_MARK_READ_TEAM_ACCESS_DENIED', 403, 'TEAM_CHAT_ACCESS_DENIED'],
    ['CHAT_MARK_READ_DM_ACCESS_DENIED', 403, 'FORBIDDEN_NOT_THREAD_PARTICIPANT'],
    ['CHAT_MARK_READ_ACCESS_CHANGED', 403, 'CHAT_READ_ACCESS_CHANGED'],
  ])('maps safe storage denial %s', async (storageCode, status, code) => {
    const repo = repository();
    vi.mocked(repo.markRead).mockRejectedValue(new Error(storageCode));
    await expect(markChatConversationRead(participant, input, {
      repository: repo,
      authorize: vi.fn().mockResolvedValue(undefined),
    })).rejects.toMatchObject({ status, code });
  });
});
