import type { CanonicalRosterSnapshotView } from './teamManifestExport';

export const CHECKSUM_PREFIX = 'sha256:' as const;
export const CHECKSUM_HEX_REGEX = /^[0-9a-fA-F]{64}$/;
export const CHECKSUM_FULL_REGEX = /^sha256:[0-9a-fA-F]{64}$/i;

export interface ManifestChangeDetectionView {
  hasChanges: boolean;
  matchesStoredSnapshot: boolean;
  previousChecksum: string | null;
  changedFields: string[];
}

export interface ManifestChecksumVerificationViewResult {
  valid: boolean;
  expectedChecksum: string;
  normalizedCandidate: string;
  matchesStoredSnapshot: boolean;
  algorithm: 'SHA-256';
}

/**
 * Pure TypeScript synchronous SHA-256 implementation (FIPS 180-4 compliant).
 * Ensures zero-dependency, synchronous hashing across browser and JSDOM environments.
 */
function sha256Hex(asciiOrUtf8: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(asciiOrUtf8);
  const bitLength = bytes.length * 8;

  // Pre-processing: padding
  const totalLength = ((bytes.length + 8) >> 6) + 1;
  const words = new Uint32Array(totalLength * 16);

  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);

  // Big-endian 64-bit integer length at end of words
  words[words.length - 1] = bitLength & 0xffffffff;
  words[words.length - 2] = Math.floor(bitLength / 0x100000000);

  // Initial hash values
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  // Round constants
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const w = new Uint32Array(64);

  for (let i = 0; i < words.length; i += 16) {
    for (let j = 0; j < 16; j++) {
      w[j] = words[i + j];
    }
    for (let j = 16; j < 64; j++) {
      const s0 =
        ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^
        ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^
        (w[j - 15] >>> 3);
      const s1 =
        ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^
        ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^
        (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let j = 0; j < 64; j++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${toHex(h0)}${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}${toHex(h5)}${toHex(h6)}${toHex(h7)}`;
}

/**
 * Deterministically serializes client snapshot with fixed key ordering matching server canonical serialization.
 */
export function serializeClientCanonicalSnapshot(snapshot: CanonicalRosterSnapshotView): string {
  const canonicalObject = {
    schemaVersion: snapshot.schemaVersion,
    teamId: snapshot.teamId,
    teamName: snapshot.teamName,
    eventId: snapshot.eventId,
    eventTitle: snapshot.eventTitle,
    lockedAt: snapshot.lockedAt,
    memberCount: snapshot.memberCount,
    members: snapshot.members.map((m) => ({
      participantId: m.participantId,
      displayName: m.displayName,
      handle: m.handle,
      teamRole: m.teamRole,
      primaryRole: m.primaryRole,
      institution: m.institution,
      portfolioLinks: m.portfolioLinks.map((p) => ({
        label: p.label,
        url: p.url,
      })),
      joinedAt: m.joinedAt,
      isPseudonymized: m.isPseudonymized,
    })),
  };

  return JSON.stringify(canonicalObject);
}

/**
 * Computes canonical SHA-256 checksum with 'sha256:' prefix (US-024 / FR-072).
 */
export function computeClientSnapshotChecksum(
  snapshotOrCanonicalJson: CanonicalRosterSnapshotView | string
): string {
  const canonicalJson =
    typeof snapshotOrCanonicalJson === 'string'
      ? snapshotOrCanonicalJson
      : serializeClientCanonicalSnapshot(snapshotOrCanonicalJson);

  return `${CHECKSUM_PREFIX}${sha256Hex(canonicalJson)}`;
}

/**
 * Normalizes user-entered checksum input string:
 * trims, lowercases, removes optional 'sha256:' prefix, checks 64-hex validity,
 * and returns 'sha256:<64-hex>' (71 chars) or null.
 */
export function normalizeChecksumInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  const hexPart = trimmed.startsWith(CHECKSUM_PREFIX)
    ? trimmed.slice(CHECKSUM_PREFIX.length)
    : trimmed;

  if (!/^[0-9a-f]{64}$/.test(hexPart)) {
    return null;
  }

  return `${CHECKSUM_PREFIX}${hexPart}`;
}

/**
 * Validates checksum input and provides human-readable error if invalid (US-024 / NR-010).
 */
export function validateChecksumInput(raw: unknown): {
  valid: boolean;
  normalized: string | null;
  error?: string;
} {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {
      valid: false,
      normalized: null,
      error: 'Checksum is required.',
    };
  }

  const normalized = normalizeChecksumInput(raw);
  if (!normalized) {
    return {
      valid: false,
      normalized: null,
      error: 'Checksum must be a valid 64-character SHA-256 hexadecimal string (e.g. sha256:... or 64 hex characters).',
    };
  }

  return {
    valid: true,
    normalized,
  };
}

/**
 * Detects changes between previous and current client snapshot views.
 */
export function detectClientSnapshotFieldChanges(
  previous: CanonicalRosterSnapshotView | null,
  current: CanonicalRosterSnapshotView
): ManifestChangeDetectionView {
  if (!previous) {
    return {
      hasChanges: false,
      matchesStoredSnapshot: true,
      previousChecksum: null,
      changedFields: [],
    };
  }

  const prevChecksum = computeClientSnapshotChecksum(previous);
  const currChecksum = computeClientSnapshotChecksum(current);

  if (prevChecksum === currChecksum) {
    return {
      hasChanges: false,
      matchesStoredSnapshot: true,
      previousChecksum: prevChecksum,
      changedFields: [],
    };
  }

  const changedFields: string[] = [];

  if (previous.schemaVersion !== current.schemaVersion) changedFields.push('schemaVersion');
  if (previous.teamId !== current.teamId) changedFields.push('teamId');
  if (previous.teamName !== current.teamName) changedFields.push('teamName');
  if (previous.eventId !== current.eventId) changedFields.push('eventId');
  if (previous.eventTitle !== current.eventTitle) changedFields.push('eventTitle');
  if (previous.lockedAt !== current.lockedAt) changedFields.push('lockedAt');
  if (previous.memberCount !== current.memberCount) changedFields.push('memberCount');

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
 * Validates candidate checksum against client snapshot view.
 */
export function verifyClientSnapshotChecksum(
  snapshot: CanonicalRosterSnapshotView,
  candidateChecksum: string
): ManifestChecksumVerificationViewResult {
  const normalizedCandidate = normalizeChecksumInput(candidateChecksum);
  const expectedChecksum = computeClientSnapshotChecksum(snapshot);

  if (!normalizedCandidate) {
    return {
      valid: false,
      expectedChecksum,
      normalizedCandidate: typeof candidateChecksum === 'string' ? candidateChecksum.trim().toLowerCase() : '',
      matchesStoredSnapshot: false,
      algorithm: 'SHA-256',
    };
  }

  return {
    valid: true,
    expectedChecksum,
    normalizedCandidate,
    matchesStoredSnapshot: expectedChecksum === normalizedCandidate,
    algorithm: 'SHA-256',
  };
}
