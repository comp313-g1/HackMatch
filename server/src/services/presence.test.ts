import { describe, it, expect, vi, beforeEach } from 'vitest';
import { participantsRepository } from '../db/participants.repository.js';
import {
  peerVisiblePresenceStatus,
  toPresenceView,
  updateMyPresence,
} from './presence.js';

describe('presence service (US-030 / #343 / FR-086)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps participant row to a safe presence view without email', () => {
    const view = toPresenceView({
      presence_status: 'Online',
      updated_at: '2026-10-21T12:00:00.000Z',
      email: 'secret@example.com',
    } as never);

    expect(view).toEqual({
      presenceStatus: 'Online',
      updatedAt: '2026-10-21T12:00:00.000Z',
    });
    expect(view).not.toHaveProperty('email');
  });

  it('defaults missing presence_status to Invisible', () => {
    expect(
      toPresenceView({
        updated_at: '2026-10-21T12:00:00.000Z',
      }).presenceStatus
    ).toBe('Invisible');
  });

  it('hides Invisible from peer-visible presence', () => {
    expect(peerVisiblePresenceStatus('Invisible')).toBeNull();
    expect(peerVisiblePresenceStatus('Online')).toBe('Online');
    expect(peerVisiblePresenceStatus('Do Not Disturb')).toBe('Do Not Disturb');
  });

  it('persists presence via participantsRepository.updatePresenceStatus', async () => {
    vi.spyOn(participantsRepository, 'updatePresenceStatus').mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      firebase_uid: 'fb-1',
      email: 'part@example.com',
      full_name: 'Part User',
      role: 'PART',
      is_verified: true,
      presence_status: 'Idle',
      created_at: '2026-10-21T12:00:00.000Z',
      updated_at: '2026-10-21T12:30:00.000Z',
    });

    const view = await updateMyPresence(
      '11111111-1111-4111-8111-111111111111',
      'Idle'
    );

    expect(participantsRepository.updatePresenceStatus).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'Idle'
    );
    expect(view.presenceStatus).toBe('Idle');
    expect(view).not.toHaveProperty('email');
  });
});
