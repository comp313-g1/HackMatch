import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  validateCandidateDirectoryQuery,
  validateCandidateDirectoryQueryMiddleware,
  ALLOWED_EXPERIENCE_BADGES,
  ALLOWED_GOALS,
  MAX_FILTER_SKILLS,
  MAX_SKILL_LENGTH,
  MAX_SEARCH_LENGTH,
} from './candidateDirectory.validator.js';

describe('Candidate Directory Validator (US-014-T2)', () => {
  describe('validateCandidateDirectoryQuery', () => {
    it('returns default sanitized filters when given an empty query', () => {
      const res = validateCandidateDirectoryQuery({});
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.filters).toEqual({
          skills: [],
          skillMatchMode: 'AND',
          role: null,
          desiredRole: null,
          minHours: null,
          maxHours: null,
          badge: null,
          goal: null,
          search: null,
        });
      }
    });

    it('parses and deduplicates skills case-insensitively while preserving first casing', () => {
      const res = validateCandidateDirectoryQuery({
        skills: 'React, TypeScript, react, Python, typescript',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.filters.skills).toEqual(['React', 'TypeScript', 'Python']);
      }
    });

    it('supports skills as an array', () => {
      const res = validateCandidateDirectoryQuery({
        skills: ['React', 'Node.js', 'react'],
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.filters.skills).toEqual(['React', 'Node.js']);
      }
    });

    it('rejects more than 10 filter skills', () => {
      const elevenSkills = Array.from({ length: 11 }, (_, i) => `skill${i}`);
      const res = validateCandidateDirectoryQuery({ skills: elevenSkills });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.skills).toBe(`Skills filter cannot exceed ${MAX_FILTER_SKILLS} skills.`);
      }
    });

    it('rejects individual skill tag exceeding 50 characters', () => {
      const longSkill = 'a'.repeat(51);
      const res = validateCandidateDirectoryQuery({ skills: [longSkill] });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.skills).toBe(`Each skill cannot exceed ${MAX_SKILL_LENGTH} characters.`);
      }
    });

    it('validates skillMatchMode (AND / OR)', () => {
      const resAnd = validateCandidateDirectoryQuery({ skillMatchMode: 'and' });
      expect(resAnd.ok).toBe(true);
      if (resAnd.ok) expect(resAnd.filters.skillMatchMode).toBe('AND');

      const resOr = validateCandidateDirectoryQuery({ matchMode: 'OR' });
      expect(resOr.ok).toBe(true);
      if (resOr.ok) expect(resOr.filters.skillMatchMode).toBe('OR');

      const resInvalid = validateCandidateDirectoryQuery({ skillMatchMode: 'XOR' });
      expect(resInvalid.ok).toBe(false);
      if (!resInvalid.ok) expect(resInvalid.errors.skillMatchMode).toBe('Skill match mode must be "AND" or "OR".');
    });

    it('validates role and desiredRole against allowed primary roles', () => {
      const resValid = validateCandidateDirectoryQuery({
        role: 'frontend',
        desiredRole: 'Backend',
      });
      expect(resValid.ok).toBe(true);
      if (resValid.ok) {
        expect(resValid.filters.role).toBe('Frontend');
        expect(resValid.filters.desiredRole).toBe('Backend');
      }

      const resInvalid = validateCandidateDirectoryQuery({
        role: 'Wizard',
        desiredRole: 'Ninja',
      });
      expect(resInvalid.ok).toBe(false);
      if (!resInvalid.ok) {
        expect(resInvalid.errors.role).toBeDefined();
        expect(resInvalid.errors.desiredRole).toBeDefined();
      }
    });

    it('validates team goal', () => {
      for (const goal of ALLOWED_GOALS) {
        const res = validateCandidateDirectoryQuery({ goal });
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.filters.goal).toBe(goal);
      }

      const resInvalid = validateCandidateDirectoryQuery({ goal: 'JustForFun' });
      expect(resInvalid.ok).toBe(false);
      if (!resInvalid.ok) expect(resInvalid.errors.goal).toBeDefined();
    });

    it('validates experience badge', () => {
      for (const badge of ALLOWED_EXPERIENCE_BADGES) {
        const res = validateCandidateDirectoryQuery({ badge });
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.filters.badge).toBe(badge);
      }

      const resInvalid = validateCandidateDirectoryQuery({ badge: 'Grandmaster' });
      expect(resInvalid.ok).toBe(false);
      if (!resInvalid.ok) expect(resInvalid.errors.badge).toBeDefined();
    });

    it('validates commitment hours within bounds [1, 168]', () => {
      const resValid = validateCandidateDirectoryQuery({ minHours: '10', maxHours: '40' });
      expect(resValid.ok).toBe(true);
      if (resValid.ok) {
        expect(resValid.filters.minHours).toBe(10);
        expect(resValid.filters.maxHours).toBe(40);
      }

      const resLow = validateCandidateDirectoryQuery({ minHours: '0' });
      expect(resLow.ok).toBe(false);
      if (!resLow.ok) expect(resLow.errors.minHours).toBeDefined();

      const resHigh = validateCandidateDirectoryQuery({ maxHours: '169' });
      expect(resHigh.ok).toBe(false);
      if (!resHigh.ok) expect(resHigh.errors.maxHours).toBeDefined();
    });

    it('rejects when minHours exceeds maxHours with errors.hours', () => {
      const res = validateCandidateDirectoryQuery({ minHours: '50', maxHours: '20' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.hours).toBe('Minimum commitment hours cannot exceed maximum commitment hours.');
      }
    });

    it('validates search query within max 80 characters', () => {
      const resValid = validateCandidateDirectoryQuery({ search: '  alice coder  ' });
      expect(resValid.ok).toBe(true);
      if (resValid.ok) expect(resValid.filters.search).toBe('alice coder');

      const longSearch = 's'.repeat(81);
      const resInvalid = validateCandidateDirectoryQuery({ search: longSearch });
      expect(resInvalid.ok).toBe(false);
      if (!resInvalid.ok) {
        expect(resInvalid.errors.search).toBe(`Search query cannot exceed ${MAX_SEARCH_LENGTH} characters.`);
      }
    });
  });

  describe('validateCandidateDirectoryQueryMiddleware', () => {
    it('attaches sanitized filters to res.locals and calls next on valid query', () => {
      const req = {
        query: { skills: 'React', role: 'Frontend', minHours: '10' },
      } as unknown as Request;
      const res = {
        locals: {},
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      validateCandidateDirectoryQueryMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.locals.candidateDirectoryFilters).toEqual(
        expect.objectContaining({
          skills: ['React'],
          role: 'Frontend',
          minHours: 10,
        })
      );
    });

    it('returns 400 VALIDATION_ERROR on invalid query parameters', () => {
      const req = {
        query: { minHours: '50', maxHours: '10', skillMatchMode: 'INVALID' },
      } as unknown as Request;
      const res = {
        locals: {},
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      validateCandidateDirectoryQueryMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid candidate directory filter parameters.',
        code: 'VALIDATION_ERROR',
        errors: expect.objectContaining({
          hours: 'Minimum commitment hours cannot exceed maximum commitment hours.',
          skillMatchMode: 'Skill match mode must be "AND" or "OR".',
        }),
      });
    });
  });
});
