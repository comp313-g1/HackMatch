import { describe, it, expect } from 'vitest';
import {
  MODERATION_PRIVACY_NOTICE,
  isPrivateModerationKey,
  moderationPrivacyFlags,
  publicPayloadHasPrivateModerationKey,
  scrubPrivateModerationFields,
} from './moderationPrivacy.js';

describe('moderationPrivacy (US-026 / #245)', () => {
  it('flags credential, private-contact, and workspace keys', () => {
    expect(isPrivateModerationKey('email')).toBe(true);
    expect(isPrivateModerationKey('firebase_uid')).toBe(true);
    expect(isPrivateModerationKey('firebaseUid')).toBe(true);
    expect(isPrivateModerationKey('shared_contact_handle')).toBe(true);
    expect(isPrivateModerationKey('sharedContactHandle')).toBe(true);
    expect(isPrivateModerationKey('workspaceNote')).toBe(true);
    expect(isPrivateModerationKey('team_notes')).toBe(true);
    expect(isPrivateModerationKey('otp_hash')).toBe(true);
    expect(isPrivateModerationKey('pitch')).toBe(false);
    expect(isPrivateModerationKey('ownerHandle')).toBe(false);
  });

  it('recursively scrubs nested private fields while preserving safe content', () => {
    const scrubbed = scrubPrivateModerationFields({
      caseId: 'c1',
      effects: {
        moderationStatus: 'Hidden',
        email: 'leak@example.com',
        nested: {
          sharedContactHandle: 'secret-discord',
          workspace_note: 'private workspace markdown',
          ok: true,
        },
      },
      members: [{ displayName: 'Ada', firebase_uid: 'fb-1' }],
    });

    expect(scrubbed).toEqual({
      caseId: 'c1',
      effects: {
        moderationStatus: 'Hidden',
        nested: { ok: true },
      },
      members: [{ displayName: 'Ada' }],
    });
    expect(publicPayloadHasPrivateModerationKey(scrubbed)).toBe(false);
  });

  it('exposes explicit privacy flags denying private workspace access', () => {
    const flags = moderationPrivacyFlags();
    expect(flags).toEqual({
      credentialsIncluded: false,
      privateContactsIncluded: false,
      privateWorkspaceAccessGranted: false,
      notice: MODERATION_PRIVACY_NOTICE,
    });
  });
});
