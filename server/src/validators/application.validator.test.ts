import { describe, it, expect } from 'vitest';
import { validateSubmitApplicationInput } from './application.validator.js';
import { APPLICATION_MESSAGE_MAX_LENGTH } from '../db/applicationModel.js';

const vacancyId = '66666666-6666-4666-8666-666666666666';

describe('validateSubmitApplicationInput (US-018 / #172)', () => {
  it('accepts vacancyId with optional null/omitted message', () => {
    expect(validateSubmitApplicationInput({ vacancyId }).sanitized).toEqual({
      vacancyId,
      message: null,
    });
    expect(
      validateSubmitApplicationInput({ vacancyId, message: null }).sanitized
    ).toEqual({ vacancyId, message: null });
  });

  it('trims message and rejects length over 250 (preserves failure without mutating caller draft)', () => {
    const long = 'a'.repeat(APPLICATION_MESSAGE_MAX_LENGTH + 1);
    const result = validateSubmitApplicationInput({ vacancyId, message: long });
    expect(result.sanitized).toBeNull();
    expect(result.errors.message).toMatch(/250/i);

    const ok = validateSubmitApplicationInput({
      vacancyId,
      message: '  hello team  ',
    });
    expect(ok.sanitized).toEqual({ vacancyId, message: 'hello team' });
  });

  it('rejects invalid vacancy UUID and unknown fields', () => {
    const result = validateSubmitApplicationInput({
      vacancyId: 'bad',
      extra: true,
    });
    expect(result.sanitized).toBeNull();
    expect(result.errors.vacancyId).toBeTruthy();
    expect(result.errors.extra).toMatch(/Unknown field/i);
  });
});
