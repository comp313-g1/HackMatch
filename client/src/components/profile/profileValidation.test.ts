import { describe, it, expect } from 'vitest';
import {
  PRIMARY_ROLES,
  isValidHttpsPortfolioUrl,
  parseSkillsInput,
  validateProfileForm,
} from './profileValidation';

describe('Client Profile Validation (US-006 / #65)', () => {
  it('validates HTTPS portfolio URLs and rejects HTTP or malformed URLs', () => {
    expect(isValidHttpsPortfolioUrl('https://github.com/jane')).toBe(true);
    expect(isValidHttpsPortfolioUrl('https://jane.dev/portfolio')).toBe(true);
    expect(isValidHttpsPortfolioUrl('http://github.com/jane')).toBe(false);
    expect(isValidHttpsPortfolioUrl('https://localhost:5173')).toBe(false);
    expect(isValidHttpsPortfolioUrl('javascript:alert(1)')).toBe(false);
  });

  it('parses and deduplicates comma-separated skill tags case-insensitively', () => {
    const parsed = parseSkillsInput('React, TypeScript, react, Node.js');
    expect(parsed.error).toBeUndefined();
    expect(parsed.skills).toEqual(['React', 'TypeScript', 'Node.js']);
  });

  it('rejects empty comma-separated skill segments or overly long skill tags', () => {
    expect(parseSkillsInput('React, , Node.js').error).toContain('non-empty');
    expect(parseSkillsInput('A'.repeat(51)).error).toContain('50 characters');
  });

  it('accepts all canonical primary roles and rejects invalid role values', () => {
    for (const role of PRIMARY_ROLES) {
      const res = validateProfileForm({
        handle: 'jane_dev',
        primaryRole: role,
        institution: 'Centennial College',
        skillsInput: 'React, TypeScript',
        portfolioLinks: [{ url: 'https://github.com/jane', label: 'GitHub' }],
        sharedContactHandle: '@jane_discord',
      });
      expect(res.errors).toEqual({});
      expect(res.payload?.primaryRole).toBe(role);
    }

    const invalid = validateProfileForm({
      handle: 'jane_dev',
      primaryRole: 'InvalidRole',
      institution: 'Centennial College',
      skillsInput: 'React',
      portfolioLinks: [],
      sharedContactHandle: '',
    });
    expect(invalid.errors.primaryRole).toBeDefined();
  });

  it('returns field-specific errors for non-HTTPS URLs and overly long institution without mutating input state', () => {
    const inputState = {
      handle: 'jane_dev',
      primaryRole: 'Frontend',
      institution: 'I'.repeat(151),
      skillsInput: 'React, TypeScript',
      portfolioLinks: [{ url: 'http://not-https.example.com', label: 'Portfolio' }],
      sharedContactHandle: '@jane_discord',
    };

    const res = validateProfileForm(inputState);
    expect(res.errors.institution).toContain('150 characters');
    expect(res.errors.portfolioLinks).toContain('HTTPS URLs');
    expect(inputState.handle).toBe('jane_dev');
    expect(inputState.skillsInput).toBe('React, TypeScript');
  });
});
