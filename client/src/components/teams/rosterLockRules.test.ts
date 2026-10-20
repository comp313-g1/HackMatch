import { describe, it, expect } from 'vitest';
import type { RosterLockValidationResult } from './teamTypes';

/**
 * US-022 / #212 — client-facing acceptance mapping for min/max lock eligibility.
 * Server enforces bounds; Confirm & Lock UI disables when canLock is false.
 */

function canOfferLock(validation: Pick<RosterLockValidationResult, 'canLock' | 'reasons'>): boolean {
  return validation.canLock === true && validation.reasons.length === 0;
}

describe('roster lock UI rules (US-022 / #212)', () => {
  it('enables lock only when canLock is true (happy path / min–max satisfied)', () => {
    expect(
      canOfferLock({
        canLock: true,
        reasons: [],
      })
    ).toBe(true);
  });

  it('disables lock for BELOW_MIN_MEMBERS (US-022-T2)', () => {
    expect(
      canOfferLock({
        canLock: false,
        reasons: [{ code: 'BELOW_MIN_MEMBERS', message: 'Need 2 members.' }],
      })
    ).toBe(false);
  });

  it('disables lock for ABOVE_MAX_MEMBERS (boundary)', () => {
    expect(
      canOfferLock({
        canLock: false,
        reasons: [{ code: 'ABOVE_MAX_MEMBERS', message: 'At most 4 members.' }],
      })
    ).toBe(false);
  });
});
