import type { CanonicalRosterMember, CanonicalRosterSnapshot } from '../db/types.js';
import type { TeamMembershipRole, ParticipantPrimaryRole } from '../db/types.js';
import { buildMembershipPseudonym } from './membershipPseudonymization.js';
import { isValidHttpsPortfolioUrl } from '../validators/profile.validator.js';

export const FORBIDDEN_MANIFEST_PRIVATE_KEYS = new Set([
  'email',
  'identity_email',
  'identityemail',
  'shared_contact_handle',
  'sharedcontacthandle',
  'shared_contact_audience_notice',
  'sharedcontactaudiencenotice',
  'private_contact',
  'privatecontact',
  'communication_link',
  'communicationlink',
  'firebase_uid',
  'firebaseuid',
  'password',
  'otp_hash',
  'otphash',
  'token',
  'id_token',
  'refresh_token',
  'mfa_secret',
  'recovery_codes',
  'credentials',
]);

export const EMAIL_PATTERN_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export interface ProjectManifestMemberInput {
  membership: {
    participant_id: string;
    role: TeamMembershipRole;
    joined_at: string | Date;
    identity_display_name?: string | null;
    identity_pseudonymized_at?: string | null;
  };
  participant?: {
    id: string;
    full_name: string;
    email?: string;
    firebase_uid?: string;
    is_deactivated?: boolean;
    is_suspended?: boolean;
  } | null;
  profile?: {
    handle?: string | null;
    primary_role?: ParticipantPrimaryRole | null;
    institution?: string | null;
    portfolio_links?: Array<{ url: string; label?: string | null }>;
    shared_contact_handle?: string | null;
  } | null;
}

/**
 * Projects a member record for external manifest exports (US-024 / FR-071 / NR-023).
 * Strictly excludes email, private contact handles, communication links, and auth credentials.
 */
export function projectManifestMember(input: ProjectManifestMemberInput): CanonicalRosterMember {
  const { membership, participant, profile } = input;
  const participantId = membership.participant_id.trim().toLowerCase();
  const joinedAt = new Date(membership.joined_at).toISOString();

  const isPseudonymized = Boolean(
    membership.identity_pseudonymized_at ||
      !participant ||
      participant.is_deactivated === true ||
      participant.firebase_uid?.startsWith('deleted:')
  );

  if (isPseudonymized) {
    const pseudonym =
      membership.identity_display_name?.trim() || buildMembershipPseudonym(participantId);
    return {
      participantId,
      displayName: pseudonym,
      handle: null,
      teamRole: membership.role,
      primaryRole: null,
      institution: null,
      portfolioLinks: [],
      joinedAt,
      isPseudonymized: true,
    };
  }

  // Active participant: project public portfolio info only
  const rawDisplayName = participant?.full_name?.trim() || 'Team Member';
  // Scrub any accidental email string that might be in full_name
  const displayName = rawDisplayName.replace(EMAIL_PATTERN_REGEX, '[REDACTED_EMAIL]');

  const rawHandle = profile?.handle ? profile.handle.trim().replace(/^@+/, '') : null;
  const handle = rawHandle && rawHandle.length > 0 ? rawHandle : null;

  const rawInst = profile?.institution ? profile.institution.trim().replace(/\s+/g, ' ') : null;
  const institution = rawInst && rawInst.length > 0 ? rawInst : null;

  const validLinks: Array<{ label: string | null; url: string }> = [];
  const seenUrls = new Set<string>();

  for (const link of profile?.portfolio_links || []) {
    if (!link || typeof link.url !== 'string') continue;
    const trimmedUrl = link.url.trim();
    if (!isValidHttpsPortfolioUrl(trimmedUrl)) continue;
    const lowerUrl = trimmedUrl.toLowerCase();
    if (!seenUrls.has(lowerUrl)) {
      seenUrls.add(lowerUrl);
      validLinks.push({
        label: link.label ? link.label.trim().replace(/\s+/g, ' ') || null : null,
        url: trimmedUrl,
      });
    }
  }

  validLinks.sort((a, b) => a.url.localeCompare(b.url) || (a.label ?? '').localeCompare(b.label ?? ''));

  return {
    participantId,
    displayName,
    handle,
    teamRole: membership.role,
    primaryRole: profile?.primary_role ?? null,
    institution,
    portfolioLinks: validLinks,
    joinedAt,
    isPseudonymized: false,
  };
}

/**
 * Recursively scrubs private keys and inline email patterns from any manifest payload or snapshot.
 */
export function scrubManifestPrivateFields<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.replace(EMAIL_PATTERN_REGEX, '[REDACTED_EMAIL]') as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubManifestPrivateFields(item)) as unknown as T;
  }

  if (typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_MANIFEST_PRIVATE_KEYS.has(lowerKey)) {
        continue;
      }
      cleaned[key] = scrubManifestPrivateFields(val);
    }
    return cleaned as T;
  }

  return value;
}

/**
 * Verifies whether any forbidden private field or unredacted email exists in an object tree.
 */
export function manifestPayloadHasPrivateField(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return EMAIL_PATTERN_REGEX.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => manifestPayloadHasPrivateField(item));
  }

  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_MANIFEST_PRIVATE_KEYS.has(lowerKey)) {
        return true;
      }
      if (manifestPayloadHasPrivateField(val)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates that a canonical snapshot contains zero forbidden private keys or account emails.
 */
export function assertManifestSnapshotIsPiiFree(snapshot: CanonicalRosterSnapshot): void {
  if (manifestPayloadHasPrivateField(snapshot)) {
    throw new Error('Manifest snapshot contains forbidden private contact fields or email addresses.');
  }
}
