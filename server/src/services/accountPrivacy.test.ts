import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_PRIVACY_NOTICE,
  ADMIN_SELF_PROMOTION_CODE,
  accountPrivacyFlags,
  evaluateAdminSelfPromotionAttempt,
  isPrivateAccountKey,
  publicPayloadHasPrivateAccountKey,
  sanitizeSubmittedAccountDraft,
  scrubPrivateAccountFields,
} from './accountPrivacy.js';

describe('accountPrivacy (US-027 / #254)', () => {
  it('flags credentials, OTPs, and private note keys but allows account email', () => {
    expect(isPrivateAccountKey('password')).toBe(true);
    expect(isPrivateAccountKey('otp_hash')).toBe(true);
    expect(isPrivateAccountKey('otpCode')).toBe(true);
    expect(isPrivateAccountKey('firebase_uid')).toBe(true);
    expect(isPrivateAccountKey('firebaseUid')).toBe(true);
    expect(isPrivateAccountKey('sharedContactHandle')).toBe(true);
    expect(isPrivateAccountKey('workspace_note')).toBe(true);
    expect(isPrivateAccountKey('teamNotes')).toBe(true);
    expect(isPrivateAccountKey('email')).toBe(false);
    expect(isPrivateAccountKey('accountId')).toBe(false);
    expect(isPrivateAccountKey('handle')).toBe(false);
  });

  it('scrubs nested private fields while preserving safe account identifiers (happy path)', () => {
    const scrubbed = scrubPrivateAccountFields({
      accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'ada@example.com',
      effects: {
        otp_hash: 'secret-hash',
        firebase_uid: 'fb-1',
        workspace_note: 'private markdown',
        sessionsRevoked: true,
      },
      members: [{ fullName: 'Ada', password: 'x', sharedContactHandle: 'discord' }],
    });

    expect(scrubbed).toEqual({
      accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'ada@example.com',
      effects: { sessionsRevoked: true },
      members: [{ fullName: 'Ada' }],
    });
    expect(publicPayloadHasPrivateAccountKey(scrubbed)).toBe(false);
  });

  it('redacts password from submitted drafts on validation failure (NR-017)', () => {
    expect(
      sanitizeSubmittedAccountDraft({
        fullName: 'Ada',
        email: 'ada@example.com',
        password: 'Password123!',
        role: 'ADMIN',
      })
    ).toEqual({
      fullName: 'Ada',
      email: 'ada@example.com',
      password: '[redacted]',
      role: 'ADMIN',
    });
  });

  it('rejects ADMIN self-promotion and privilege-escalation keys (failure)', () => {
    expect(evaluateAdminSelfPromotionAttempt({ role: 'ADMIN' })).toMatchObject({
      forbidden: true,
      code: ADMIN_SELF_PROMOTION_CODE,
    });
    expect(
      evaluateAdminSelfPromotionAttempt({
        privilegeKeys: { isAdmin: true },
      })
    ).toMatchObject({ forbidden: true });
  });

  it('allows PART / omitted role (boundary)', () => {
    expect(evaluateAdminSelfPromotionAttempt({ role: 'PART' })).toBeNull();
    expect(evaluateAdminSelfPromotionAttempt({})).toBeNull();
    expect(evaluateAdminSelfPromotionAttempt({ role: null })).toBeNull();
  });

  it('exposes privacy flags denying credentials, OTPs, notes, and public ADMIN promotion', () => {
    expect(accountPrivacyFlags()).toEqual({
      credentialsIncluded: false,
      otpsIncluded: false,
      privateTeamNotesIncluded: false,
      privateContactsIncluded: false,
      publicAdminSelfPromotionAllowed: false,
      notice: ACCOUNT_PRIVACY_NOTICE,
    });
  });
});
