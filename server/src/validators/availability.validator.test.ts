import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  normalizeAvailabilityRole,
  normalizeAvailabilityGoal,
  validateAvailabilityUpdatePayload,
  validateAvailabilityUpdateBody,
  AVAILABILITY_ROLES,
  AVAILABILITY_GOALS,
} from './availability.validator.js';

describe('Availability Validator (US-011 / #US-286)', () => {
  describe('normalizeAvailabilityRole', () => {
    it('normalizes role names case-insensitively', () => {
      expect(normalizeAvailabilityRole('frontend')).toBe('Frontend');
      expect(normalizeAvailabilityRole('BACKEND')).toBe('Backend');
      expect(normalizeAvailabilityRole(' mobile ')).toBe('Mobile');
      expect(normalizeAvailabilityRole('ai/ml')).toBe('AI/ML');
      expect(normalizeAvailabilityRole('UI/UX')).toBe('UI/UX');
      expect(normalizeAvailabilityRole('Pitch')).toBe('Pitch');
    });

    it('returns null for unknown role names or non-strings', () => {
      expect(normalizeAvailabilityRole('DevOps')).toBeNull();
      expect(normalizeAvailabilityRole('')).toBeNull();
      expect(normalizeAvailabilityRole(null)).toBeNull();
      expect(normalizeAvailabilityRole(123)).toBeNull();
    });
  });

  describe('normalizeAvailabilityGoal', () => {
    it('normalizes goal names case-insensitively', () => {
      expect(normalizeAvailabilityGoal('learning')).toBe('Learning');
      expect(normalizeAvailabilityGoal('PROJECT COMPLETION')).toBe('Project Completion');
      expect(normalizeAvailabilityGoal('  competitive  ')).toBe('Competitive');
    });

    it('returns null for unknown goals or non-strings', () => {
      expect(normalizeAvailabilityGoal('Hobby')).toBeNull();
      expect(normalizeAvailabilityGoal('')).toBeNull();
      expect(normalizeAvailabilityGoal(null)).toBeNull();
      expect(normalizeAvailabilityGoal(42)).toBeNull();
    });
  });

  describe('validateAvailabilityUpdatePayload', () => {
    it('rejects non-object or array body', () => {
      const resNull = validateAvailabilityUpdatePayload(null);
      expect(resNull.isValid).toBe(false);
      expect(resNull.errors.body).toBe('Request body must be a JSON object.');

      const resArr = validateAvailabilityUpdatePayload([]);
      expect(resArr.isValid).toBe(false);
      expect(resArr.errors.body).toBe('Request body must be a JSON object.');

      const resStr = validateAvailabilityUpdatePayload('string');
      expect(resStr.isValid).toBe(false);
    });

    it('rejects unknown fields and explicitly rejects client eventId (AC 1)', () => {
      const result = validateAvailabilityUpdatePayload({
        isLooking: false,
        eventId: '00000000-0000-4000-8000-000000000001',
        extraField: 'unexpected',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.eventId).toBe('eventId is not accepted for platform-wide availability.');
      expect(result.errors.extraField).toContain("Unknown field 'extraField' is not allowed.");
    });

    it('validates isLooking must be a strict boolean', () => {
      const resString = validateAvailabilityUpdatePayload({ isLooking: 'true' });
      expect(resString.isValid).toBe(false);
      expect(resString.errors.isLooking).toBe('isLooking must be a boolean.');

      const resMissing = validateAvailabilityUpdatePayload({});
      expect(resMissing.isValid).toBe(false);
      expect(resMissing.errors.isLooking).toBe('isLooking must be a boolean.');
    });

    describe('when isLooking === true (AC 2)', () => {
      it('accepts complete, valid availability preferences', () => {
        for (const role of AVAILABILITY_ROLES) {
          for (const goal of AVAILABILITY_GOALS) {
            const result = validateAvailabilityUpdatePayload({
              isLooking: true,
              desiredRole: role,
              commitmentHours: 20,
              goal,
            });
            expect(result.isValid).toBe(true);
            expect(result.data).toEqual({
              isLooking: true,
              desiredRole: role,
              commitmentHours: 20,
              goal,
            });
          }
        }
      });

      it('requires desiredRole, commitmentHours, and goal', () => {
        const result = validateAvailabilityUpdatePayload({
          isLooking: true,
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.desiredRole).toBe('Desired role is required when Looking for Team is enabled.');
        expect(result.errors.commitmentHours).toBe('Commitment hours are required when Looking for Team is enabled.');
        expect(result.errors.goal).toBe('Goal is required when Looking for Team is enabled.');
      });

      it('validates commitment hours boundaries and decimal places (0..168, <= 1 decimal place)', () => {
        // Valid boundaries
        expect(
          validateAvailabilityUpdatePayload({
            isLooking: true,
            desiredRole: 'Frontend',
            commitmentHours: 0,
            goal: 'Learning',
          }).isValid
        ).toBe(true);

        expect(
          validateAvailabilityUpdatePayload({
            isLooking: true,
            desiredRole: 'Backend',
            commitmentHours: 0.5,
            goal: 'Project Completion',
          }).isValid
        ).toBe(true);

        expect(
          validateAvailabilityUpdatePayload({
            isLooking: true,
            desiredRole: 'AI/ML',
            commitmentHours: 168,
            goal: 'Competitive',
          }).isValid
        ).toBe(true);

        // Invalid boundaries
        const negRes = validateAvailabilityUpdatePayload({
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: -0.1,
          goal: 'Learning',
        });
        expect(negRes.isValid).toBe(false);
        expect(negRes.errors.commitmentHours).toBe('Commitment hours must be between 0 and 168.');

        const overRes = validateAvailabilityUpdatePayload({
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 168.1,
          goal: 'Learning',
        });
        expect(overRes.isValid).toBe(false);
        expect(overRes.errors.commitmentHours).toBe('Commitment hours must be between 0 and 168.');

        const decimalRes = validateAvailabilityUpdatePayload({
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 10.25,
          goal: 'Learning',
        });
        expect(decimalRes.isValid).toBe(false);
        expect(decimalRes.errors.commitmentHours).toBe('Commitment hours cannot have more than 1 decimal place.');

        const stringRes = validateAvailabilityUpdatePayload({
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: '20' as unknown as number,
          goal: 'Learning',
        });
        expect(stringRes.isValid).toBe(false);
        expect(stringRes.errors.commitmentHours).toBe(
          'Commitment hours must be a number between 0 and 168 with at most one decimal place.'
        );
      });

      it('rejects invalid role or goal enums', () => {
        const invalidRole = validateAvailabilityUpdatePayload({
          isLooking: true,
          desiredRole: 'Astronaut',
          commitmentHours: 10,
          goal: 'Learning',
        });
        expect(invalidRole.isValid).toBe(false);
        expect(invalidRole.errors.desiredRole).toContain('Desired role must be one of');

        const invalidGoal = validateAvailabilityUpdatePayload({
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 10,
          goal: 'WorldDomination',
        });
        expect(invalidGoal.isValid).toBe(false);
        expect(invalidGoal.errors.goal).toContain('Goal must be one of');
      });
    });

    describe('when isLooking === false', () => {
      it('allows turning off LFT with empty optional preferences', () => {
        const result = validateAvailabilityUpdatePayload({
          isLooking: false,
        });
        expect(result.isValid).toBe(true);
        expect(result.data).toEqual({
          isLooking: false,
        });
      });

      it('validates optional preferences if provided even when isLooking === false', () => {
        const invalidHours = validateAvailabilityUpdatePayload({
          isLooking: false,
          commitmentHours: -5,
        });
        expect(invalidHours.isValid).toBe(false);
        expect(invalidHours.errors.commitmentHours).toBe('Commitment hours must be between 0 and 168.');

        const validProvided = validateAvailabilityUpdatePayload({
          isLooking: false,
          desiredRole: 'frontend',
          commitmentHours: 15,
          goal: 'learning',
        });
        expect(validProvided.isValid).toBe(true);
        expect(validProvided.data).toEqual({
          isLooking: false,
          desiredRole: 'Frontend',
          commitmentHours: 15,
          goal: 'Learning',
        });
      });
    });
  });

  describe('validateAvailabilityUpdateBody Express middleware', () => {
    it('sets req.body to validated data and calls next on success', () => {
      const req = {
        body: {
          isLooking: true,
          desiredRole: 'frontend',
          commitmentHours: 20,
          goal: 'competitive',
        },
      } as unknown as Request;

      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      validateAvailabilityUpdateBody(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body).toEqual({
        isLooking: true,
        desiredRole: 'Frontend',
        commitmentHours: 20,
        goal: 'Competitive',
      });
    });

    it('returns 400 VALIDATION_ERROR with no-store header on failure', () => {
      const req = {
        body: {
          isLooking: true,
          desiredRole: 'InvalidRole',
        },
      } as unknown as Request;

      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      validateAvailabilityUpdateBody(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          error: 'Invalid availability preferences.',
        })
      );
    });
  });
});
