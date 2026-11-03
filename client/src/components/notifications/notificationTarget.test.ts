import { describe, it, expect } from 'vitest';
import {
  describeNotificationTarget,
  formatBadgeCount,
  formatRelativeTime,
  resolveNotificationTarget,
} from './notificationTarget';
import { getNotificationLabel, type NotificationCategory, type NotificationView } from './notificationTypes';

const EVENT = '33333333-3333-4333-8333-333333333333';

function n(type: string, category: NotificationCategory, eventId: string | null = EVENT): NotificationView {
  return {
    id: 'n1',
    type,
    category,
    message: 'm',
    teamId: null,
    eventId,
    requestId: null,
    submissionId: null,
    readAt: null,
    createdAt: '2026-11-03T10:00:00Z',
  };
}

describe('resolveNotificationTarget (US-021 AC 3)', () => {
  it('sends inbound invitations to the Invitations tab', () => {
    expect(resolveNotificationTarget(n('team_invitation', 'invitation'))).toEqual({
      kind: 'requests',
      tab: 'invitations',
    });
  });

  it('sends application decisions to the Applications tab', () => {
    for (const type of ['team_application_approved', 'team_application_declined']) {
      expect(resolveNotificationTarget(n(type, 'decision'))).toEqual({
        kind: 'requests',
        tab: 'applications',
      });
    }
  });

  it('sends received applications and invitation responses to the team view', () => {
    expect(resolveNotificationTarget(n('team_application_submitted', 'application'))).toEqual({
      kind: 'team',
      eventId: EVENT,
    });
    expect(resolveNotificationTarget(n('team_invitation_accepted', 'decision'))).toEqual({
      kind: 'team',
      eventId: EVENT,
    });
  });

  it('sends roster confirmation to the team view', () => {
    expect(resolveNotificationTarget(n('TEAM_ROSTER_LOCKED', 'roster'))).toEqual({
      kind: 'team',
      eventId: EVENT,
    });
  });

  it('sends approved events to the team view and has no destination for rejections', () => {
    expect(
      resolveNotificationTarget(n('event_verification_approved', 'event_verification'))
    ).toEqual({ kind: 'team', eventId: EVENT });
    expect(
      resolveNotificationTarget(n('event_verification_rejected', 'event_verification'))
    ).toEqual({ kind: 'none' });
  });

  it('falls back to none when a general alert has no event', () => {
    expect(resolveNotificationTarget(n('moderation_warning', 'general', null))).toEqual({
      kind: 'none',
    });
  });
});

describe('formatBadgeCount', () => {
  it('hides zero, shows counts, caps at 99+', () => {
    expect(formatBadgeCount(0)).toBeNull();
    expect(formatBadgeCount(-3)).toBeNull();
    expect(formatBadgeCount(7)).toBe('7');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  it('formats recent times compactly', () => {
    expect(formatRelativeTime('2026-11-03T11:59:40Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-11-03T11:55:00Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-11-03T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-11-01T12:00:00Z', now)).toBe('2d ago');
  });
  it('returns an empty string for invalid input', () => {
    expect(formatRelativeTime('nope', now)).toBe('');
  });
});

describe('getNotificationLabel (US-021 AC 2)', () => {
  it('uses a specific label per alert type', () => {
    const cases: Array<[string, NotificationCategory, string]> = [
      ['team_invitation', 'invitation', 'Invitation'],
      ['team_application_submitted', 'application', 'Application received'],
      ['team_application_approved', 'decision', 'Application approved'],
      ['team_application_declined', 'decision', 'Application declined'],
      ['TEAM_ROSTER_LOCKED', 'roster', 'Roster locked'],
      ['event_verification_approved', 'event_verification', 'Event approved'],
      ['event_verification_rejected', 'event_verification', 'Event not approved'],
      ['REQUEST_CANCELED_TEAM_FULL', 'general', 'Request canceled'],
      ['moderation_warning', 'general', 'Moderation notice'],
    ];
    for (const [type, category, label] of cases) {
      expect(getNotificationLabel({ type, category })).toBe(label);
    }
  });

  it('falls back to the category label for unknown types', () => {
    expect(getNotificationLabel({ type: 'something_new', category: 'roster' })).toBe('Roster');
    expect(getNotificationLabel({ type: 'something_new', category: 'general' })).toBe('Update');
  });
});

describe('describeNotificationTarget', () => {
  it('describes each destination and returns null when there is none', () => {
    expect(describeNotificationTarget({ kind: 'requests', tab: 'invitations' })).toBe(
      'Opens Requests › Invitations'
    );
    expect(describeNotificationTarget({ kind: 'requests', tab: 'applications' })).toBe(
      'Opens Requests › Applications'
    );
    expect(describeNotificationTarget({ kind: 'team', eventId: null })).toBe('Opens your team');
    expect(describeNotificationTarget({ kind: 'none' })).toBeNull();
  });
});