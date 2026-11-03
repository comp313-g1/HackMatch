import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  isNotificationCategory,
  isNotificationMessageTooLong,
  normalizeNotificationMessage,
  notificationCategoryForType,
} from './notificationModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('notificationModel (US-021 / #197)', () => {
  it('maps story alert types to feed categories', () => {
    expect(notificationCategoryForType('team_invitation')).toBe('invitation');
    expect(notificationCategoryForType('team_application_submitted')).toBe('application');
    expect(notificationCategoryForType('team_application_approved')).toBe('decision');
    expect(notificationCategoryForType('team_application_declined')).toBe('decision');
    expect(notificationCategoryForType('TEAM_ROSTER_LOCKED')).toBe('roster');
    expect(notificationCategoryForType('event_verification_approved')).toBe(
      'event_verification'
    );
  });

  it('falls back to general for lifecycle and moderation types', () => {
    expect(notificationCategoryForType('moderation_warning')).toBe('general');
    expect(notificationCategoryForType('REQUEST_CANCELED_TEAM_FULL')).toBe('general');
    expect(notificationCategoryForType('team_invitation_expired')).toBe('general');
  });

  it('only produces categories the database CHECK allows', () => {
    for (const type of ['team_invitation', 'x', 'event_verification_rejected']) {
      expect(isNotificationCategory(notificationCategoryForType(type))).toBe(true);
    }
    expect(isNotificationCategory('bogus')).toBe(false);
    expect(isNotificationCategory(null)).toBe(false);
  });

  it('normalizes and length-checks messages', () => {
    expect(normalizeNotificationMessage('   ')).toBeNull();
    expect(normalizeNotificationMessage('  hi  ')).toBe('hi');
    expect(
      isNotificationMessageTooLong('a'.repeat(NOTIFICATION_MESSAGE_MAX_LENGTH + 1))
    ).toBe(true);
    expect(isNotificationMessageTooLong('a'.repeat(NOTIFICATION_MESSAGE_MAX_LENGTH))).toBe(
      false
    );
  });

  it('keeps TS categories and SQL CHECK/mapping in sync with migration 0044', () => {
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../supabase/migrations/0044_extend_participant_notifications_for_notification_center.sql'
      ),
      'utf-8'
    );
    const checkBody = /chk_participant_notifications_category[\s\S]*?CHECK\s*\(\s*category\s+IN\s*\(([\s\S]*?)\)\s*\)/i.exec(
      sql
    )?.[1];
    const sqlCategories = [...(checkBody ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlCategories).toEqual([...NOTIFICATION_CATEGORIES]);
  });
});
