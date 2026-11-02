import { describe, it, expect } from 'vitest';
import {
  normalizeAndValidateEventDate,
  validateHackathonHistoryDraft,
  computeExperienceBadge,
} from './hackathonHistoryValidation';

describe('Client Hackathon History Validation (US-007 / #US-007-T3)', () => {
  describe('computeExperienceBadge', () => {
    it('returns Beginner for 0 records', () => {
      expect(computeExperienceBadge(0)).toBe('Beginner');
      expect(computeExperienceBadge(-1)).toBe('Beginner');
      expect(computeExperienceBadge(NaN)).toBe('Beginner');
    });

    it('returns Competitor for 1 to 3 records', () => {
      expect(computeExperienceBadge(1)).toBe('Competitor');
      expect(computeExperienceBadge(2)).toBe('Competitor');
      expect(computeExperienceBadge(3)).toBe('Competitor');
    });

    it('returns Veteran for 4 or more records', () => {
      expect(computeExperienceBadge(4)).toBe('Veteran');
      expect(computeExperienceBadge(5)).toBe('Veteran');
      expect(computeExperienceBadge(10)).toBe('Veteran');
    });
  });

  describe('normalizeAndValidateEventDate', () => {
    it('accepts YYYY-MM and normalizes to YYYY-MM-01', () => {
      const res = normalizeAndValidateEventDate('2024-08');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe('2024-08-01');
      }
    });

    it('accepts valid YYYY-MM-DD', () => {
      const res = normalizeAndValidateEventDate('2024-08-20');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe('2024-08-20');
      }
    });

    it('rejects invalid dates and dates before 2000-01-01', () => {
      expect(normalizeAndValidateEventDate('1998-05-01').ok).toBe(false);
      expect(normalizeAndValidateEventDate('2026-02-31').ok).toBe(false);
      expect(normalizeAndValidateEventDate('abc').ok).toBe(false);
    });
  });

  describe('validateHackathonHistoryDraft', () => {
    const validDraft = {
      eventName: 'Hackville 2024',
      eventDate: '2024-06-15',
      teamRole: 'AI/ML',
      projectTitle: 'SmartRecycle',
      projectUrl: 'https://github.com/example/smart-recycle',
    };

    it('passes for valid draft', () => {
      const res = validateHackathonHistoryDraft(validDraft);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual({});
      expect(res.sanitized?.eventName).toBe('Hackville 2024');
    });

    it('flags missing fields', () => {
      const res = validateHackathonHistoryDraft({
        eventName: '',
        eventDate: '',
        teamRole: '',
        projectTitle: '',
        projectUrl: '',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.eventName).toBeDefined();
      expect(res.errors.eventDate).toBeDefined();
      expect(res.errors.teamRole).toBeDefined();
      expect(res.errors.projectTitle).toBeDefined();
      expect(res.errors.projectUrl).toBeDefined();
    });

    it('flags invalid HTTPS URL', () => {
      const res = validateHackathonHistoryDraft({
        ...validDraft,
        projectUrl: 'http://not-https.com',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.projectUrl).toContain('HTTPS URL');
    });
  });
});
