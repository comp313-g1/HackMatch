import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  validateCreateModerationCaseInput,
  validateCreateModerationCaseBody,
  MODERATION_REASON_MAX,
} from './moderation.validator.js';

describe('validateCreateModerationCaseInput (US-026 / #239)', () => {
  const validTeam = {
    targetType: 'team',
    targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reason: 'Suspicious pitch',
  };

  it('accepts a valid team case payload', () => {
    const result = validateCreateModerationCaseInput(validTeam);
    expect(result.errors).toEqual({});
    expect(result.sanitized).toEqual({
      targetType: 'team',
      targetId: validTeam.targetId,
      reason: 'Suspicious pitch',
      flaggedUrl: null,
    });
  });

  it('requires flaggedUrl for url targets', () => {
    const result = validateCreateModerationCaseInput({
      targetType: 'url',
      targetId: validTeam.targetId,
      reason: 'Phishing',
    });
    expect(result.sanitized).toBeNull();
    expect(result.errors.flaggedUrl).toBeTruthy();
    expect(result.submitted).toMatchObject({ targetType: 'url' });
  });

  it('rejects non-https flaggedUrl', () => {
    const body = {
      targetType: 'url',
      targetId: validTeam.targetId,
      reason: 'Phishing',
      flaggedUrl: 'http://insecure.example',
    };
    const result = validateCreateModerationCaseInput(body);
    expect(result.errors.flaggedUrl).toBeTruthy();
    expect(result.submitted).toEqual(body);
  });

  it('rejects blank reason and preserves submitted draft', () => {
    const body = { ...validTeam, reason: '  ' };
    const result = validateCreateModerationCaseInput(body);
    expect(result.errors.reason).toBeTruthy();
    expect(result.submitted).toEqual(body);
  });

  it(`rejects reason longer than ${MODERATION_REASON_MAX} characters`, () => {
    const body = { ...validTeam, reason: 'x'.repeat(MODERATION_REASON_MAX + 1) };
    const result = validateCreateModerationCaseInput(body);
    expect(result.errors.reason).toMatch(/at most/);
    expect(result.submitted).toEqual(body);
  });

  it('rejects unknown fields', () => {
    const result = validateCreateModerationCaseInput({ ...validTeam, secret: 'nope' });
    expect(result.errors.secret).toBeTruthy();
  });
});

describe('validateCreateModerationCaseBody middleware', () => {
  it('responds 400 with errors and submitted payload without calling next', () => {
    const body = {
      targetType: 'team',
      targetId: 'not-uuid',
      reason: 'ok',
    };
    const req = { body } as Request;
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    validateCreateModerationCaseBody(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        submitted: body,
        errors: expect.objectContaining({ targetId: expect.any(String) }),
      })
    );
  });
});
