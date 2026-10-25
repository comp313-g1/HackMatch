import { describe, it, expect } from 'vitest';
import {
  normalizePresenceStatus,
  validatePresenceUpdatePayload,
} from './presence.validator.js';

describe('presence.validator (US-030 / #343 / FR-086)', () => {
  it('normalizes the four allowed statuses', () => {
    expect(normalizePresenceStatus('Online')).toBe('Online');
    expect(normalizePresenceStatus('idle')).toBe('Idle');
    expect(normalizePresenceStatus('Do Not Disturb')).toBe('Do Not Disturb');
    expect(normalizePresenceStatus('Invisible')).toBe('Invisible');
  });

  it('accepts common aliases for Do Not Disturb and Invisible', () => {
    expect(normalizePresenceStatus('dnd')).toBe('Do Not Disturb');
    expect(normalizePresenceStatus('do_not_disturb')).toBe('Do Not Disturb');
    expect(normalizePresenceStatus('offline')).toBe('Invisible');
  });

  it('rejects blank and unknown statuses', () => {
    expect(normalizePresenceStatus('')).toBeNull();
    expect(normalizePresenceStatus('Busy')).toBeNull();
    expect(normalizePresenceStatus(null)).toBeNull();
  });

  it('validates a happy-path update payload', () => {
    const result = validatePresenceUpdatePayload({ presenceStatus: 'Online' });
    expect(result.isValid).toBe(true);
    expect(result.data?.presenceStatus).toBe('Online');
  });

  it('accepts status alias key', () => {
    const result = validatePresenceUpdatePayload({ status: 'Idle' });
    expect(result.isValid).toBe(true);
    expect(result.data?.presenceStatus).toBe('Idle');
  });

  it('rejects missing status and unknown fields', () => {
    expect(validatePresenceUpdatePayload({}).isValid).toBe(false);
    expect(validatePresenceUpdatePayload({ presenceStatus: 'Online', email: 'x' }).isValid).toBe(
      false
    );
  });
});
