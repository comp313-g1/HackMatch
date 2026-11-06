import { describe, it, expect } from 'vitest';
import {
  computeClientSnapshotChecksum,
  normalizeChecksumInput,
  validateChecksumInput,
  detectClientSnapshotFieldChanges,
  verifyClientSnapshotChecksum,
  CHECKSUM_PREFIX,
} from './teamManifestChecksum';
import type { CanonicalRosterSnapshotView } from './teamManifestExport';

describe('client teamManifestChecksum (US-024 / #225 / FR-072)', () => {
  const sampleSnapshot: CanonicalRosterSnapshotView = {
    schemaVersion: '1.0',
    teamId: '00000000-0000-0000-0000-000000000001',
    teamName: 'Innovators',
    eventId: '11111111-1111-1111-1111-111111111111',
    eventTitle: 'Centennial Hackathon',
    lockedAt: '2026-10-20T15:30:00.000Z',
    memberCount: 2,
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
      {
        participantId: '33333333-3333-3333-3333-333333333333',
        displayName: 'Bob Smith',
        handle: null,
        teamRole: 'Member',
        primaryRole: 'Backend',
        institution: null,
        portfolioLinks: [],
        joinedAt: '2026-10-19T11:00:00.000Z',
        isPseudonymized: false,
      },
    ],
  };

  describe('normalizeChecksumInput', () => {
    it('normalizes 64-hex string and standardizes sha256: prefix', () => {
      const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(normalizeChecksumInput(hex)).toBe(`${CHECKSUM_PREFIX}${hex}`);
      expect(normalizeChecksumInput(`SHA256:${hex.toUpperCase()}`)).toBe(`${CHECKSUM_PREFIX}${hex}`);
      expect(normalizeChecksumInput(`  sha256:${hex}  `)).toBe(`${CHECKSUM_PREFIX}${hex}`);
    });

    it('returns null for invalid strings', () => {
      expect(normalizeChecksumInput('')).toBeNull();
      expect(normalizeChecksumInput('abc')).toBeNull();
      expect(normalizeChecksumInput(null)).toBeNull();
      expect(normalizeChecksumInput(undefined)).toBeNull();
    });
  });

  describe('validateChecksumInput', () => {
    it('validates correct candidate checksum and provides normalized form', () => {
      const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = validateChecksumInput(hex);
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe(`${CHECKSUM_PREFIX}${hex}`);
      expect(result.error).toBeUndefined();
    });

    it('returns validation error for empty input', () => {
      const result = validateChecksumInput('   ');
      expect(result.valid).toBe(false);
      expect(result.normalized).toBeNull();
      expect(result.error).toBe('Checksum is required.');
    });

    it('returns validation error for malformed hex', () => {
      const result = validateChecksumInput('sha256:not-valid-hex');
      expect(result.valid).toBe(false);
      expect(result.normalized).toBeNull();
      expect(result.error).toContain('valid 64-character SHA-256');
    });
  });

  describe('computeClientSnapshotChecksum', () => {
    it('produces known FIPS standard SHA-256 hash for raw string', () => {
      expect(computeClientSnapshotChecksum('')).toBe(
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
      expect(computeClientSnapshotChecksum('hello')).toBe(
        'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      );
    });

    it('produces 71-character sha256:<64-hex> string deterministically', () => {
      const checksum1 = computeClientSnapshotChecksum(sampleSnapshot);
      const checksum2 = computeClientSnapshotChecksum({ ...sampleSnapshot });
      expect(checksum1).toBe(checksum2);
      expect(checksum1.startsWith(CHECKSUM_PREFIX)).toBe(true);
      expect(checksum1.length).toBe(71);
    });

    it('changes checksum if any member property changes', () => {
      const original = computeClientSnapshotChecksum(sampleSnapshot);
      const changed: CanonicalRosterSnapshotView = {
        ...sampleSnapshot,
        members: [
          { ...sampleSnapshot.members[0], displayName: 'Alice Victoria Chen' },
          { ...sampleSnapshot.members[1] },
        ],
      };
      expect(computeClientSnapshotChecksum(changed)).not.toBe(original);
    });
  });

  describe('detectClientSnapshotFieldChanges', () => {
    it('detects no changes for identical snapshots', () => {
      const result = detectClientSnapshotFieldChanges(sampleSnapshot, { ...sampleSnapshot });
      expect(result.hasChanges).toBe(false);
      expect(result.matchesStoredSnapshot).toBe(true);
      expect(result.changedFields).toEqual([]);
    });

    it('identifies top-level and member-level changes', () => {
      const modified: CanonicalRosterSnapshotView = {
        ...sampleSnapshot,
        teamName: 'Innovators 2.0',
        members: [
          { ...sampleSnapshot.members[0] },
          { ...sampleSnapshot.members[1], primaryRole: 'AI/ML' },
        ],
      };

      const result = detectClientSnapshotFieldChanges(sampleSnapshot, modified);
      expect(result.hasChanges).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(false);
      expect(result.changedFields).toContain('teamName');
      expect(result.changedFields).toContain('members[1].primaryRole');
    });
  });

  describe('verifyClientSnapshotChecksum', () => {
    it('verifies matching checksum', () => {
      const expected = computeClientSnapshotChecksum(sampleSnapshot);
      const result = verifyClientSnapshotChecksum(sampleSnapshot, expected);
      expect(result.valid).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(true);
    });

    it('flags mismatched checksum', () => {
      const mismatched = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
      const result = verifyClientSnapshotChecksum(sampleSnapshot, mismatched);
      expect(result.valid).toBe(true);
      expect(result.matchesStoredSnapshot).toBe(false);
    });
  });
});
