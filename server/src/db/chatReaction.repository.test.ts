/**
 * US-035 / #405 — the reaction repository passes only allowlisted fields and
 * refuses malformed function results instead of forwarding them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./client.js', () => ({ getSupabaseClient: () => ({ rpc }) }));

const { chatReactionRepository } = await import('./chatReaction.repository.js');

const MESSAGE = '80000000-0000-4000-8000-000000000001';
const PARTICIPANT = '10000000-0000-4000-8000-000000000001';

describe('chatReactionRepository', () => {
  beforeEach(() => rpc.mockReset());

  it('calls the scope-specific write function with the authenticated participant', async () => {
    rpc.mockResolvedValue({ data: [{ changed: true }], error: null });
    await expect(
      chatReactionRepository.setReaction({
        scope: 'directMessage',
        participantId: PARTICIPANT,
        conversationId: '70000000-0000-4000-8000-000000000001',
        messageId: MESSAGE,
        reaction: 'heart',
        present: false,
      })
    ).resolves.toEqual({ changed: true });
    expect(rpc).toHaveBeenCalledWith('set_direct_message_reaction', {
      p_participant: PARTICIPANT,
      p_thread: '70000000-0000-4000-8000-000000000001',
      p_message: MESSAGE,
      p_reaction: 'heart',
      p_present: false,
    });
  });

  it('propagates storage errors for the service to map', async () => {
    const error = { message: 'CHAT_REACTION_MESSAGE_NOT_FOUND', code: 'P0001' };
    rpc.mockResolvedValue({ data: null, error });
    await expect(
      chatReactionRepository.setReaction({
        scope: 'channel',
        participantId: PARTICIPANT,
        conversationId: '60000000-0000-4000-8000-000000000001',
        messageId: MESSAGE,
        reaction: 'heart',
        present: true,
      })
    ).rejects.toBe(error);
  });

  it('keeps only allowlisted summary fields', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          message_id: MESSAGE.toUpperCase(),
          reaction: 'heart',
          reaction_count: '2',
          reacted_by_me: true,
          participant_id: PARTICIPANT,
          email: 'leak@example.test',
        },
      ],
      error: null,
    });
    await expect(
      chatReactionRepository.summarize({ scope: 'channel', participantId: PARTICIPANT, messageIds: [MESSAGE] })
    ).resolves.toEqual([{ message_id: MESSAGE, reaction: 'heart', reaction_count: 2, reacted_by_me: true }]);
  });

  it('refuses malformed summaries and skips the call for an empty id list', async () => {
    for (const row of [
      { message_id: MESSAGE, reaction: 'smile', reaction_count: 1, reacted_by_me: false },
      { message_id: MESSAGE, reaction: 'heart', reaction_count: 0, reacted_by_me: false },
      { message_id: 'nope', reaction: 'heart', reaction_count: 1, reacted_by_me: false },
      { message_id: MESSAGE, reaction: 'heart', reaction_count: 1, reacted_by_me: 'yes' },
    ]) {
      rpc.mockResolvedValueOnce({ data: [row], error: null });
      await expect(
        chatReactionRepository.summarize({ scope: 'channel', participantId: PARTICIPANT, messageIds: [MESSAGE] })
      ).rejects.toThrow('Invalid chat reaction response.');
    }
    rpc.mockClear();
    await expect(
      chatReactionRepository.summarize({ scope: 'channel', participantId: PARTICIPANT, messageIds: [] })
    ).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
