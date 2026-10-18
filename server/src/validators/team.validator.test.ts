import { describe, it, expect } from 'vitest';
import {
  codePointLength,
  validateCreateTeamInput,
  validateUpdateTeamInput,
  validateVacancyInput,
  validateRemovalReason,
} from './team.validator.js';

describe('team.validator unit tests (US-012 / #121)', () => {
  const validEventId = '11111111-1111-4111-8111-111111111111';

  const validCreatePayload = {
    eventId: validEventId,
    name: 'HackMatch Innovators',
    pitch: 'Building accessible pair-programming tools',
    goal: 'Project Completion',
    commitmentHours: 20.5,
    communicationLink: 'https://discord.gg/example',
  };

  describe('codePointLength helper', () => {
    it('counts unicode code points instead of UTF-16 code units', () => {
      expect(codePointLength('Hello')).toBe(5);
      expect('🚀'.length).toBe(2); // UTF-16 length
      expect(codePointLength('🚀')).toBe(1); // Unicode code point length
      expect(codePointLength('🚀'.repeat(500))).toBe(500);
    });
  });

  describe('validateCreateTeamInput', () => {
    it('accepts valid input and normalizes goals, link, and whitespace', () => {
      const result = validateCreateTeamInput({
        ...validCreatePayload,
        goal: '   project   completion  ',
        pitch: 'Line 1\r\nLine 2',
      });

      expect(Object.keys(result.errors)).toHaveLength(0);
      expect(result.sanitized?.goal).toBe('Project Completion');
      expect(result.sanitized?.pitch).toBe('Line 1\nLine 2');
      expect(result.sanitized?.commitmentHours).toBe(20.5);
    });

    it('accepts 500 emojis in pitch and rejects 501 emojis', () => {
      const pitch500 = '🔥'.repeat(500);
      const pitch501 = '🔥'.repeat(501);

      const okResult = validateCreateTeamInput({ ...validCreatePayload, pitch: pitch500 });
      expect(okResult.errors.pitch).toBeUndefined();
      expect(okResult.sanitized?.pitch).toBe(pitch500);

      const errResult = validateCreateTeamInput({ ...validCreatePayload, pitch: pitch501 });
      expect(errResult.errors.pitch).toBe('Pitch cannot exceed 500 characters.');
    });

    it('rejects blank or whitespace pitch and name', () => {
      const result = validateCreateTeamInput({
        ...validCreatePayload,
        name: '   ',
        pitch: '   \r\n   ',
      });

      expect(result.errors.name).toBe('Team name is required.');
      expect(result.errors.pitch).toBe('Pitch is required.');
    });

    it('rejects unrecognised goal and normalizes lowercase goal', () => {
      const invalid = validateCreateTeamInput({ ...validCreatePayload, goal: 'Fun and Vibes' });
      expect(invalid.errors.goal).toBe('Invalid team goal. Must be Learning, Project Completion, or Competitive.');

      const normalized = validateCreateTeamInput({ ...validCreatePayload, goal: '  learning ' });
      expect(normalized.errors.goal).toBeUndefined();
      expect(normalized.sanitized?.goal).toBe('Learning');
    });

    it('validates commitmentHours bounds 0..168 and max 1 decimal place', () => {
      expect(validateCreateTeamInput({ ...validCreatePayload, commitmentHours: 0 }).errors.commitmentHours).toBeUndefined();
      expect(validateCreateTeamInput({ ...validCreatePayload, commitmentHours: 168 }).errors.commitmentHours).toBeUndefined();
      expect(validateCreateTeamInput({ ...validCreatePayload, commitmentHours: 7.5 }).errors.commitmentHours).toBeUndefined();

      expect(validateCreateTeamInput({ ...validCreatePayload, commitmentHours: -0.1 }).errors.commitmentHours).toBe('Commitment hours must be between 0 and 168.');
      expect(validateCreateTeamInput({ ...validCreatePayload, commitmentHours: 168.1 }).errors.commitmentHours).toBe('Commitment hours must be between 0 and 168.');
      expect(validateCreateTeamInput({ ...validCreatePayload, commitmentHours: 7.25 }).errors.commitmentHours).toBe('Commitment hours cannot have more than 1 decimal place.');
      expect(validateCreateTeamInput({ ...validCreatePayload, commitmentHours: '20' as unknown as number }).errors.commitmentHours).toBe('Commitment hours must be a number between 0 and 168 with at most one decimal place.');
      expect(validateCreateTeamInput({ ...validCreatePayload, commitmentHours: NaN }).errors.commitmentHours).toBe('Commitment hours must be a number between 0 and 168 with at most one decimal place.');
    });

    it('sanitizes communicationLink: nulls empty/whitespace, accepts valid HTTPS, rejects unsafe URLs', () => {
      const emptyResult = validateCreateTeamInput({ ...validCreatePayload, communicationLink: '' });
      expect(emptyResult.errors.communicationLink).toBeUndefined();
      expect(emptyResult.sanitized?.communicationLink).toBeNull();

      const wsResult = validateCreateTeamInput({ ...validCreatePayload, communicationLink: '   ' });
      expect(wsResult.sanitized?.communicationLink).toBeNull();

      expect(validateCreateTeamInput({ ...validCreatePayload, communicationLink: 'http://insecure.com' }).errors.communicationLink).toBeDefined();
      expect(validateCreateTeamInput({ ...validCreatePayload, communicationLink: 'javascript:alert(1)' }).errors.communicationLink).toBeDefined();
      expect(validateCreateTeamInput({ ...validCreatePayload, communicationLink: 'https://user:pass@host.com' }).errors.communicationLink).toBeDefined();
      expect(validateCreateTeamInput({ ...validCreatePayload, communicationLink: `https://site.com/${'a'.repeat(2048)}` }).errors.communicationLink).toBeDefined();
    });

    it('rejects unknown keys to block mass-assignment', () => {
      const result = validateCreateTeamInput({
        ...validCreatePayload,
        ownerParticipantId: 'hacked-id',
        recruitmentStatus: 'Locked',
      });

      expect(result.errors.ownerParticipantId).toBe('This field cannot be set.');
      expect(result.errors.recruitmentStatus).toBe('This field cannot be set.');
    });
  });

  describe('validateUpdateTeamInput', () => {
    it('rejects empty payload when no recognized change is provided', () => {
      const result = validateUpdateTeamInput({});
      expect(result.errors._form).toBe('No changes provided.');
    });

    it('rejects unknown keys on PATCH', () => {
      const result = validateUpdateTeamInput({
        eventId: validEventId,
        pitch: 'Updated pitch',
      });
      expect(result.errors.eventId).toBe('This field cannot be set.');
    });

    it('accepts partial updates and clears communicationLink when set to null or empty string', () => {
      const result = validateUpdateTeamInput({
        pitch: 'Updated pitch for the team',
        communicationLink: '',
      });

      expect(Object.keys(result.errors)).toHaveLength(0);
      expect(result.sanitized?.pitch).toBe('Updated pitch for the team');
      expect(result.sanitized?.communicationLink).toBeNull();
    });
  });

  describe('validateVacancyInput', () => {
    it('accepts valid role and deduplicates skill tags case-insensitively preserving first casing', () => {
      const result = validateVacancyInput({
        role: 'frontend',
        skills: ['React', 'react', 'TypeScript', '  UI / UX  '],
      });

      expect(Object.keys(result.errors)).toHaveLength(0);
      expect(result.sanitized?.role).toBe('Frontend');
      expect(result.sanitized?.skills).toEqual(['React', 'TypeScript', 'UI / UX']);
    });

    it('rejects invalid role', () => {
      const result = validateVacancyInput({ role: 'Designer', skills: [] });
      expect(result.errors.role).toContain('Invalid role');
    });

    it('rejects when skills count exceeds 10', () => {
      const elevenSkills = Array.from({ length: 11 }, (_, i) => `Skill${i}`);
      const result = validateVacancyInput({ role: 'Backend', skills: elevenSkills });
      expect(result.errors.skills).toBe('Cannot have more than 10 skills per vacancy.');
    });

    it('rejects skill item exceeding 50 characters or non-string', () => {
      const longSkill = 'a'.repeat(51);
      const result = validateVacancyInput({ role: 'Backend', skills: [longSkill] });
      expect(result.errors.skills).toBe('Each skill must be between 1 and 50 characters.');

      const nonString = validateVacancyInput({ role: 'Backend', skills: [123 as unknown as string] });
      expect(nonString.errors.skills).toBe('Skills must be an array of strings.');
    });

    it('stores potential XSS payload verbatim without server-side escaping (NR-009)', () => {
      const xssSkill = '<script>alert("xss")</script>';
      const result = validateVacancyInput({ role: 'AI/ML', skills: [xssSkill] });
      expect(result.sanitized?.skills[0]).toBe(xssSkill);
    });
  });

  describe('validateRemovalReason', () => {
    it('validates removal reason length between 1 and 500 characters', () => {
      expect(validateRemovalReason({ reason: '   ' }).errors.reason).toBe('Removal reason is required.');
      expect(validateRemovalReason({ reason: 'a'.repeat(500) }).errors.reason).toBeUndefined();
      expect(validateRemovalReason({ reason: 'a'.repeat(501) }).errors.reason).toBe('Removal reason cannot exceed 500 characters.');
    });
  });
});
