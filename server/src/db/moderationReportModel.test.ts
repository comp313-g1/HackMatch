import { describe, expect, it } from 'vitest';
import {
  MAX_REPORT_EXPLANATION_LENGTH,
  MAX_REPORT_FLAGGED_URL_LENGTH,
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  buildModerationReportRecord,
  isReportExplanationTooLong,
  isValidHttpsReportUrl,
  isValidReportCategory,
  isValidReportTargetType,
  isValidReportUuid,
  normalizeReportExplanation,
  normalizeReportFlaggedUrl,
} from './moderationReportModel.js';

describe('moderationReportModel (US-025 / #231 / #237)', () => {
  const validUuid1 = '11111111-1111-4111-8111-111111111111';
  const validUuid2 = '22222222-2222-4222-8222-222222222222';
  const validCaseId = '33333333-3333-4333-8333-333333333333';

  it('exports expected domain constants', () => {
    expect(REPORT_CATEGORIES).toEqual([
      'Harassment',
      'Spam',
      'Phishing Link',
      'Fake Account',
    ]);
    expect(REPORT_TARGET_TYPES).toEqual([
      'team',
      'profile',
      'event',
      'url',
      'chat_message',
    ]);
    expect(MAX_REPORT_EXPLANATION_LENGTH).toBe(1000);
    expect(MAX_REPORT_FLAGGED_URL_LENGTH).toBe(2048);
  });

  describe('utility validators and normalizers', () => {
    it('validates UUIDs strictly', () => {
      expect(isValidReportUuid(validUuid1)).toBe(true);
      expect(isValidReportUuid('invalid-uuid')).toBe(false);
      expect(isValidReportUuid(null)).toBe(false);
      expect(isValidReportUuid(undefined)).toBe(false);
    });

    it('validates allowed categories', () => {
      expect(isValidReportCategory('Harassment')).toBe(true);
      expect(isValidReportCategory('Spam')).toBe(true);
      expect(isValidReportCategory('Phishing Link')).toBe(true);
      expect(isValidReportCategory('Fake Account')).toBe(true);
      expect(isValidReportCategory('InvalidCategory')).toBe(false);
      expect(isValidReportCategory('')).toBe(false);
    });

    it('validates allowed target types', () => {
      expect(isValidReportTargetType('team')).toBe(true);
      expect(isValidReportTargetType('profile')).toBe(true);
      expect(isValidReportTargetType('event')).toBe(true);
      expect(isValidReportTargetType('url')).toBe(true);
      expect(isValidReportTargetType('chat_message')).toBe(true);
      expect(isValidReportTargetType('other')).toBe(false);
    });

    it('normalizes explanation and flags too-long strings', () => {
      expect(normalizeReportExplanation(null)).toBeNull();
      expect(normalizeReportExplanation('   ')).toBeNull();
      expect(normalizeReportExplanation('  hello  ')).toBe('hello');

      expect(isReportExplanationTooLong('a'.repeat(1000))).toBe(false);
      expect(isReportExplanationTooLong('a'.repeat(1001))).toBe(true);
    });

    it('validates https flagged URLs correctly', () => {
      expect(isValidHttpsReportUrl('https://malicious.example.com/login')).toBe(
        true
      );
      expect(isValidHttpsReportUrl('http://insecure.example.com')).toBe(false);
      expect(isValidHttpsReportUrl('javascript:alert(1)')).toBe(false);
      expect(isValidHttpsReportUrl('https://')).toBe(false);
      expect(isValidHttpsReportUrl('   ')).toBe(false);
      expect(normalizeReportFlaggedUrl('  https://example.com/test  ')).toBe(
        'https://example.com/test'
      );
    });
  });

  describe('buildModerationReportRecord', () => {
    it('builds a frozen valid record for team target', () => {
      const record = buildModerationReportRecord({
        reporterId: validUuid1,
        targetType: 'team',
        targetId: validUuid2,
        category: 'Spam',
        explanation: '  Posting spam links.  ',
        caseId: validCaseId,
      });

      expect(record.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(record.reporter_id).toBe(validUuid1);
      expect(record.target_type).toBe('team');
      expect(record.target_id).toBe(validUuid2);
      expect(record.category).toBe('Spam');
      expect(record.explanation).toBe('Posting spam links.');
      expect(record.case_id).toBe(validCaseId);
      expect(record.flagged_url).toBeNull();
      expect(Object.isFrozen(record)).toBe(true);
    });

    it('builds a valid record for url target with https URL', () => {
      const record = buildModerationReportRecord({
        reporterId: validUuid1,
        targetType: 'url',
        targetId: validUuid2,
        category: 'Phishing Link',
        flaggedUrl: 'https://phishing.site/account',
      });

      expect(record.target_type).toBe('url');
      expect(record.flagged_url).toBe('https://phishing.site/account');
    });

    it('builds a valid record for a chat-message target without chat content', () => {
      const record = buildModerationReportRecord({
        reporterId: validUuid1,
        targetType: 'chat_message',
        targetId: validUuid2,
        category: 'Harassment',
        explanation: 'Targeted message violates the rules.',
      });

      expect(record.target_type).toBe('chat_message');
      expect(record.target_id).toBe(validUuid2);
      expect(record.flagged_url).toBeNull();
      expect(JSON.stringify(record)).not.toMatch(/message body|email|token|otp/i);
    });

    it('throws SELF_REPORT_FORBIDDEN when participant reports own profile', () => {
      expect(() =>
        buildModerationReportRecord({
          reporterId: validUuid1,
          targetType: 'profile',
          targetId: validUuid1,
          category: 'Harassment',
        })
      ).toThrow(/SELF_REPORT_FORBIDDEN/i);
    });

    it('throws when targetId or reporterId is not a UUID', () => {
      expect(() =>
        buildModerationReportRecord({
          reporterId: 'bad-id',
          targetType: 'team',
          targetId: validUuid2,
          category: 'Spam',
        })
      ).toThrow(/reporterId must be a valid UUID/i);

      expect(() =>
        buildModerationReportRecord({
          reporterId: validUuid1,
          targetType: 'team',
          targetId: 'bad-target',
          category: 'Spam',
        })
      ).toThrow(/targetId must be a valid UUID/i);
    });

    it('throws when category is invalid', () => {
      expect(() =>
        buildModerationReportRecord({
          reporterId: validUuid1,
          targetType: 'team',
          targetId: validUuid2,
          category: 'Invalid' as unknown as 'Spam',
        })
      ).toThrow(/category must be/i);
    });

    it('throws when explanation exceeds 1000 characters', () => {
      expect(() =>
        buildModerationReportRecord({
          reporterId: validUuid1,
          targetType: 'team',
          targetId: validUuid2,
          category: 'Spam',
          explanation: 'x'.repeat(1001),
        })
      ).toThrow(/explanation must be at most 1000 characters/i);
    });

    it('throws when url target is missing flaggedUrl', () => {
      expect(() =>
        buildModerationReportRecord({
          reporterId: validUuid1,
          targetType: 'url',
          targetId: validUuid2,
          category: 'Phishing Link',
        })
      ).toThrow(/flaggedUrl is required when targetType is url/i);
    });
  });
});
