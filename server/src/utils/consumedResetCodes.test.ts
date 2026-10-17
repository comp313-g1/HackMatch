import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetConsumedPasswordResetCodes,
  markPasswordResetCodeConsumed,
  wasPasswordResetCodeConsumed,
} from './consumedResetCodes.js';

describe('consumedResetCodes (US-005 / S1-P2-16)', () => {
  beforeEach(() => {
    _resetConsumedPasswordResetCodes();
  });

  it('marks and detects a consumed oobCode by hash', () => {
    expect(wasPasswordResetCodeConsumed('oob-abc')).toBe(false);
    markPasswordResetCodeConsumed('oob-abc');
    expect(wasPasswordResetCodeConsumed('oob-abc')).toBe(true);
    expect(wasPasswordResetCodeConsumed('  oob-abc  ')).toBe(true);
  });

  it('does not treat unrelated codes as consumed', () => {
    markPasswordResetCodeConsumed('oob-one');
    expect(wasPasswordResetCodeConsumed('oob-two')).toBe(false);
  });
});
