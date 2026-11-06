import { describe, it, expect } from 'vitest';
import {
  computeCanonicalSnapshotChecksum,
  normalizeChecksum,
  detectCanonicalSnapshotFieldChanges,
  verifySnapshotChecksum,
  CHECKSUM_PREFIX,
} from './teamManifestChecksum.js';
import { buildCanonicalRosterSnapshot } from '../db/teamManifestModel.js';
import type { CanonicalRosterSnapshot } from '../db/types.js';

describe('teamManifestChecksum service (US-024 / #225 / FR-072)', () => {
  const baseInput = {
    teamId: '00000000-0000-0000-0000-000000000001',
    teamName: 'Innovators',
    eventId: '11111111-1111-1111-1111-111111111111',
    eventTitle: 'Hackathon 2026',
    lockedAt: '2026-10-20T15:30:00.000Z',
    members: [
      {
        participantId: '22222222-2222-2222-2222-222222222222',
        displayName: 'Alice Chen',
        handle: 'alice_c',
        teamRole: 'Owner' as const,
        primaryRole: 'Frontend' as const,
        institution: 'Centennial College',
        portfolioLinks: [{ label: 'GitHub', url: 'https://github.com/alice' }],
        joinedAt: '2026-10-18T10:00:00.000Z',
        isPseudonymized: false,
      },
      {
        participantId: '33333333-3333-3333-3333-333333333333',
        displayName: 'Bob Smith',
        handle: 'bob_s',
        teamRole: 'Member' as const,
        primaryRole: 'Backend' as const,
        institution: null,
        portfolioLinks: [],
        joinedAt: '2026-10-19T11:00:00.000Z',
        isPseudonymized: false,
      },
    ],
  };

  const baseSnapshot = buildCanonicalRosterSnapshot(baseInput);

  describe('normalizeChecksum', () => {
    it('normalizes 64-hex string with or without prefix and handles mixed case', () => {
      const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(normalizeChecksum(hex)).toBe(`${CHECKSUM_PREFIX}${hex}`);
      expect(normalizeChecksum(`SHA256:${hex.toUpperCase()}`)).toBe(`${CHECKSUM_PREFIX}${hex}`);
      expect(normalizeChecksum(`  sha256:${hex}  `)).toBe(`${CHECKSUM_PREFIX}${hex}`);
    });

    it('returns null for invalid hex or length', () => {
      expect(normalizeChecksum('')).toBeNull();
      expect(normalizeChecksum('not-hex')).toBeNull();
      expect(normalizeChecksum('e3b0c44298fc1c149afbf4c8996fb92427ae41e4')).toBeNull(); // 40 chars (SHA-1)
      expect(normalizeChecksum(null)).toBeNull();
      expect(normalizeChecksum(12345)).toBeNull();
    });
  });

  describe('computeCanonicalSnapshotChecksum', () => {
    it('returns deterministic 71-char sha256: lowercase string', () => {
      const checksum = computeCanonicalSnapshotChecksum(baseSnapshot);
      expect(checksum.startsWith(CHECKSUM_PREFIX)).toBe(true);
      expect(checksum.length).toBe(71);
      expect(checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('produces identical checksums for identical canonical snapshots', () => {
      const snapshot1 = buildCanonicalRosterSnapshot(baseInput);
      const snapshot2 = buildCanonicalRosterSnapshot({ ...baseInput });
      expect(computeCanonicalSnapshotChecksum(snapshot1)).toBe(
        computeCanonicalSnapshotChecksum(snapshot2)
      );
    });

    it('produces different checksum when any included field changes (FR-072)', () => {
      const originalChecksum = computeCanonicalSnapshotChecksum(baseSnapshot);

      const modifiedName = buildCanonicalRosterSnapshot({
        ...baseInput,
        teamName: 'Innovators Updated',
      });
      expect(computeCanonicalSnapshotChecksum(modifiedName)).not.toBe(originalChecksum);

      const modifiedLockTime = buildCanonicalRosterSnapshot({
        ...baseInput,
        lockedAt: '2026-10-20T16:00:00.000Z',
      });
      expect(computeCanonicalSnapshotChecksum(modifiedLockTime)).not.toBe(originalChecksum);

      const modifiedMemberRole = buildCanonicalRosterSnapshot({
        ...baseInput,
        members: [
          { ...baseInput.members[0] },
          { ...baseInput.members[1], primaryRole: 'AI/ML' as const },
        ],
      });
      expect(computeCanonicalSnapshotChecksum(modifiedMemberRole)).not.toBe(originalChecksum);
    });
  });

  describe('detectCanonicalSnapshotFieldChanges', () => {
    it('returns no changes when comparing snapshot to itself or null previous', () => {
      expect(detectCanonicalSnapshotFieldChanges(null, baseSnapshot)).toEqual({
        hasChanges: false,
        matchesStoredSnapshot: true,
        previousChecksum: null,
        changedFields: [],
      });

      const clone = buildCanonicalRosterSnapshot({ ...baseInput });
      const result = detectCanonicalSnapshotFieldChanges(baseSnapshot, clone);
      expect(result.hasChanges).toBe(false);
      expect(result.matchesStoredSnapshot).toBe(true);
      expect(result.changedFields).toEqual([]);
    });

    it('accurately identifies changed top-level fields', () => {
      const modified: CanonicalRosterSnapshot = {
        ...baseSnapshot,
        teamName: 'Renamed Team',
        eventTitle: 'Updated Event',
      };

      const result = detectCanonicalSnapshotFieldChanges(baseSnapshot, modified);
      expect(result.hasChanges).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(false);
      expect(result.changedFields).toContain('teamName');
      expect(result.changedFields).toContain('eventTitle');
    });

    it('accurately identifies member-level changes and portfolio link changes', () => {
      const modified = buildCanonicalRosterSnapshot({
        ...baseInput,
        members: [
          {
            ...baseInput.members[0],
            displayName: 'Alice V. Chen',
            portfolioLinks: [
              { label: 'Updated Site', url: 'https://alice.dev' },
            ],
          },
          { ...baseInput.members[1] },
        ],
      });

      const result = detectCanonicalSnapshotFieldChanges(baseSnapshot, modified);
      expect(result.hasChanges).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(false);
      expect(result.changedFields).toContain('members[0].displayName');
      expect(result.changedFields.some((f) => f.includes('portfolioLinks'))).toBe(true);
    });
  });

  describe('verifySnapshotChecksum', () => {
    it('verifies valid matching checksum (with or without sha256: prefix)', () => {
      const expectedChecksum = computeCanonicalSnapshotChecksum(baseSnapshot);
      const rawHex = expectedChecksum.slice(CHECKSUM_PREFIX.length);

      const resultWithPrefix = verifySnapshotChecksum(baseSnapshot, expectedChecksum);
      expect(resultWithPrefix.valid).toBe(true);
      expect(resultWithPrefix.matchesStoredSnapshot).toBe(true);
      expect(resultWithPrefix.expectedChecksum).toBe(expectedChecksum);

      const resultRawHex = verifySnapshotChecksum(baseSnapshot, rawHex.toUpperCase());
      expect(resultRawHex.valid).toBe(true);
      expect(resultRawHex.matchesStoredSnapshot).toBe(true);
    });

    it('detects mismatched checksum', () => {
      const mismatched = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      const result = verifySnapshotChecksum(baseSnapshot, mismatched);
      expect(result.valid).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(false);
    });

    it('rejects malformed candidate checksum', () => {
      const result = verifySnapshotChecksum(baseSnapshot, 'invalid-checksum');
      expect(result.valid).toBe(false);
      expect(result.matchesStoredSnapshot).toBe(false);
    });
  });
});
