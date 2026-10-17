import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  ALLOWED_PRIMARY_ROLES,
  isValidHttpsPortfolioUrl,
  validateProfileUpdateInput,
  validateProfileUpdatePayload,
} from './profile.validator.js';

describe('Server Profile Validator (US-006 / #65)', () => {
  describe('isValidHttpsPortfolioUrl', () => {
    it('accepts valid HTTPS portfolio URLs', () => {
      expect(isValidHttpsPortfolioUrl('https://github.com/alex_dev')).toBe(true);
      expect(isValidHttpsPortfolioUrl('https://portfolio.alex.dev/projects/hackmatch')).toBe(true);
      expect(isValidHttpsPortfolioUrl('  https://linkedin.com/in/alex-dev  ')).toBe(true);
    });

    it('rejects non-HTTPS, malformed, short, credential-embedded, or localhost URLs', () => {
      expect(isValidHttpsPortfolioUrl('http://github.com/alex_dev')).toBe(false);
      expect(isValidHttpsPortfolioUrl('ftp://github.com/alex_dev')).toBe(false);
      expect(isValidHttpsPortfolioUrl('javascript:alert(1)')).toBe(false);
      expect(isValidHttpsPortfolioUrl('https://')).toBe(false);
      expect(isValidHttpsPortfolioUrl('https://a')).toBe(false);
      expect(isValidHttpsPortfolioUrl('https://localhost:3000')).toBe(false);
      expect(isValidHttpsPortfolioUrl('https://127.0.0.1/profile')).toBe(false);
      expect(isValidHttpsPortfolioUrl('https://user:pass@github.com/alex')).toBe(false);
      expect(isValidHttpsPortfolioUrl('https://github..com/alex')).toBe(false);
      expect(isValidHttpsPortfolioUrl('https://github.com/alex dev')).toBe(false);
      expect(isValidHttpsPortfolioUrl(`https://github.com/${'a'.repeat(2045)}`)).toBe(false);
    });
  });

  describe('validateProfileUpdateInput', () => {
    it('accepts all six canonical primary roles (Frontend, Backend, Mobile, AI/ML, UI/UX, Pitch)', () => {
      for (const role of ALLOWED_PRIMARY_ROLES) {
        const result = validateProfileUpdateInput({ primaryRole: role });
        expect(result.errors).toEqual({});
        expect(result.sanitized?.primaryRole).toBe(role);
      }
    });

    it('rejects unknown primary roles with a field-specific error', () => {
      const result = validateProfileUpdateInput({ primaryRole: 'DevOps' });
      expect(result.errors.primaryRole).toContain('Primary role must be one of');
      expect(result.sanitized).toBeUndefined();
    });

    it('validates and deduplicates skill tags case-insensitively while preserving first casing', () => {
      const result = validateProfileUpdateInput({
        skills: ['  TypeScript ', 'typescript', 'React', 'Node.js'],
      });
      expect(result.errors).toEqual({});
      expect(result.sanitized?.skills).toEqual(['TypeScript', 'React', 'Node.js']);
    });

    it('rejects non-array skills, empty skill tags, >50 char tags, and >25 tags', () => {
      expect(validateProfileUpdateInput({ skills: 'React' }).errors.skills).toBeDefined();
      expect(validateProfileUpdateInput({ skills: ['React', '   '] }).errors.skills).toContain(
        'non-empty'
      );
      expect(
        validateProfileUpdateInput({ skills: ['a'.repeat(51)] }).errors.skills
      ).toContain('50 characters');
      const twentySixSkills = Array.from({ length: 26 }, (_, i) => `Skill${i}`);
      expect(validateProfileUpdateInput({ skills: twentySixSkills }).errors.skills).toContain(
        'at most 25'
      );
    });

    it('validates academic institution length (max 150 chars)', () => {
      const valid = validateProfileUpdateInput({
        institution: '  Centennial College  ',
      });
      expect(valid.errors).toEqual({});
      expect(valid.sanitized?.institution).toBe('Centennial College');

      const tooLong = validateProfileUpdateInput({
        institution: 'U'.repeat(151),
      });
      expect(tooLong.errors.institution).toContain('150 characters');
    });

    it('validates HTTPS portfolio URLs and optional labels (max 100 chars)', () => {
      const valid = validateProfileUpdateInput({
        portfolioLinks: [
          'https://github.com/alex',
          { url: 'https://alex.dev', label: 'Personal Site' },
        ],
      });
      expect(valid.errors).toEqual({});
      expect(valid.sanitized?.portfolioLinks).toEqual([
        { url: 'https://github.com/alex', label: null },
        { url: 'https://alex.dev', label: 'Personal Site' },
      ]);

      const nonHttps = validateProfileUpdateInput({
        portfolioLinks: [{ url: 'http://alex.dev', label: 'Site' }],
      });
      expect(nonHttps.errors.portfolioLinks).toContain('HTTPS URLs');

      const longLabel = validateProfileUpdateInput({
        portfolioLinks: [{ url: 'https://alex.dev', label: 'L'.repeat(101) }],
      });
      expect(longLabel.errors.portfolioLinks).toContain('100 characters');
    });

    it('validates handle format and sharedContactHandle length', () => {
      const invalidHandle = validateProfileUpdateInput({ handle: 'a' });
      expect(invalidHandle.errors.handle).toBeDefined();

      const invalidContact = validateProfileUpdateInput({
        sharedContactHandle: 'c'.repeat(151),
      });
      expect(invalidContact.errors.sharedContactHandle).toContain('150 characters');
    });
  });

  describe('validateProfileUpdatePayload middleware', () => {
    function createMockRes() {
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as unknown as Response;
      return res;
    }

    it('rejects privilege escalation keys with 403 FORBIDDEN_ROLE_CHANGE', () => {
      const req = { body: { primaryRole: 'Backend', isAdmin: true } } as Request;
      const res = createMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateProfileUpdatePayload(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when payload is valid', () => {
      const req = {
        body: {
          handle: 'valid_user',
          primaryRole: 'UI/UX',
          institution: 'Centennial College',
          skills: ['Figma'],
          portfolioLinks: [{ url: 'https://dribbble.com/valid_user', label: 'Dribbble' }],
        },
      } as Request;
      const res = createMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateProfileUpdatePayload(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('returns simultaneous field-specific errors with 400 when multiple fields are invalid (US-006 AC 5 / #68)', () => {
      const req = {
        body: {
          handle: '!',
          primaryRole: 'Architect',
          institution: 'I'.repeat(151),
          skills: ['Valid', '   '],
          portfolioLinks: [{ url: 'http://insecure.test', label: 'Insecure' }],
          sharedContactHandle: 'C'.repeat(151),
        },
      } as Request;
      const res = createMockRes();
      const next = vi.fn() as unknown as NextFunction;

      validateProfileUpdatePayload(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          errors: expect.objectContaining({
            handle: expect.stringContaining('Handle must be 2 to 50 characters'),
            primaryRole: expect.stringContaining('Primary role must be one of'),
            institution: expect.stringContaining('150 characters'),
            skills: expect.stringContaining('non-empty'),
            portfolioLinks: expect.stringContaining('HTTPS URLs'),
            sharedContactHandle: expect.stringContaining('150 characters'),
          }),
        })
      );
    });

    it('deduplicates portfolio URLs case-insensitively while preserving first label (US-006 AC 2 / #68)', () => {
      const sanitized = validateProfileUpdateInput({
        portfolioLinks: [
          { url: 'https://github.com/alex', label: 'Primary' },
          { url: 'HTTPS://GITHUB.COM/ALEX', label: 'Duplicate' },
        ],
      });
      expect(sanitized.errors).toEqual({});
      expect(sanitized.sanitized?.portfolioLinks).toEqual([
        { url: 'https://github.com/alex', label: 'Primary' },
      ]);
    });
  });
});
