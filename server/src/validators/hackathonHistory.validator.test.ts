import { describe, it, expect } from 'vitest';
import {
  normalizeAndValidateEventDate,
  validateHackathonHistoryInput,
  MIN_EVENT_DATE,
  EVENT_NAME_MAX_LENGTH,
  PROJECT_TITLE_MAX_LENGTH,
  PROJECT_URL_MAX_LENGTH,
} from './hackathonHistory.validator.js';

describe('Hackathon History Validator (US-007 / #US-007-T3)', () => {
  describe('normalizeAndValidateEventDate', () => {
    it('accepts YYYY-MM format and normalizes to first of the month', () => {
      const res = normalizeAndValidateEventDate('2024-05');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe('2024-05-01');
      }
    });

    it('accepts valid YYYY-MM-DD format', () => {
      const res = normalizeAndValidateEventDate('2024-05-15');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe('2024-05-15');
      }
    });

    it('rejects non-string inputs and malformed strings', () => {
      expect(normalizeAndValidateEventDate(null).ok).toBe(false);
      expect(normalizeAndValidateEventDate(12345).ok).toBe(false);
      expect(normalizeAndValidateEventDate('not-a-date').ok).toBe(false);
      expect(normalizeAndValidateEventDate('05-2024').ok).toBe(false);
      expect(normalizeAndValidateEventDate('2024/05/01').ok).toBe(false);
    });

    it('rejects invalid calendar dates (e.g. Feb 31, April 31, month 13)', () => {
      expect(normalizeAndValidateEventDate('2026-02-31').ok).toBe(false);
      expect(normalizeAndValidateEventDate('2026-04-31').ok).toBe(false);
      expect(normalizeAndValidateEventDate('2026-13-01').ok).toBe(false);
      expect(normalizeAndValidateEventDate('2025-02-29').ok).toBe(false); // 2025 is not a leap year
    });

    it('rejects dates before MIN_EVENT_DATE (2000-01-01)', () => {
      const res = normalizeAndValidateEventDate('1999-12-31');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toContain(MIN_EVENT_DATE);
      }
    });

    it('rejects dates in the future', () => {
      const futureYear = new Date().getUTCFullYear() + 2;
      const res = normalizeAndValidateEventDate(`${futureYear}-01-01`);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toBe('Event date cannot be in the future.');
      }
    });
  });

  describe('validateHackathonHistoryInput', () => {
    const validPayload = {
      eventName: 'Hack The North 2024',
      eventDate: '2024-09-14',
      teamRole: 'Frontend',
      projectTitle: 'EcoTracker',
      projectUrl: 'https://github.com/example/ecotracker',
    };

    it('accepts valid camelCase payload', () => {
      const res = validateHackathonHistoryInput(validPayload);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.value).toEqual({
        event_name: 'Hack The North 2024',
        event_date: '2024-09-14',
        team_role: 'Frontend',
        project_title: 'EcoTracker',
        project_url: 'https://github.com/example/ecotracker',
      });
    });

    it('accepts valid snake_case payload', () => {
      const res = validateHackathonHistoryInput({
        event_name: 'UofT Hacks XI',
        event_date: '2024-01-20',
        team_role: 'Backend',
        project_title: 'TransitBot',
        project_url: 'https://devpost.com/software/transitbot',
      });
      expect(res.valid).toBe(true);
      expect(res.value?.event_name).toBe('UofT Hacks XI');
      expect(res.value?.team_role).toBe('Backend');
    });

    it('rejects non-object body', () => {
      expect(validateHackathonHistoryInput(null).valid).toBe(false);
      expect(validateHackathonHistoryInput('string').valid).toBe(false);
      expect(validateHackathonHistoryInput([]).valid).toBe(false);
    });

    it('rejects privilege-escalation fields in body', () => {
      const res = validateHackathonHistoryInput({
        ...validPayload,
        participantId: 'hacked-id',
        role: 'ADMIN',
        experienceBadge: 'Veteran',
        isVerified: true,
      });
      expect(res.valid).toBe(false);
      const fields = res.errors.map((e) => e.field);
      expect(fields).toContain('participantId');
      expect(fields).toContain('role');
      expect(fields).toContain('experienceBadge');
      expect(fields).toContain('isVerified');
    });

    it('validates event name boundaries', () => {
      const tooShort = validateHackathonHistoryInput({ ...validPayload, eventName: 'A' });
      expect(tooShort.valid).toBe(false);
      expect(tooShort.errors[0]?.field).toBe('eventName');

      const tooLong = validateHackathonHistoryInput({
        ...validPayload,
        eventName: 'A'.repeat(EVENT_NAME_MAX_LENGTH + 1),
      });
      expect(tooLong.valid).toBe(false);
      expect(tooLong.errors[0]?.field).toBe('eventName');
    });

    it('validates team role against allowed roles', () => {
      const res = validateHackathonHistoryInput({ ...validPayload, teamRole: 'ScrumMaster' });
      expect(res.valid).toBe(false);
      expect(res.errors[0]?.field).toBe('teamRole');
      expect(res.errors[0]?.message).toContain('Team role must be one of');
    });

    it('validates project title boundaries', () => {
      const tooShort = validateHackathonHistoryInput({ ...validPayload, projectTitle: 'P' });
      expect(tooShort.valid).toBe(false);
      expect(tooShort.errors[0]?.field).toBe('projectTitle');

      const tooLong = validateHackathonHistoryInput({
        ...validPayload,
        projectTitle: 'P'.repeat(PROJECT_TITLE_MAX_LENGTH + 1),
      });
      expect(tooLong.valid).toBe(false);
      expect(tooLong.errors[0]?.field).toBe('projectTitle');
    });

    it('validates project URL (must be valid HTTPS URL and max 500 chars)', () => {
      expect(validateHackathonHistoryInput({ ...validPayload, projectUrl: 'http://insecure.com' }).valid).toBe(false);
      expect(validateHackathonHistoryInput({ ...validPayload, projectUrl: 'javascript:alert(1)' }).valid).toBe(false);
      expect(validateHackathonHistoryInput({ ...validPayload, projectUrl: 'ftp://files.com/p' }).valid).toBe(false);
      expect(validateHackathonHistoryInput({ ...validPayload, projectUrl: 'https://' }).valid).toBe(false);
      expect(validateHackathonHistoryInput({
        ...validPayload,
        projectUrl: `https://example.com/${'a'.repeat(PROJECT_URL_MAX_LENGTH)}`,
      }).valid).toBe(false);
    });

    it('accumulates multiple field validation errors', () => {
      const res = validateHackathonHistoryInput({
        eventName: 'X',
        eventDate: 'invalid-date',
        teamRole: 'InvalidRole',
        projectTitle: '',
        projectUrl: 'http://plain.com',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThanOrEqual(5);
    });
  });
});
