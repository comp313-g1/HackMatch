import { describe, it, expect } from 'vitest';
import {
  codePointLength,
  normalizeGoal,
  validateTeamListingForm,
  validateVacancyForm,
  validateRemovalReason,
} from './teamValidation';

describe('teamValidation unit tests (US-012 / Task 8 / #125)', () => {
  describe('codePointLength', () => {
    it('correctly counts ASCII characters and multi-byte unicode emojis', () => {
      expect(codePointLength('Hello')).toBe(5);
      // Emoji 🚀 is 2 UTF-16 code units but 1 code point
      expect(codePointLength('🚀')).toBe(1);
      expect(codePointLength('Team 🚀 💡')).toBe(8);
    });
  });

  describe('normalizeGoal', () => {
    it('normalizes case-insensitively to canonical casing', () => {
      expect(normalizeGoal('learning')).toBe('Learning');
      expect(normalizeGoal('  PROJECT   completion  ')).toBe('Project Completion');
      expect(normalizeGoal('COMPETITIVE')).toBe('Competitive');
    });

    it('returns null for unrecognised goals or invalid types', () => {
      expect(normalizeGoal('Fun')).toBeNull();
      expect(normalizeGoal('')).toBeNull();
      expect(normalizeGoal(null)).toBeNull();
    });
  });

  describe('validateTeamListingForm', () => {
    const validForm = {
      name: 'HackMatch Stars',
      pitch: 'Building accessible software for everyone.',
      goal: 'Project Completion',
      commitmentHours: '20.5',
      communicationLink: 'https://discord.gg/hackmatch',
    };

    it('accepts valid input and produces sanitized payload', () => {
      const result = validateTeamListingForm(validForm, 'create');
      expect(result.errors).toEqual({});
      expect(result.payload).toEqual({
        name: 'HackMatch Stars',
        pitch: 'Building accessible software for everyone.',
        goal: 'Project Completion',
        commitmentHours: 20.5,
        communicationLink: 'https://discord.gg/hackmatch',
      });
    });

    it('accepts 500 code point pitch and 500 emojis (1000 UTF-16 units)', () => {
      const emoji500 = '🚀'.repeat(500);
      expect(emoji500.length).toBe(1000); // 1000 UTF-16 code units
      expect(codePointLength(emoji500)).toBe(500);

      const result = validateTeamListingForm({ ...validForm, pitch: emoji500 }, 'create');
      expect(result.errors.pitch).toBeUndefined();
      expect(result.payload?.pitch).toBe(emoji500);
    });

    it('rejects pitch exceeding 500 code points', () => {
      const emoji501 = '🚀'.repeat(501);
      const result = validateTeamListingForm({ ...validForm, pitch: emoji501 }, 'create');
      expect(result.errors.pitch).toBe('Pitch cannot exceed 500 characters.');
    });

    it('rejects empty or whitespace-only pitch', () => {
      const result = validateTeamListingForm({ ...validForm, pitch: '   \n  \r\n ' }, 'create');
      expect(result.errors.pitch).toBe('Pitch is required.');
    });

    it('rejects empty name or name exceeding 100 characters', () => {
      const emptyRes = validateTeamListingForm({ ...validForm, name: '   ' }, 'create');
      expect(emptyRes.errors.name).toBe('Team name is required.');

      const longRes = validateTeamListingForm(
        { ...validForm, name: 'a'.repeat(101) },
        'create'
      );
      expect(longRes.errors.name).toBe('Team name cannot exceed 100 characters.');
    });

    it('validates commitment hours strictly (0..168, <= 1 decimal place)', () => {
      expect(
        validateTeamListingForm({ ...validForm, commitmentHours: '0' }, 'create').errors
          .commitmentHours
      ).toBeUndefined();
      expect(
        validateTeamListingForm({ ...validForm, commitmentHours: '168' }, 'create').errors
          .commitmentHours
      ).toBeUndefined();
      expect(
        validateTeamListingForm({ ...validForm, commitmentHours: '15.5' }, 'create').errors
          .commitmentHours
      ).toBeUndefined();

      expect(
        validateTeamListingForm({ ...validForm, commitmentHours: '-0.1' }, 'create').errors
          .commitmentHours
      ).toBeDefined();
      expect(
        validateTeamListingForm({ ...validForm, commitmentHours: '168.1' }, 'create').errors
          .commitmentHours
      ).toBeDefined();
      expect(
        validateTeamListingForm({ ...validForm, commitmentHours: '15.25' }, 'create').errors
          .commitmentHours
      ).toBe('Commitment hours cannot have more than 1 decimal place.');
      expect(
        validateTeamListingForm({ ...validForm, commitmentHours: 'not-a-number' }, 'create')
          .errors.commitmentHours
      ).toBeDefined();
    });

    it('handles communication link optionality and rejects invalid URLs / credentials', () => {
      // Empty string normalizes to null
      const emptyRes = validateTeamListingForm(
        { ...validForm, communicationLink: '' },
        'create'
      );
      expect(emptyRes.errors.communicationLink).toBeUndefined();
      expect(emptyRes.payload?.communicationLink).toBeNull();

      // Non-HTTPS rejected
      const httpRes = validateTeamListingForm(
        { ...validForm, communicationLink: 'http://example.com' },
        'create'
      );
      expect(httpRes.errors.communicationLink).toBeDefined();

      // Javascript link rejected
      const jsRes = validateTeamListingForm(
        { ...validForm, communicationLink: 'javascript:alert(1)' },
        'create'
      );
      expect(jsRes.errors.communicationLink).toBeDefined();

      // Embedded credentials rejected
      const credRes = validateTeamListingForm(
        { ...validForm, communicationLink: 'https://user:pass@example.com' },
        'create'
      );
      expect(credRes.errors.communicationLink).toBeDefined();
    });

    it('detects when no changes are made in edit mode', () => {
      const initial = {
        name: 'HackMatch Stars',
        pitch: 'Building accessible software for everyone.',
        goal: 'Project Completion',
        commitmentHours: '20.5',
        communicationLink: 'https://discord.gg/hackmatch',
      };

      const result = validateTeamListingForm(validForm, 'edit', initial);
      expect(result.errors._form).toBe('No changes provided.');
    });
  });

  describe('validateVacancyForm', () => {
    it('accepts valid role and skills', () => {
      const result = validateVacancyForm({
        role: 'ai/ml',
        skillsInput: 'PyTorch, Python, TensorFlow',
      });
      expect(result.errors).toEqual({});
      expect(result.payload).toEqual({
        role: 'AI/ML',
        skills: ['PyTorch', 'Python', 'TensorFlow'],
      });
    });

    it('allows empty skills array (empty input is valid)', () => {
      const result = validateVacancyForm({
        role: 'Frontend',
        skillsInput: '   ',
      });
      expect(result.errors).toEqual({});
      expect(result.payload).toEqual({
        role: 'Frontend',
        skills: [],
      });
    });

    it('deduplicates skills case-insensitively and preserves first-seen casing', () => {
      const result = validateVacancyForm({
        role: 'Frontend',
        skillsInput: 'React, TypeScript, react, TYPESCRIPT, Next.js',
      });
      expect(result.errors).toEqual({});
      expect(result.payload?.skills).toEqual(['React', 'TypeScript', 'Next.js']);
    });

    it('rejects invalid role', () => {
      const result = validateVacancyForm({
        role: 'Product Manager',
        skillsInput: 'Agile',
      });
      expect(result.errors.role).toBeDefined();
    });

    it('rejects more than 10 skills', () => {
      const skills = Array.from({ length: 11 }, (_, i) => `skill-${i}`).join(',');
      const result = validateVacancyForm({
        role: 'Backend',
        skillsInput: skills,
      });
      expect(result.errors.skills).toBe('Cannot have more than 10 skills per vacancy.');
    });

    it('rejects skill item exceeding 50 characters', () => {
      const longSkill = 's'.repeat(51);
      const result = validateVacancyForm({
        role: 'Mobile',
        skillsInput: `Swift, ${longSkill}`,
      });
      expect(result.errors.skills).toBe('Each skill must be between 1 and 50 characters.');
    });
  });

  describe('validateRemovalReason', () => {
    it('accepts valid removal reason', () => {
      const result = validateRemovalReason('Member moved to a different timezone.');
      expect(result.errors).toEqual({});
      expect(result.sanitized?.reason).toBe('Member moved to a different timezone.');
    });

    it('rejects blank or whitespace reason', () => {
      expect(validateRemovalReason('').errors.reason).toBe('Removal reason is required.');
      expect(validateRemovalReason('   \n  ').errors.reason).toBe(
        'Removal reason is required.'
      );
    });

    it('rejects reason exceeding 500 characters', () => {
      const longReason = 'r'.repeat(501);
      expect(validateRemovalReason(longReason).errors.reason).toBe(
        'Removal reason cannot exceed 500 characters.'
      );
    });
  });
});
