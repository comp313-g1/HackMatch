import crypto from 'node:crypto';
import type { CanonicalRosterSnapshot } from '../db/types.js';
import { serializeCanonicalRosterSnapshot } from '../db/teamManifestModel.js';

export const CHECKSUM_PREFIX = 'sha256:' as const;
export const CHECKSUM_HEX_REGEX = /^[0-9a-f]{64}$/;
export const CHECKSUM_FULL_REGEX = /^sha256:[0-9a-f]{64}$/;

export interface ManifestChangeDetection {
  hasChanges: boolean;
  matchesStoredSnapshot: boolean;
  previousChecksum: string | null;
  changedFields: string[];
}

export interface ManifestChecksumVerificationResult {
  valid: boolean;
  expectedChecksum: string;
  normalizedCandidate: string;
  matchesStoredSnapshot: boolean;
  algorithm: 'SHA-256';
}

/**
 * Normalizes candidate checksum input: trims, lowercases, strips optional 'sha256:' prefix,
 * validates 64 hex characters, and returns standardized 'sha256:<64-hex>' (71 chars), or null if invalid.
 */
export function normalizeChecksum(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  const hexPart = trimmed.startsWith(CHECKSUM_PREFIX)
    ? trimmed.slice(CHECKSUM_PREFIX.length)
    : trimmed;

  if (!CHECKSUM_HEX_REGEX.test(hexPart)) {
    return null;
  }

  return `${CHECKSUM_PREFIX}${hexPart}`;
}

/**
 * Computes canonical SHA-256 checksum with 'sha256:' prefix (US-024 / FR-072).
 * Returns lowercase 'sha256:' + 64 hex characters (71 chars total).
 */
export function computeCanonicalSnapshotChecksum(
  snapshotOrCanonicalJson: CanonicalRosterSnapshot | string
): string {
  const canonicalJson =
    typeof snapshotOrCanonicalJson === 'string'
      ? snapshotOrCanonicalJson
      : serializeCanonicalRosterSnapshot(snapshotOrCanonicalJson);

  const hash = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex').toLowerCase();
  return `${CHECKSUM_PREFIX}${hash}`;
}

/**
 * Compares two snapshots field-by-field to detect changes in included manifest fields (US-024 / FR-072).
 * Returns deterministic field paths whenever any included field differs.
 */
export function detectCanonicalSnapshotFieldChanges(
  previous: CanonicalRosterSnapshot | null,
  current: CanonicalRosterSnapshot
): ManifestChangeDetection {
  if (!previous) {
    return {
      hasChanges: false,
      matchesStoredSnapshot: true,
      previousChecksum: null,
      changedFields: [],
    };
  }

  const prevChecksum = computeCanonicalSnapshotChecksum(previous);
  const currChecksum = computeCanonicalSnapshotChecksum(current);

  if (prevChecksum === currChecksum) {
    return {
      hasChanges: false,
      matchesStoredSnapshot: true,
      previousChecksum: prevChecksum,
      changedFields: [],
    };
  }

  const changedFields: string[] = [];

  // Top-level fields
  if (previous.schemaVersion !== current.schemaVersion) changedFields.push('schemaVersion');
  if (previous.teamId !== current.teamId) changedFields.push('teamId');
  if (previous.teamName !== current.teamName) changedFields.push('teamName');
  if (previous.eventId !== current.eventId) changedFields.push('eventId');
  if (previous.eventTitle !== current.eventTitle) changedFields.push('eventTitle');
  if (previous.lockedAt !== current.lockedAt) changedFields.push('lockedAt');
  if (previous.memberCount !== current.memberCount) changedFields.push('memberCount');

  // Members comparison
  const maxMembers = Math.max(previous.members.length, current.members.length);
  for (let i = 0; i < maxMembers; i++) {
    const prevMember = previous.members[i];
    const currMember = current.members[i];

    if (!prevMember || !currMember) {
      changedFields.push(`members[${i}]`);
      continue;
    }

    if (prevMember.participantId !== currMember.participantId) {
      changedFields.push(`members[${i}].participantId`);
    }
    if (prevMember.displayName !== currMember.displayName) {
      changedFields.push(`members[${i}].displayName`);
    }
    if (prevMember.handle !== currMember.handle) {
      changedFields.push(`members[${i}].handle`);
    }
    if (prevMember.teamRole !== currMember.teamRole) {
      changedFields.push(`members[${i}].teamRole`);
    }
    if (prevMember.primaryRole !== currMember.primaryRole) {
      changedFields.push(`members[${i}].primaryRole`);
    }
    if (prevMember.institution !== currMember.institution) {
      changedFields.push(`members[${i}].institution`);
    }
    if (prevMember.joinedAt !== currMember.joinedAt) {
      changedFields.push(`members[${i}].joinedAt`);
    }
    if (prevMember.isPseudonymized !== currMember.isPseudonymized) {
      changedFields.push(`members[${i}].isPseudonymized`);
    }

    // Portfolio links
    const maxLinks = Math.max(
      prevMember.portfolioLinks?.length || 0,
      currMember.portfolioLinks?.length || 0
    );
    for (let j = 0; j < maxLinks; j++) {
      const prevLink = prevMember.portfolioLinks?.[j];
      const currLink = currMember.portfolioLinks?.[j];

      if (!prevLink || !currLink) {
        changedFields.push(`members[${i}].portfolioLinks[${j}]`);
        continue;
      }

      if (prevLink.url !== currLink.url || prevLink.label !== currLink.label) {
        changedFields.push(`members[${i}].portfolioLinks[${j}]`);
      }
    }
  }

  return {
    hasChanges: true,
    matchesStoredSnapshot: false,
    previousChecksum: prevChecksum,
    changedFields,
  };
}

/**
 * Validates candidate checksum against stored snapshot using timing-safe comparison (US-024 / FR-072).
 */
export function verifySnapshotChecksum(
  snapshot: CanonicalRosterSnapshot,
  candidateChecksum: string
): ManifestChecksumVerificationResult {
  const normalizedCandidate = normalizeChecksum(candidateChecksum);
  const expectedChecksum = computeCanonicalSnapshotChecksum(snapshot);

  if (!normalizedCandidate) {
    return {
      valid: false,
      expectedChecksum,
      normalizedCandidate: typeof candidateChecksum === 'string' ? candidateChecksum.trim().toLowerCase() : '',
      matchesStoredSnapshot: false,
      algorithm: 'SHA-256',
    };
  }

  const expectedBuf = Buffer.from(expectedChecksum, 'utf8');
  const candidateBuf = Buffer.from(normalizedCandidate, 'utf8');

  const matchesStoredSnapshot =
    expectedBuf.length === candidateBuf.length &&
    crypto.timingSafeEqual(expectedBuf, candidateBuf);

  return {
    valid: true,
    expectedChecksum,
    normalizedCandidate,
    matchesStoredSnapshot,
    algorithm: 'SHA-256',
  };
}
