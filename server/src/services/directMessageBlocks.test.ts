import { describe, it, expect, vi, beforeEach } from 'vitest';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { blockParticipant, unblockParticipant } from './directMessageBlocks.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const person = (id: string, over: Partial<Participant> = {}): Participant => ({
  id,
  firebase_uid: `fb-${id}`,
  email: `${id}@example.com`,
  full_name: 'N',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  created_at: 'c',
  updated_at: 'u',
  ...over,
});

describe('blockParticipant (#433)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(person(B));
    vi.spyOn(participantBlockRepository, 'addBlock').mockResolvedValue(undefined);
  });

  it('blocks the other participant and reports the caller\'s own block', async () => {
    await expect(blockParticipant({ caller: person(A), targetId: B })).resolves.toEqual({ youBlockedPeer: true });
    expect(participantBlockRepository.addBlock).toHaveBeenCalledWith(A, B);
  });

  it('normalizes ids to lower case', async () => {
    await blockParticipant({ caller: person(A.toUpperCase()), targetId: ` ${B.toUpperCase()} ` });
    expect(participantBlockRepository.addBlock).toHaveBeenCalledWith(A, B);
    expect(participantsRepository.findById).toHaveBeenCalledWith(B);
  });

  it('refuses to block yourself, without any lookup or write', async () => {
    await expect(blockParticipant({ caller: person(A), targetId: A.toUpperCase() })).rejects.toMatchObject({
      status: 400,
      code: 'CANNOT_BLOCK_SELF',
    });
    expect(participantsRepository.findById).not.toHaveBeenCalled();
    expect(participantBlockRepository.addBlock).not.toHaveBeenCalled();
  });

  it.each([
    ['a participant that does not exist', null],
    ['an administrator', person(B, { role: 'ADMIN' })],
  ])('gives the "not available" answer for %s and blocks nothing', async (_label, found) => {
    vi.mocked(participantsRepository.findById).mockResolvedValue(found);
    await expect(blockParticipant({ caller: person(A), targetId: B })).rejects.toMatchObject({
      status: 404,
      code: 'PEER_NOT_AVAILABLE',
    });
    expect(participantBlockRepository.addBlock).not.toHaveBeenCalled();
  });

  it.each([
    ['suspended', { is_suspended: true }],
    ['unverified', { is_verified: false }],
    ['deactivated', { is_deactivated: true }],
  ])('still lets you block a %s participant', async (_label, over) => {
    vi.mocked(participantsRepository.findById).mockResolvedValue(person(B, over));
    await expect(blockParticipant({ caller: person(A), targetId: B })).resolves.toEqual({ youBlockedPeer: true });
  });

  it('does not hide storage failures', async () => {
    vi.mocked(participantBlockRepository.addBlock).mockRejectedValue(new Error('db down'));
    await expect(blockParticipant({ caller: person(A), targetId: B })).rejects.toThrow('db down');
  });
});

describe('unblockParticipant (#433)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(participantBlockRepository, 'removeBlock').mockResolvedValue(undefined);
    vi.spyOn(participantsRepository, 'findById');
  });

  it('removes the caller\'s block and reports that it is gone', async () => {
    await expect(unblockParticipant({ caller: person(A), targetId: B })).resolves.toEqual({ youBlockedPeer: false });
    expect(participantBlockRepository.removeBlock).toHaveBeenCalledWith(A, B);
  });

  it('always succeeds and never looks the other person up, so nothing can be probed', async () => {
    await expect(unblockParticipant({ caller: person(A), targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })).resolves.toEqual({
      youBlockedPeer: false,
    });
    expect(participantsRepository.findById).not.toHaveBeenCalled();
  });

  it('normalizes ids to lower case', async () => {
    await unblockParticipant({ caller: person(A.toUpperCase()), targetId: ` ${B.toUpperCase()} ` });
    expect(participantBlockRepository.removeBlock).toHaveBeenCalledWith(A, B);
  });

  it('does not hide storage failures', async () => {
    vi.mocked(participantBlockRepository.removeBlock).mockRejectedValue(new Error('db down'));
    await expect(unblockParticipant({ caller: person(A), targetId: B })).rejects.toThrow('db down');
  });
});
