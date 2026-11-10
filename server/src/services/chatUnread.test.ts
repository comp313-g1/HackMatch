import { describe, expect, it, vi } from 'vitest';
import type { IChatUnreadRepository } from '../db/chatUnread.repository.js';
import type { Participant } from '../db/types.js';
import { getParticipantChatUnreadSummary } from './chatUnread.js';

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

function repository(): IChatUnreadRepository {
  return {
    listForParticipant: vi.fn().mockResolvedValue([
      {
        conversation_type: 'channel',
        conversation_id: '20000000-0000-4000-8000-000000000002',
        unread_count: 3,
      },
      {
        conversation_type: 'direct_message',
        conversation_id: '30000000-0000-4000-8000-000000000003',
        unread_count: 2,
      },
    ]),
  };
}

describe('getParticipantChatUnreadSummary (US-034 / #399)', () => {
  it('returns only conversation identifiers, types, counts, and a total', async () => {
    const repo = repository();
    const result = await getParticipantChatUnreadSummary(participant, { repository: repo });

    expect(result).toEqual({
      counts: [
        {
          conversationType: 'channel',
          conversationId: '20000000-0000-4000-8000-000000000002',
          unreadCount: 3,
        },
        {
          conversationType: 'directMessage',
          conversationId: '30000000-0000-4000-8000-000000000003',
          unreadCount: 2,
        },
      ],
      totalUnreadCount: 5,
    });
    expect(repo.listForParticipant).toHaveBeenCalledWith(participant.id);
    expect(JSON.stringify(result)).not.toMatch(/email|body|password|otp|token|firebase/i);
  });

  it('preserves explicit zero-count conversations and the empty summary', async () => {
    const zeroRepo: IChatUnreadRepository = {
      listForParticipant: vi.fn().mockResolvedValue([
        {
          conversation_type: 'channel',
          conversation_id: '20000000-0000-4000-8000-000000000002',
          unread_count: 0,
        },
      ]),
    };
    await expect(
      getParticipantChatUnreadSummary(participant, { repository: zeroRepo })
    ).resolves.toEqual({
      counts: [
        {
          conversationType: 'channel',
          conversationId: '20000000-0000-4000-8000-000000000002',
          unreadCount: 0,
        },
      ],
      totalUnreadCount: 0,
    });

    zeroRepo.listForParticipant = vi.fn().mockResolvedValue([]);
    await expect(
      getParticipantChatUnreadSummary(participant, { repository: zeroRepo })
    ).resolves.toEqual({ counts: [], totalUnreadCount: 0 });
  });

  it.each([
    ['ADMIN', { role: 'ADMIN' as const }],
    ['unverified PART', { is_verified: false }],
    ['suspended PART', { is_suspended: true }],
    ['deactivated PART', { is_suspended: true, is_deactivated: true }],
  ])('denies an ineligible %s before querying counts', async (_label, patch) => {
    const repo = repository();
    await expect(
      getParticipantChatUnreadSummary({ ...participant, ...patch }, { repository: repo })
    ).rejects.toMatchObject({ status: 403, code: 'CHAT_UNREAD_NOT_ELIGIBLE' });
    expect(repo.listForParticipant).not.toHaveBeenCalled();
  });
});
