import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  validateManifestExportQuery,
  validateManifestVerifyBody,
  validateManifestExportQueryMiddleware,
  validateManifestVerifyBodyMiddleware,
} from './teamManifest.validator.js';

describe('teamManifest.validator (US-024 / #225 / FR-071 / FR-072)', () => {
  describe('validateManifestExportQuery', () => {
    it('defaults to json when format query param is omitted', () => {
      const result = validateManifestExportQuery({});
      expect(result.errors).toEqual({});
      expect(result.sanitized).toEqual({ format: 'json' });
    });

    it('accepts json, html, and pdf in case-insensitive format', () => {
      expect(validateManifestExportQuery({ format: 'JSON' }).sanitized).toEqual({ format: 'json' });
      expect(validateManifestExportQuery({ format: 'Html' }).sanitized).toEqual({ format: 'html' });
      expect(validateManifestExportQuery({ format: 'pdf ' }).sanitized).toEqual({ format: 'pdf' });
    });

    it('rejects unsupported format values', () => {
      const result = validateManifestExportQuery({ format: 'xml' });
      expect(result.errors.format).toContain("must be one of: 'json', 'html', or 'pdf'");
    });

    it('rejects unexpected query parameters', () => {
      const result = validateManifestExportQuery({ format: 'json', hack: 'true' });
      expect(result.errors.hack).toContain("Unexpected query parameter 'hack'");
    });

    it('rejects non-object query inputs', () => {
      expect(validateManifestExportQuery(null).errors.query).toBeDefined();
      expect(validateManifestExportQuery([]).errors.query).toBeDefined();
    });
  });

  describe('validateManifestVerifyBody', () => {
    const validHex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    it('accepts valid 64-hex with sha256: prefix', () => {
      const result = validateManifestVerifyBody({ checksum: `sha256:${validHex}` });
      expect(result.errors).toEqual({});
      expect(result.sanitized).toEqual({
        checksum: `sha256:${validHex}`,
        normalizedChecksum: `sha256:${validHex}`,
      });
    });

    it('accepts valid raw 64-hex and normalizes with sha256: prefix', () => {
      const result = validateManifestVerifyBody({ checksum: validHex.toUpperCase() });
      expect(result.errors).toEqual({});
      expect(result.sanitized?.normalizedChecksum).toBe(`sha256:${validHex}`);
    });

    it('rejects missing or empty checksum', () => {
      expect(validateManifestVerifyBody({}).errors.checksum).toBe('Checksum is required.');
      expect(validateManifestVerifyBody({ checksum: '   ' }).errors.checksum).toBe('Checksum is required.');
    });

    it('rejects malformed checksum string', () => {
      const result = validateManifestVerifyBody({ checksum: 'sha256:not-valid-hex-length' });
      expect(result.errors.checksum).toContain('valid 64-character SHA-256');
    });

    it('rejects unexpected body keys', () => {
      const result = validateManifestVerifyBody({ checksum: validHex, extra: 123 });
      expect(result.errors.extra).toContain("Unexpected field 'extra'");
    });

    it('rejects non-object body inputs', () => {
      expect(validateManifestVerifyBody('bad').errors.body).toBeDefined();
      expect(validateManifestVerifyBody(null).errors.body).toBeDefined();
    });
  });

  describe('Middlewares', () => {
    it('validateManifestExportQueryMiddleware sets res.locals.manifestFormat and calls next()', () => {
      const req = { query: { format: 'html' } } as unknown as Request;
      const res = {
        locals: {},
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      validateManifestExportQueryMiddleware(req, res, next);
      expect(res.locals.manifestFormat).toBe('html');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('validateManifestExportQueryMiddleware responds 400 on validation error', () => {
      const req = { query: { format: 'unsupported' } } as unknown as Request;
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const setHeaderMock = vi.fn();
      const res = { locals: {}, setHeader: setHeaderMock, status: statusMock } as unknown as Response;
      const next = vi.fn() as NextFunction;

      validateManifestExportQueryMiddleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'VALIDATION_ERROR' })
      );
    });

    it('validateManifestVerifyBodyMiddleware updates req.body and calls next()', () => {
      const validHex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const req = { body: { checksum: validHex } } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      validateManifestVerifyBodyMiddleware(req, res, next);
      expect(req.body).toEqual({
        checksum: validHex,
        normalizedChecksum: `sha256:${validHex}`,
      });
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
