import { describe, it, expect } from 'vitest';
import { readAppRole, isAdminOnlyNavView } from './roleClaim';

describe('readAppRole (#359)', () => {
  it('accepts PART and ADMIN', () => {
    expect(readAppRole({ role: 'PART' })).toBe('PART');
    expect(readAppRole({ role: 'ADMIN' })).toBe('ADMIN');
  });

  it('rejects missing or invalid role values', () => {
    expect(readAppRole({})).toBeNull();
    expect(readAppRole({ role: 'admin' })).toBeNull();
    expect(readAppRole({ role: 'SUPERUSER' })).toBeNull();
    expect(readAppRole({ role: null as unknown as string })).toBeNull();
  });
});

describe('isAdminOnlyNavView (#359)', () => {
  it('flags moderation and accounts only', () => {
    expect(isAdminOnlyNavView('moderation')).toBe(true);
    expect(isAdminOnlyNavView('accounts')).toBe(true);
    expect(isAdminOnlyNavView('team')).toBe(false);
    expect(isAdminOnlyNavView('chat')).toBe(false);
  });
});
