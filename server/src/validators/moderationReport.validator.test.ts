import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  validateCreateModerationReport,
  validateModerationReportPayload,
} from './moderationReport.validator.js';

describe('moderationReport.validator (US-025 / #233 / #237)', () => {
  const validTargetId = '11111111-1111-4111-8111-111111111111';

  describe('validateModerationReportPayload', () => {
    it('validates a correct report payload for team target', () => {
      const result = validateModerationReportPayload({
        targetType: 'team',
        targetId: validTargetId,
        category: 'Harassment',
        explanation: '  Rude messages in pitch  ',
      });

      expect(result.valid).toBe(true);
      expect(result.normalized).toEqual({
        targetType: 'team',
        targetId: validTargetId,
        category: 'Harassment',
        explanation: 'Rude messages in pitch',
        flaggedUrl: null,
      });
    });

    it('validates a correct url report payload with flaggedUrl', () => {
      const result = validateModerationReportPayload({
        targetType: 'url',
        targetId: validTargetId,
        category: 'Phishing Link',
        flaggedUrl: 'https://suspicious-login.com/auth',
      });

      expect(result.valid).toBe(true);
      expect(result.normalized?.flaggedUrl).toBe(
        'https://suspicious-login.com/auth'
      );
    });

    it('validates the canonical chat_message report target', () => {
      const result = validateModerationReportPayload({
        targetType: 'chat_message',
        targetId: validTargetId,
        category: 'Harassment',
        explanation: 'Abusive message',
      });

      expect(result.valid).toBe(true);
      expect(result.normalized).toEqual({
        targetType: 'chat_message',
        targetId: validTargetId,
        category: 'Harassment',
        explanation: 'Abusive message',
        flaggedUrl: null,
      });
    });

    it('rejects non-object bodies', () => {
      expect(validateModerationReportPayload(null).valid).toBe(false);
      expect(validateModerationReportPayload('string').valid).toBe(false);
      expect(validateModerationReportPayload([]).valid).toBe(false);
    });

    it('rejects unknown fields', () => {
      const result = validateModerationReportPayload({
        targetType: 'team',
        targetId: validTargetId,
        category: 'Spam',
        maliciousKey: 'payload',
      });

      expect(result.valid).toBe(false);
      expect(result.fieldErrors.maliciousKey).toContain('Unknown field');
    });

    it('rejects invalid targetType and invalid targetId', () => {
      const result = validateModerationReportPayload({
        targetType: 'invalid',
        targetId: 'not-a-uuid',
        category: 'Spam',
      });

      expect(result.valid).toBe(false);
      expect(result.fieldErrors.targetType).toBeDefined();
      expect(result.fieldErrors.targetId).toBeDefined();
    });

    it('rejects invalid category', () => {
      const result = validateModerationReportPayload({
        targetType: 'team',
        targetId: validTargetId,
        category: 'NotACategory',
      });

      expect(result.valid).toBe(false);
      expect(result.fieldErrors.category).toBeDefined();
    });

    it('rejects explanation exceeding 1000 characters', () => {
      const result = validateModerationReportPayload({
        targetType: 'team',
        targetId: validTargetId,
        category: 'Spam',
        explanation: 'e'.repeat(1001),
      });

      expect(result.valid).toBe(false);
      expect(result.fieldErrors.explanation).toContain(
        'must not exceed 1000 characters'
      );
    });

    it('rejects url targets without flaggedUrl or non-https URL', () => {
      const missingUrlResult = validateModerationReportPayload({
        targetType: 'url',
        targetId: validTargetId,
        category: 'Phishing Link',
      });
      expect(missingUrlResult.valid).toBe(false);
      expect(missingUrlResult.fieldErrors.flaggedUrl).toBeDefined();

      const insecureUrlResult = validateModerationReportPayload({
        targetType: 'url',
        targetId: validTargetId,
        category: 'Phishing Link',
        flaggedUrl: 'http://insecure-link.com',
      });
      expect(insecureUrlResult.valid).toBe(false);
      expect(insecureUrlResult.fieldErrors.flaggedUrl).toBeDefined();
    });
  });

  describe('validateCreateModerationReport middleware', () => {
    it('calls next and populates res.locals.validatedReport on success', () => {
      const req = {
        body: {
          targetType: 'profile',
          targetId: validTargetId,
          category: 'Fake Account',
        },
      } as unknown as Request;

      const res = {
        locals: {},
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      validateCreateModerationReport(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.locals.validatedReport).toEqual({
        targetType: 'profile',
        targetId: validTargetId,
        category: 'Fake Account',
        explanation: null,
        flaggedUrl: null,
      });
    });

    it('returns 400 and echoes submitted fields when validation fails (NR-010 / NR-017)', () => {
      const submittedBody = {
        targetType: 'team',
        targetId: 'invalid-id',
        category: 'Spam',
        explanation: 'Preserved draft explanation',
      };

      const req = { body: submittedBody } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      validateCreateModerationReport(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          submitted: submittedBody,
          errors: expect.objectContaining({
            targetId: expect.any(String),
          }),
        })
      );
    });
  });
});
