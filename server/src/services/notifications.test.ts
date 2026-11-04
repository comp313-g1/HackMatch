import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { INotificationsRepository } from '../db/notifications.repository.js';
import type { ParticipantNotification } from '../db/types.js';
import { NotificationHub } from './notificationHub.js';
import {
  deliverStoredNotification,
  notify,
  notifyEventVerificationOutcome,
  NotificationServiceError,
  resetDeliveryMemory,
} from './notifications.js';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const SUBMISSION = '44444444-4444-4444-8444-444444444444';

function row(overrides: Partial<ParticipantNotification> = {}): ParticipantNotification {
  return {
    id: 'n-1',
    participant_id: ALICE,
    team_id: null,
    event_id: null,
    request_id: null,
    submission_id: null,
    type: 'team_invitation',
    category: 'invitation',
    message: 'You were invited.',
    created_at: '2026-11-03T12:00:00.000Z',
    read_at: null,
    ...overrides,
  };
}

function makeRepo(stored: ParticipantNotification = row(), unread = 3) {
  return {
    create: vi.fn().mockResolvedValue(stored),
    countUnread: vi.fn().mockResolvedValue(unread),
  } satisfies INotificationsRepository;
}

describe('notifications service (US-021 / #198)', () => {
  beforeEach(() => {
    resetDeliveryMemory();
    vi.restoreAllMocks();
  });

  describe('notify', () => {
    it('stores the notification and pushes it live with the unread count', async () => {
      const repository = makeRepo(row({ id: 'n-9' }), 4);
      const hub = new NotificationHub();
      const received = vi.fn();
      hub.subscribe(ALICE, received);

      const view = await notify(
        { participantId: ALICE, type: 'team_invitation', message: '  You were invited.  ' },
        { repository, hub }
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          participant_id: ALICE,
          type: 'team_invitation',
          message: 'You were invited.',
        })
      );
      expect(view).toMatchObject({ id: 'n-9', category: 'invitation', readAt: null });
      expect(received).toHaveBeenCalledWith({ notification: view, unreadCount: 4 });
    });

    it('does not push to other participants', async () => {
      const repository = makeRepo();
      const hub = new NotificationHub();
      const bob = vi.fn();
      hub.subscribe(BOB, bob);

      await notify({ participantId: ALICE, type: 'team_invitation', message: 'hi' }, { repository, hub });

      expect(bob).not.toHaveBeenCalled();
    });

    it('rejects invalid input before writing anything', async () => {
      const repository = makeRepo();

      const err = await notify(
        { participantId: '', type: 'x'.repeat(51), message: '   ' },
        { repository }
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotificationServiceError);
      expect(err).toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
        fieldErrors: {
          participantId: expect.any(String),
          type: expect.stringContaining('50'),
          message: expect.any(String),
        },
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects a message over 500 characters', async () => {
      const repository = makeRepo();

      await expect(
        notify(
          { participantId: ALICE, type: 'team_invitation', message: 'm'.repeat(501) },
          { repository }
        )
      ).rejects.toMatchObject({ fieldErrors: { message: expect.stringContaining('500') } });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('propagates an insert failure and pushes nothing', async () => {
      const repository = makeRepo();
      repository.create.mockRejectedValue(new Error('db down'));
      const hub = new NotificationHub();
      const received = vi.fn();
      hub.subscribe(ALICE, received);

      await expect(
        notify({ participantId: ALICE, type: 'team_invitation', message: 'hi' }, { repository, hub })
      ).rejects.toThrow('db down');
      expect(received).not.toHaveBeenCalled();
    });

    it('still succeeds when live delivery fails', async () => {
      const repository = makeRepo();
      repository.countUnread.mockRejectedValue(new Error('count failed'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const hub = new NotificationHub();
      hub.subscribe(ALICE, vi.fn());

      const view = await notify(
        { participantId: ALICE, type: 'team_invitation', message: 'hi' },
        { repository, hub }
      );

      expect(view.id).toBe('n-1');
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('deliverStoredNotification', () => {
    it('skips the unread query when the recipient is offline', async () => {
      const repository = makeRepo();

      expect(await deliverStoredNotification(row(), { repository, hub: new NotificationHub() })).toBe(0);
      expect(repository.countUnread).not.toHaveBeenCalled();
    });

    it('pushes the same notification only once (notify + Realtime bridge)', async () => {
      const repository = makeRepo();
      const hub = new NotificationHub();
      const received = vi.fn();
      hub.subscribe(ALICE, received);

      expect(await deliverStoredNotification(row(), { repository, hub })).toBe(1);
      expect(await deliverStoredNotification(row(), { repository, hub })).toBe(0);
      expect(received).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyEventVerificationOutcome', () => {
    const base = { participantId: ALICE, submissionId: SUBMISSION, eventId: EVENT, eventTitle: 'HackFest' };

    it('creates an event_verification alert linked to the submission', async () => {
      const repository = makeRepo(row({ type: 'event_verification_approved', category: 'event_verification' }));

      await notifyEventVerificationOutcome({ ...base, outcome: 'approved' }, { repository });

      expect(repository.create).toHaveBeenCalledWith({
        participant_id: ALICE,
        type: 'event_verification_approved',
        message: 'Your event "HackFest" was approved and is now listed.',
        team_id: undefined,
        event_id: EVENT,
        request_id: undefined,
        submission_id: SUBMISSION,
      });
    });

    it('includes admin feedback on rejection', async () => {
      const repository = makeRepo();

      await notifyEventVerificationOutcome(
        { ...base, outcome: 'rejected', adminFeedback: 'Link is broken.' },
        { repository }
      );

      expect(repository.create.mock.calls[0][0]).toMatchObject({
        type: 'event_verification_rejected',
        message: 'Your event "HackFest" was not approved. Feedback: Link is broken.',
      });
    });

    it('describes a merge', async () => {
      const repository = makeRepo();

      await notifyEventVerificationOutcome({ ...base, outcome: 'merged' }, { repository });

      expect(repository.create.mock.calls[0][0]).toMatchObject({
        type: 'event_verification_merged',
        message: expect.stringContaining('merged'),
      });
    });

    it('truncates long feedback to fit the 500 character limit', async () => {
      const repository = makeRepo();

      await notifyEventVerificationOutcome(
        { ...base, outcome: 'rejected', adminFeedback: 'x'.repeat(900) },
        { repository }
      );

      const message = repository.create.mock.calls[0][0].message;
      expect(message.length).toBeLessThanOrEqual(500);
      expect(message.endsWith('…')).toBe(true);
    });
  });
});
