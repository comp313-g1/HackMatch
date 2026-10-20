import { describe, it, expect } from 'vitest';
import {
  POST_LOCK_REJECT_MESSAGE,
  POST_LOCK_UI_NOTICE,
  isLifecycleLocked,
  postLockMutationErrorMessage,
} from './postLockGuards';

describe('postLockGuards client (US-022 / #210 / FR-067)', () => {
  it('detects Locked lifecycle for UI freeze (happy path)', () => {
    expect(isLifecycleLocked({ mutable: false, reason: 'Locked' })).toBe(true);
    expect(POST_LOCK_UI_NOTICE).toMatch(/leaving/i);
    expect(POST_LOCK_UI_NOTICE).toMatch(/disbanding/i);
  });

  it('returns false for mutable or non-Locked reasons (boundary)', () => {
    expect(isLifecycleLocked({ mutable: true, reason: null })).toBe(false);
    expect(isLifecycleLocked({ mutable: false, reason: 'Disbanded' })).toBe(false);
    expect(isLifecycleLocked({ mutable: false, reason: 'EventNotRecruiting' })).toBe(false);
    expect(isLifecycleLocked(null)).toBe(false);
    expect(isLifecycleLocked(undefined)).toBe(false);
  });

  it('prefers server Locked freeze message when TEAM_NOT_MUTABLE (happy path)', () => {
    expect(
      postLockMutationErrorMessage({
        code: 'TEAM_NOT_MUTABLE',
        message: POST_LOCK_REJECT_MESSAGE,
        details: { reason: 'Locked' },
      })
    ).toBe(POST_LOCK_REJECT_MESSAGE);
  });

  it('falls back to Locked copy when server message is empty (failure / unexpected)', () => {
    expect(
      postLockMutationErrorMessage({
        code: 'TEAM_NOT_MUTABLE',
        message: '   ',
        details: { reason: 'Locked' },
      })
    ).toBe(POST_LOCK_REJECT_MESSAGE);
  });

  it('passes through other error messages unchanged (invalid / non-lock)', () => {
    expect(
      postLockMutationErrorMessage({
        code: 'FORBIDDEN_NOT_TEAM_OWNER',
        message: 'You are not the owner of this team.',
      })
    ).toBe('You are not the owner of this team.');
  });
});
