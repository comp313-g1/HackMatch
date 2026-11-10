import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from './client.js';
import { chatReadRepository } from './chatRead.repository.js';

vi.mock('./client.js', () => ({ getSupabaseClient: vi.fn() }));

const PARTICIPANT_ID = '10000000-0000-4000-8000-000000000001';
const CHANNEL_ID = '20000000-0000-4000-8000-000000000002';
const MESSAGE_ID = '30000000-0000-4000-8000-000000000003';

describe('chatReadRepository (US-034 / #401)', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseClient).mockReturnValue({ rpc } as never);
  });

  it('calls the atomic RPC and normalizes its safe bigint/timestamp projection', async () => {
    rpc.mockResolvedValue({
      data: [{
        conversation_type: 'channel',
        conversation_id: CHANNEL_ID,
        last_read_message_id: MESSAGE_ID,
        last_read_message_created_at: '2026-11-10T12:00:00+00:00',
        advanced: true,
        unread_count: '4',
        unread_mention_count: '2',
        body: 'must not escape',
        email: 'private@example.test',
      }],
      error: null,
    });

    await expect(chatReadRepository.markRead({
      participantId: PARTICIPANT_ID,
      conversationType: 'channel',
      conversationId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    })).resolves.toEqual({
      conversation_type: 'channel',
      conversation_id: CHANNEL_ID,
      last_read_message_id: MESSAGE_ID,
      last_read_message_created_at: '2026-11-10T12:00:00.000Z',
      advanced: true,
      unread_count: 4,
      unread_mention_count: 2,
    });
    expect(rpc).toHaveBeenCalledWith('mark_chat_conversation_read', {
      p_participant: PARTICIPANT_ID,
      p_conversation_type: 'channel',
      p_conversation: CHANNEL_ID,
      p_message: MESSAGE_ID,
    });
  });

  it('fails closed on storage errors and malformed or multi-row results', async () => {
    const failure = new Error('storage unavailable');
    rpc.mockResolvedValueOnce({ data: null, error: failure });
    await expect(chatReadRepository.markRead({
      participantId: PARTICIPANT_ID,
      conversationType: 'channel',
      conversationId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    })).rejects.toBe(failure);

    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(chatReadRepository.markRead({
      participantId: PARTICIPANT_ID,
      conversationType: 'channel',
      conversationId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    })).rejects.toThrow('Invalid chat mark-read response.');

    rpc.mockResolvedValueOnce({
      data: [{ conversation_type: 'channel', unread_count: -1 }],
      error: null,
    });
    await expect(chatReadRepository.markRead({
      participantId: PARTICIPANT_ID,
      conversationType: 'channel',
      conversationId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    })).rejects.toThrow('Invalid chat mark-read response.');
  });
});
