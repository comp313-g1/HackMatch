import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from './client.js';
import { chatUnreadRepository } from './chatUnread.repository.js';

vi.mock('./client.js', () => ({ getSupabaseClient: vi.fn() }));

const PARTICIPANT_ID = '10000000-0000-4000-8000-000000000001';
const CHANNEL_ID = '20000000-0000-4000-8000-000000000002';

describe('chatUnreadRepository (US-034 / #399)', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseClient).mockReturnValue({ rpc } as never);
  });

  it('calls the service-role count function and normalizes PostgreSQL bigint values', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          conversation_type: 'channel',
          conversation_id: CHANNEL_ID,
          unread_count: '7',
        },
      ],
      error: null,
    });

    await expect(chatUnreadRepository.listForParticipant(PARTICIPANT_ID)).resolves.toEqual([
      {
        conversation_type: 'channel',
        conversation_id: CHANNEL_ID,
        unread_count: 7,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith('get_participant_chat_unread_counts', {
      p_participant: PARTICIPANT_ID,
    });
  });

  it('projects an explicit count-only allowlist', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          conversation_type: 'channel',
          conversation_id: CHANNEL_ID,
          unread_count: 2,
          body: 'must not escape',
          email: 'private@example.test',
          token: 'secret',
        },
      ],
      error: null,
    });

    const result = await chatUnreadRepository.listForParticipant(PARTICIPANT_ID);
    expect(result).toEqual([
      {
        conversation_type: 'channel',
        conversation_id: CHANNEL_ID,
        unread_count: 2,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/must not escape|private@example|secret/i);
  });

  it('fails closed on storage errors and malformed rows', async () => {
    const failure = new Error('database unavailable');
    rpc.mockResolvedValueOnce({ data: null, error: failure });
    await expect(chatUnreadRepository.listForParticipant(PARTICIPANT_ID)).rejects.toBe(failure);

    rpc.mockResolvedValueOnce({
      data: [{ conversation_type: 'unknown', conversation_id: 'not-a-uuid', unread_count: -1 }],
      error: null,
    });
    await expect(chatUnreadRepository.listForParticipant(PARTICIPANT_ID)).rejects.toThrow(
      'Invalid chat unread-count row.'
    );
  });
});
