import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  parseOpenTeamsQuery,
  validateOpenTeamsQuery,
  OPEN_TEAMS_MAX_SKILL_TAGS,
  OPEN_TEAMS_MAX_MIN_SLOTS,
} from './openTeams.validator.js';

describe('openTeams.validator unit tests (US-013 / Task 4)', () => {
  describe('parseOpenTeamsQuery', () => {
    it('returns default sanitized query when all parameters are unset', () => {
      const result = parseOpenTeamsQuery({});
      expect(result.errors).toEqual({});
      if ('sanitized' in result && result.sanitized) {
        expect(result.sanitized).toEqual({
          skills: [],
          role: null,
          goal: null,
          minSlots: 1,
        });
      }
    });

    it('treats empty or whitespace-only strings as unset', () => {
      const result = parseOpenTeamsQuery({
        skills: '   ',
        role: '  ',
        goal: '',
        minSlots: ' ',
      });
      expect(result.errors).toEqual({});
      if ('sanitized' in result && result.sanitized) {
        expect(result.sanitized).toEqual({
          skills: [],
          role: null,
          goal: null,
          minSlots: 1,
        });
      }
    });

    it('ignores unknown query keys', () => {
      const result = parseOpenTeamsQuery({
        foo: 'bar',
        eventId: 'ignored',
      });
      expect(result.errors).toEqual({});
      if ('sanitized' in result && result.sanitized) {
        expect(result.sanitized.minSlots).toBe(1);
      }
    });

    describe('minSlots validation', () => {
      it('accepts boundary values 1 and 20', () => {
        const res1 = parseOpenTeamsQuery({ minSlots: '1' });
        expect(res1.errors).toEqual({});
        if ('sanitized' in res1 && res1.sanitized) {
          expect(res1.sanitized.minSlots).toBe(1);
        }

        const res20 = parseOpenTeamsQuery({ minSlots: '20' });
        expect(res20.errors).toEqual({});
        if ('sanitized' in res20 && res20.sanitized) {
          expect(res20.sanitized.minSlots).toBe(20);
        }
      });

      it('rejects 0, 21, decimals, negative numbers, and non-numeric strings', () => {
        expect(parseOpenTeamsQuery({ minSlots: '0' }).errors.minSlots).toBeDefined();
        expect(parseOpenTeamsQuery({ minSlots: '21' }).errors.minSlots).toBeDefined();
        expect(parseOpenTeamsQuery({ minSlots: '1.5' }).errors.minSlots).toBeDefined();
        expect(parseOpenTeamsQuery({ minSlots: '-1' }).errors.minSlots).toBeDefined();
        expect(parseOpenTeamsQuery({ minSlots: 'abc' }).errors.minSlots).toBeDefined();
      });

      it('rejects non-string values such as arrays', () => {
        const result = parseOpenTeamsQuery({ minSlots: ['1', '2'] });
        expect(result.errors.minSlots).toBeDefined();
      });
    });

    describe('role validation', () => {
      it('accepts valid roles with case-insensitivity and returns canonical casing', () => {
        const roles = [
          { raw: 'frontend', expected: 'Frontend' },
          { raw: 'BACKEND', expected: 'Backend' },
          { raw: 'mobile', expected: 'Mobile' },
          { raw: 'ai/ml', expected: 'AI/ML' },
          { raw: 'UI/UX', expected: 'UI/UX' },
          { raw: 'pitch', expected: 'Pitch' },
        ];

        for (const { raw, expected } of roles) {
          const res = parseOpenTeamsQuery({ role: raw });
          expect(res.errors).toEqual({});
          if ('sanitized' in res && res.sanitized) {
            expect(res.sanitized.role).toBe(expected);
          }
        }
      });

      it('rejects unknown role values', () => {
        const res = parseOpenTeamsQuery({ role: 'DevOps' });
        expect(res.errors.role).toBe('Invalid role filter.');
      });

      it('rejects non-string role values', () => {
        const res = parseOpenTeamsQuery({ role: ['Frontend'] });
        expect(res.errors.role).toBeDefined();
      });
    });

    describe('goal validation', () => {
      it('accepts valid goals with case-insensitivity and collapsed whitespace', () => {
        const goals = [
          { raw: 'learning', expected: 'Learning' },
          { raw: '  project   completion  ', expected: 'Project Completion' },
          { raw: 'COMPETITIVE', expected: 'Competitive' },
        ];

        for (const { raw, expected } of goals) {
          const res = parseOpenTeamsQuery({ goal: raw });
          expect(res.errors).toEqual({});
          if ('sanitized' in res && res.sanitized) {
            expect(res.sanitized.goal).toBe(expected);
          }
        }
      });

      it('rejects unknown goal values', () => {
        const res = parseOpenTeamsQuery({ goal: 'JustForFun' });
        expect(res.errors.goal).toBe('Invalid goal filter.');
      });

      it('rejects non-string goal values', () => {
        const res = parseOpenTeamsQuery({ goal: ['Learning'] });
        expect(res.errors.goal).toBeDefined();
      });
    });

    describe('skills validation', () => {
      it('trims, lowercases, deduplicates, and drops blanks from skills', () => {
        const res = parseOpenTeamsQuery({ skills: ' React,  , Node.js , react , TypeScript ' });
        expect(res.errors).toEqual({});
        if ('sanitized' in res && res.sanitized) {
          expect(res.sanitized.skills).toEqual(['react', 'node.js', 'typescript']);
        }
      });

      it(`accepts up to ${OPEN_TEAMS_MAX_SKILL_TAGS} skill tags and 50 characters per tag`, () => {
        const tag50 = 'a'.repeat(50);
        const res = parseOpenTeamsQuery({ skills: `t1, t2, t3, t4, ${tag50}` });
        expect(res.errors).toEqual({});
        if ('sanitized' in res && res.sanitized) {
          expect(res.sanitized.skills.length).toBe(5);
        }
      });

      it('rejects more than 5 skill tags', () => {
        const res = parseOpenTeamsQuery({ skills: 's1, s2, s3, s4, s5, s6' });
        expect(res.errors.skills).toBe(`Skills filter cannot exceed ${OPEN_TEAMS_MAX_SKILL_TAGS} tags.`);
      });

      it('rejects skill tags exceeding 50 characters', () => {
        const tag51 = 'a'.repeat(51);
        const res = parseOpenTeamsQuery({ skills: `react, ${tag51}` });
        expect(res.errors.skills).toBe('Each skill tag cannot exceed 50 characters.');
      });

      it('rejects non-string skills values', () => {
        const res = parseOpenTeamsQuery({ skills: ['react', 'node'] });
        expect(res.errors.skills).toBeDefined();
      });
    });
  });

  describe('validateOpenTeamsQuery middleware', () => {
    it('sets res.locals.openTeamsQuery and calls next() on valid query', () => {
      const req = {
        query: {
          skills: 'react,node',
          role: 'frontend',
          goal: 'learning',
          minSlots: '2',
        },
      } as unknown as Request;

      const res = {
        locals: {},
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      validateOpenTeamsQuery(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.locals.openTeamsQuery).toEqual({
        skills: ['react', 'node'],
        role: 'Frontend',
        goal: 'Learning',
        minSlots: 2,
      });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns HTTP 400 VALIDATION_ERROR with Cache-Control: no-store on invalid query', () => {
      const req = {
        query: {
          minSlots: '99',
          role: 'InvalidRole',
        },
      } as unknown as Request;

      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const setHeaderMock = vi.fn();

      const res = {
        locals: {},
        setHeader: setHeaderMock,
        status: statusMock,
        json: jsonMock,
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      validateOpenTeamsQuery(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        errors: {
          minSlots: `Minimum open slots must be an integer between 1 and ${OPEN_TEAMS_MAX_MIN_SLOTS}.`,
          role: 'Invalid role filter.',
        },
      });
    });
  });
});
