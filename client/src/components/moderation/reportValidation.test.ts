import { describe, expect, it } from 'vitest';
import {
  isReportExplanationTooLong,
  isValidHttpsReportUrl,
  isValidReportCategory,
  isValidReportTargetType,
  normalizeReportExplanation,
  normalizeReportFlaggedUrl,
  validateReportSubmissionInput,
} from './reportValidation';

describe('client reportValidation (US-025 / #233 / #237)', () => {
  const validTargetId = '11111111-1111-4111-8111-111111111111';

  it('validates categories and target types correctly', () => {
    expect(isValidReportCategory('Harassment')).toBe(true);
    expect(isValidReportCategory('Spam')).toBe(true);
    expect(isValidReportCategory('Phishing Link')).toBe(true);
    expect(isValidReportCategory('Fake Account')).toBe(true);
    expect(isValidReportCategory('Other')).toBe(false);

    expect(isValidReportTargetType('team')).toBe(true);
    expect(isValidReportTargetType('profile')).toBe(true);
    expect(isValidReportTargetType('event')).toBe(true);
    expect(isValidReportTargetType('url')).toBe(true);
    expect(isValidReportTargetType('user')).toBe(false);
  });

  it('normalizes explanations and URLs', () => {
    expect(normalizeReportExplanation(null)).toBeNull();
    expect(normalizeReportExplanation('   ')).toBeNull();
    expect(normalizeReportExplanation('  test reason  ')).toBe('test reason');

    expect(isReportExplanationTooLong('a'.repeat(1000))).toBe(false);
    expect(isReportExplanationTooLong('a'.repeat(1001))).toBe(true);

    expect(normalizeReportFlaggedUrl('  https://example.com/link  ')).toBe(
      'https://example.com/link'
    );
    expect(isValidHttpsReportUrl('https://valid.example.com/path')).toBe(true);
    expect(isValidHttpsReportUrl('http://insecure.example.com')).toBe(false);
  });

  it('validates a complete valid input payload', () => {
    const result = validateReportSubmissionInput({
      targetType: 'team',
      targetId: validTargetId,
      category: 'Spam',
      explanation: '  Posting unwanted promotional material  ',
    });

    expect(result.valid).toBe(true);
    expect(result.fieldErrors).toEqual({});
    expect(result.normalized).toEqual({
      targetType: 'team',
      targetId: validTargetId,
      category: 'Spam',
      explanation: 'Posting unwanted promotional material',
      flaggedUrl: null,
    });
  });

  it('validates url targets and requires valid https URL', () => {
    const missingUrlResult = validateReportSubmissionInput({
      targetType: 'url',
      targetId: validTargetId,
      category: 'Phishing Link',
    });
    expect(missingUrlResult.valid).toBe(false);
    expect(missingUrlResult.fieldErrors.flaggedUrl).toBeDefined();

    const validUrlResult = validateReportSubmissionInput({
      targetType: 'url',
      targetId: validTargetId,
      category: 'Phishing Link',
      flaggedUrl: 'https://phishing.site/verify-account',
    });
    expect(validUrlResult.valid).toBe(true);
    expect(validUrlResult.normalized?.flaggedUrl).toBe(
      'https://phishing.site/verify-account'
    );
  });

  it('rejects invalid targetId and invalid category', () => {
    const result = validateReportSubmissionInput({
      targetType: 'profile',
      targetId: 'invalid-id',
      category: 'Unknown',
    });

    expect(result.valid).toBe(false);
    expect(result.fieldErrors.targetId).toBeDefined();
    expect(result.fieldErrors.category).toBeDefined();
  });
});
