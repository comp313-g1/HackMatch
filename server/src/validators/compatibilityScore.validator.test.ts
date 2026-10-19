import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  parseCompatibilityScoreBody,
  validateCompatibilityScorePayload,
} from './compatibilityScore.validator.js';

describe('parseCompatibilityScoreBody', () => {
  it('accepts a valid slot and candidate payload', () => {
    const parsed = parseCompatibilityScoreBody({
      slot: {
        role: 'Frontend',
        requiredSkills: ['React', 'TypeScript', 'CSS', 'Testing'],
        requestedHours: 20,
        goal: 'Project Completion',
      },
      candidate: {
        primaryRole: 'Frontend',
        skills: ['React', 'TypeScript'],
        commitmentHours: 10,
        goal: 'Project Completion',
      },
    });
    expect(parsed.ok).toBe(true);
  });

  it('returns field errors and echoes submitted values on invalid input', () => {
    const body = {
      slot: { role: 'Wizard', requiredSkills: [], requestedHours: 10, goal: 'Learning' },
      candidate: {
        primaryRole: 'Frontend',
        skills: [],
        commitmentHours: 5,
        goal: 'Learning',
      },
    };
    const parsed = parseCompatibilityScoreBody(body);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.role).toBeTruthy();
    expect(parsed.submitted).toEqual(body);
  });

  it('rejects non-object bodies with a body error', () => {
    const parsed = parseCompatibilityScoreBody(null);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.body).toMatch(/JSON object/);
  });
});

describe('validateCompatibilityScorePayload middleware', () => {
  it('calls next and replaces body on success', () => {
    const req = {
      body: {
        slot: {
          role: 'Backend',
          requiredSkills: [],
          requestedHours: 0,
          goal: 'Learning',
        },
        candidate: {
          primaryRole: 'Backend',
          skills: [],
          commitmentHours: 0,
          goal: 'Learning',
        },
      },
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    validateCompatibilityScorePayload(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body.slot.role).toBe('Backend');
  });

  it('responds 400 with errors and submitted payload without calling next', () => {
    const body = {
      slot: { role: 'Nope', requiredSkills: [], requestedHours: 1, goal: 'Learning' },
      candidate: {
        primaryRole: 'Frontend',
        skills: [],
        commitmentHours: 1,
        goal: 'Learning',
      },
    };
    const req = { body } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    validateCompatibilityScorePayload(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'COMPATIBILITY_SCORE_VALIDATION',
        errors: expect.objectContaining({ role: expect.any(String) }),
        submitted: body,
      })
    );
  });
});
