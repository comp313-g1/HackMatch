import { describe, it, expect } from 'vitest';
import {
  projectManifestMember,
  scrubManifestPrivateFields,
  manifestPayloadHasPrivateField,
  assertManifestSnapshotIsPiiFree,
  FORBIDDEN_MANIFEST_PRIVATE_KEYS,
} from './manifestPrivacy.js';
import type { CanonicalRosterSnapshot } from '../db/types.js';

describe('manifestPrivacy service (US-024 / #227 / FR-071 / NR-023)', () => {
  describe('projectManifestMember', () => {
    it('projects public portfolio fields while excluding account email and private contact handles', () => {
      const projected = projectManifestMember({
        membership: {
          participant_id: '11111111-1111-1111-1111-111111111111',
          role: 'Owner',
          joined_at: '2026-10-18T10:00:00.000Z',
        },
        participant: {
          id: '11111111-1111-1111-1111-111111111111',
          full_name: 'Alice Chen',
          email: 'alice.private@example.com',
          firebase_uid: 'fb_alice_secret_123',
          is_deactivated: false,
        },
        profile: {
          handle: '@alice_c',
          primary_role: 'Frontend',
          institution: 'Centennial College',
          shared_contact_handle: 'discord:alice#9999',
          portfolio_links: [
            { label: 'GitHub', url: 'https://github.com/alice' },
            { label: 'Invalid Link', url: 'http://insecure.example.com' }, // filtered out (not HTTPS)
          ],
        },
      });

      expect(projected.participantId).toBe('11111111-1111-1111-1111-111111111111');
      expect(projected.displayName).toBe('Alice Chen');
      expect(projected.handle).toBe('alice_c');
      expect(projected.teamRole).toBe('Owner');
      expect(projected.primaryRole).toBe('Frontend');
      expect(projected.institution).toBe('Centennial College');
      expect(projected.portfolioLinks).toEqual([
        { label: 'GitHub', url: 'https://github.com/alice' },
      ]);
      expect(projected.isPseudonymized).toBe(false);

      // Verify strict PII exclusion
      const record = projected as unknown as Record<string, unknown>;
      expect(record.email).toBeUndefined();
      expect(record.sharedContactHandle).toBeUndefined();
      expect(record.shared_contact_handle).toBeUndefined();
      expect(record.firebase_uid).toBeUndefined();
      expect(record.firebaseUid).toBeUndefined();
    });

    it('redacts email if accidentally embedded in full_name', () => {
      const projected = projectManifestMember({
        membership: {
          participant_id: '11111111-1111-1111-1111-111111111111',
          role: 'Member',
          joined_at: '2026-10-18T10:00:00.000Z',
        },
        participant: {
          id: '11111111-1111-1111-1111-111111111111',
          full_name: 'Bob (bob@test.com)',
          email: 'bob@test.com',
          is_deactivated: false,
        },
      });

      expect(projected.displayName).toBe('Bob ([REDACTED_EMAIL])');
      expect(projected.displayName).not.toContain('bob@test.com');
    });

    it('projects pseudonymized former member when membership was pseudonymized (US-027 / #253)', () => {
      const projected = projectManifestMember({
        membership: {
          participant_id: '22222222-2222-2222-2222-222222222222',
          role: 'Member',
          joined_at: '2026-10-19T12:00:00.000Z',
          identity_display_name: 'Former Member 7b3e21a0',
          identity_pseudonymized_at: '2026-10-20T10:00:00.000Z',
        },
        participant: null,
        profile: null,
      });

      expect(projected.displayName).toBe('Former Member 7b3e21a0');
      expect(projected.handle).toBeNull();
      expect(projected.primaryRole).toBeNull();
      expect(projected.institution).toBeNull();
      expect(projected.portfolioLinks).toEqual([]);
      expect(projected.isPseudonymized).toBe(true);
    });

    it('projects pseudonymized former member when participant account was deactivated or deleted', () => {
      const projected = projectManifestMember({
        membership: {
          participant_id: '33333333-3333-3333-3333-333333333333',
          role: 'Member',
          joined_at: '2026-10-19T12:00:00.000Z',
        },
        participant: {
          id: '33333333-3333-3333-3333-333333333333',
          full_name: 'Deleted User',
          firebase_uid: 'deleted:33333333-3333-3333-3333-333333333333',
          is_deactivated: true,
        },
      });

      expect(projected.displayName).toBe('Former Member 33333333');
      expect(projected.isPseudonymized).toBe(true);
      expect(projected.handle).toBeNull();
      expect(projected.portfolioLinks).toEqual([]);
    });
  });

  describe('scrubManifestPrivateFields', () => {
    it('recursively scrubs forbidden keys and redacts inline email strings', () => {
      const rawPayload = {
        teamId: '00000000-0000-0000-0000-000000000001',
        email: 'leaked@example.com',
        identityEmail: 'leaked2@example.com',
        sharedContactHandle: 'discord:user#1234',
        shared_contact_handle: 'slack:@user',
        communicationLink: 'https://chat.example.com',
        firebase_uid: 'fb_secret',
        nested: {
          password: 'secret_password',
          contact: 'Reach me at person@hackathon.org for questions',
          safeField: 'Safe Value',
        },
        list: [
          { token: 'abc123token', note: 'Send to support@team.org' },
          { safeItem: 42 },
        ],
      };

      const scrubbed = scrubManifestPrivateFields(rawPayload);

      expect(scrubbed.email).toBeUndefined();
      expect(scrubbed.identityEmail).toBeUndefined();
      expect(scrubbed.sharedContactHandle).toBeUndefined();
      expect(scrubbed.shared_contact_handle).toBeUndefined();
      expect(scrubbed.communicationLink).toBeUndefined();
      expect(scrubbed.firebase_uid).toBeUndefined();
      expect(scrubbed.nested.password).toBeUndefined();
      expect(scrubbed.nested.safeField).toBe('Safe Value');
      expect(scrubbed.nested.contact).toBe('Reach me at [REDACTED_EMAIL] for questions');
      expect(scrubbed.list[0].token).toBeUndefined();
      expect(scrubbed.list[0].note).toBe('Send to [REDACTED_EMAIL]');
      expect(scrubbed.list[1].safeItem).toBe(42);
    });

    it('covers all keys declared in FORBIDDEN_MANIFEST_PRIVATE_KEYS', () => {
      for (const key of FORBIDDEN_MANIFEST_PRIVATE_KEYS) {
        const obj = { [key]: 'sensitive_value', safeKey: 'ok' };
        const scrubbed = scrubManifestPrivateFields(obj);
        expect((scrubbed as Record<string, unknown>)[key]).toBeUndefined();
        expect(scrubbed.safeKey).toBe('ok');
      }
    });
  });

  describe('manifestPayloadHasPrivateField and assertManifestSnapshotIsPiiFree', () => {
    const cleanSnapshot: CanonicalRosterSnapshot = {
      schemaVersion: '1.0',
      teamId: '00000000-0000-0000-0000-000000000001',
      teamName: 'Clean Team',
      eventId: '11111111-1111-1111-1111-111111111111',
      eventTitle: 'Hackathon 2026',
      lockedAt: '2026-10-20T15:30:00.000Z',
      memberCount: 1,
      members: [
        {
          participantId: '22222222-2222-2222-2222-222222222222',
          displayName: 'Alice Chen',
          handle: 'alice_c',
          teamRole: 'Owner',
          primaryRole: 'Frontend',
          institution: 'Centennial College',
          portfolioLinks: [{ label: 'GitHub', url: 'https://github.com/alice' }],
          joinedAt: '2026-10-18T10:00:00.000Z',
          isPseudonymized: false,
        },
      ],
    };

    it('returns false for clean canonical snapshot and passes assertion', () => {
      expect(manifestPayloadHasPrivateField(cleanSnapshot)).toBe(false);
      expect(() => assertManifestSnapshotIsPiiFree(cleanSnapshot)).not.toThrow();
    });

    it('returns true and throws when forbidden key is injected', () => {
      const contaminated = {
        ...cleanSnapshot,
        members: [
          {
            ...cleanSnapshot.members[0],
            shared_contact_handle: 'discord:alice#123',
          },
        ],
      } as unknown as CanonicalRosterSnapshot;

      expect(manifestPayloadHasPrivateField(contaminated)).toBe(true);
      expect(() => assertManifestSnapshotIsPiiFree(contaminated)).toThrow(/contains forbidden private contact/);
    });

    it('returns true and throws when email is detected inside display name or institution', () => {
      const contaminated = {
        ...cleanSnapshot,
        members: [
          {
            ...cleanSnapshot.members[0],
            displayName: 'Alice (alice@example.com)',
          },
        ],
      };

      expect(manifestPayloadHasPrivateField(contaminated)).toBe(true);
      expect(() => assertManifestSnapshotIsPiiFree(contaminated)).toThrow(/contains forbidden private contact/);
    });
  });
});
