import { describe, it, expect, vi, beforeEach } from 'vitest';
import { directMessageRepository } from '../db/directMessage.repository.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import {
  DM_DENIALS,
  assertCanSendInDirectThread,
  authorizeDirectThreadAccess,
  isEligibleDirectMessageParticipant,
} from './directMessageAccess.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THREAD_ID = '44444444-4444-4444-8444-444444444444';

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
const thread = { id: THREAD_ID, participant_low_id: A, participant_high_id: B, created_at: 'c', updated_at: 'u' };

const denial = (d: (typeof DM_DENIALS)[keyof typeof DM_DENIALS]) =>
  expect.objectContaining({ status: d.status, code: d.code, message: d.message });

describe('isEligibleDirectMessageParticipant (US-032 / #388)', () => {
  it('accepts only a verified, active PART', () => {
    expect(isEligibleDirectMessageParticipant(person(A))).toBe(true);
    expect(isEligibleDirectMessageParticipant(person(A, { is_verified: false }))).toBe(false);
    expect(isEligibleDirectMessageParticipant(person(A, { is_suspended: true }))).toBe(false);
    expect(isEligibleDirectMessageParticipant(person(A, { is_deactivated: true }))).toBe(false);
    expect(isEligibleDirectMessageParticipant(person(A, { role: 'ADMIN' }))).toBe(false);
    expect(isEligibleDirectMessageParticipant(null)).toBe(false);
    expect(isEligibleDirectMessageParticipant(undefined)).toBe(false);
  });
});

describe('authorizeDirectThreadAccess (US-032 / #388)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(directMessageRepository, 'findThreadById').mockResolvedValue(thread);
  });

  it('lets either participant in and names the other one as the peer', async () => {
    expect(await authorizeDirectThreadAccess({ caller: person(A), threadId: THREAD_ID })).toEqual({ thread, peerId: B });
    expect(await authorizeDirectThreadAccess({ caller: person(B), threadId: THREAD_ID })).toEqual({ thread, peerId: A });
  });

  it('is case-insensitive about ids', async () => {
    const LETTERED = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
    const r = await authorizeDirectThreadAccess({ caller: person(A.toUpperCase()), threadId: LETTERED.toUpperCase() });
    expect(r.peerId).toBe(B);
    expect(directMessageRepository.findThreadById).toHaveBeenCalledWith(LETTERED);
  });

  it('gives an unrelated participant the SAME denial as a thread that does not exist', async () => {
    const unrelated = authorizeDirectThreadAccess({ caller: person(C), threadId: THREAD_ID });
    await expect(unrelated).rejects.toEqual(denial(DM_DENIALS.notParticipant));
    vi.mocked(directMessageRepository.findThreadById).mockResolvedValue(null);
    await expect(authorizeDirectThreadAccess({ caller: person(A), threadId: THREAD_ID })).rejects.toEqual(denial(DM_DENIALS.notParticipant));
  });

  it.each([
    ['unverified', { is_verified: false }],
    ['suspended', { is_suspended: true }],
    ['deactivated', { is_deactivated: true }],
    ['an ADMIN', { role: 'ADMIN' as const }],
  ])('denies a participant who is %s, even though they are in the thread', async (_l, over) => {
    await expect(authorizeDirectThreadAccess({ caller: person(A, over), threadId: THREAD_ID })).rejects.toEqual(denial(DM_DENIALS.callerNotEligible));
  });

  it('does not even look the thread up for an ineligible caller', async () => {
    await authorizeDirectThreadAccess({ caller: person(A, { is_suspended: true }), threadId: THREAD_ID }).catch(() => undefined);
    expect(directMessageRepository.findThreadById).not.toHaveBeenCalled();
  });
});

describe('assertCanSendInDirectThread (US-032 / #388)', () => {
  const access = { thread, peerId: B };
  const noBlocks = { blockedByMe: false, blockedByThem: false };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(person(B));
    vi.spyOn(participantBlockRepository, 'findBlockState').mockResolvedValue(noBlocks);
  });

  it('allows two eligible, unblocked participants', async () => {
    await expect(assertCanSendInDirectThread({ caller: person(A), access })).resolves.toBeUndefined();
    expect(participantBlockRepository.findBlockState).toHaveBeenCalledWith(A, B);
  });

  it.each([
    ['unverified', { is_verified: false }],
    ['suspended', { is_suspended: true }],
    ['deactivated', { is_deactivated: true }],
    ['an ADMIN', { role: 'ADMIN' as const }],
  ])('denies sending when the peer is %s', async (_l, over) => {
    vi.mocked(participantsRepository.findById).mockResolvedValue(person(B, over));
    await expect(assertCanSendInDirectThread({ caller: person(A), access })).rejects.toEqual(denial(DM_DENIALS.peerUnavailable));
  });

  it('denies sending when the peer account is gone', async () => {
    vi.mocked(participantsRepository.findById).mockResolvedValue(null);
    await expect(assertCanSendInDirectThread({ caller: person(A), access })).rejects.toEqual(denial(DM_DENIALS.peerUnavailable));
  });

  it('tells the person who set the block about it', async () => {
    vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue({ blockedByMe: true, blockedByThem: false });
    await expect(assertCanSendInDirectThread({ caller: person(A), access })).rejects.toEqual(denial(DM_DENIALS.blockedByYou));
  });

  it('gives the blocked person the SAME denial as a suspended peer (a block is not revealed)', async () => {
    vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue({ blockedByMe: false, blockedByThem: true });
    const blocked = await assertCanSendInDirectThread({ caller: person(A), access }).catch((e) => e);
    vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue(noBlocks);
    vi.mocked(participantsRepository.findById).mockResolvedValue(person(B, { is_suspended: true }));
    const suspended = await assertCanSendInDirectThread({ caller: person(A), access }).catch((e) => e);
    expect(blocked).toEqual(denial(DM_DENIALS.peerUnavailable));
    expect({ s: blocked.status, c: blocked.code, m: blocked.message }).toEqual({ s: suspended.status, c: suspended.code, m: suspended.message });
  });

  it('when both blocked each other, the caller is told about their own block', async () => {
    vi.mocked(participantBlockRepository.findBlockState).mockResolvedValue({ blockedByMe: true, blockedByThem: true });
    await expect(assertCanSendInDirectThread({ caller: person(A), access })).rejects.toEqual(denial(DM_DENIALS.blockedByYou));
  });

  it('denies an ineligible caller before touching the peer or blocks', async () => {
    await expect(assertCanSendInDirectThread({ caller: person(A, { is_verified: false }), access })).rejects.toEqual(denial(DM_DENIALS.callerNotEligible));
    expect(participantsRepository.findById).not.toHaveBeenCalled();
    expect(participantBlockRepository.findBlockState).not.toHaveBeenCalled();
  });

  it('denial messages are clear and never mention email or ids', () => {
    for (const d of Object.values(DM_DENIALS)) {
      expect(d.message.length).toBeGreaterThan(10);
      expect(d.message).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });
});
