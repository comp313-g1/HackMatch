import { buildMembershipPseudonym } from './membershipPseudonymization.js';
import { isValidHttpsPortfolioUrl } from '../validators/profile.validator.js';
import type {
  Participant,
  TeamMembership,
  TeamMembershipRole,
} from '../db/types.js';
import type { PermittedCandidateProfileView } from './profilePrivacy.js';

export const WORKSPACE_PRIVACY_NOTICE =
  'Workspace shows permitted teammate contact handles, self-declared portfolio links, and roles only. Account emails and authentication credentials are never exposed.';

export const FORBIDDEN_WORKSPACE_AUTH_KEYS = new Set([
  'email',
  'identity_email',
  'identityemail',
  'password',
  'otp_hash',
  'otphash',
  'token',
  'id_token',
  'idtoken',
  'refresh_token',
  'refreshtoken',
  'firebase_uid',
  'firebaseuid',
  'mfa_secret',
  'mfasecret',
  'recovery_codes',
  'recoverycodes',
  'credentials',
]);

/**
 * Checks if a payload contains any accidental auth/private identity keys.
 */
export function publicPayloadHasPrivateWorkspaceKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  if (Array.isArray(value)) {
    return value.some((item) => publicPayloadHasPrivateWorkspaceKey(item));
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_WORKSPACE_AUTH_KEYS.has(lower)) {
      return true;
    }
    if (publicPayloadHasPrivateWorkspaceKey(record[key])) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively deep-scrubs forbidden private auth/PII keys from workspace responses (US-023 AC 2).
 */
export function scrubPrivateWorkspaceFields<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      scrubPrivateWorkspaceFields(item)
    ) as unknown as T;
  }

  const record = value as Record<string, unknown>;
  const clean: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (!FORBIDDEN_WORKSPACE_AUTH_KEYS.has(lower)) {
      clean[key] = scrubPrivateWorkspaceFields(val);
    }
  }

  return clean as T;
}

/**
 * Strips script tags, iframes, object/embed tags, inline on* handlers,
 * and unsafe markdown links (javascript:, data:, vbscript:) before persisting or returning markdown.
 */
export function sanitizeWorkspaceMarkdown(raw: string): string {
  if (typeof raw !== 'string') return '';

  let sanitized = raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\s*on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');

  // Sanitize markdown links [label](url) - neutralize unsafe schemes
  sanitized = sanitized.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (fullMatch, label: string, url: string) => {
      const trimmedUrl = url.trim();
      if (isValidHttpsPortfolioUrl(trimmedUrl)) {
        return `[${label}](${trimmedUrl})`;
      }
      return `${label} [unsafe link removed]`;
    }
  );

  return sanitized.trim();
}

export interface WorkspaceTeammateContact {
  participantId: string;
  displayName: string;
  handle: string | null;
  institution: string | null;
  primaryRole: string | null;
  teamRole: TeamMembershipRole;
  joinedAt: string;
  skills: string[];
  skillsSelfDeclared: true;
  portfolioLinks: Array<{
    url: string;
    label: string | null;
    isSelfDeclared: true;
  }>;
  selfDeclaredNotice: string;
  sharedContactHandle: string | null;
  sharedContactAudienceNotice: string;
  experienceBadge: string;
  isPseudonymized?: boolean;
}

/**
 * Projects teammate contact details for the private workspace with NR-023 deletion pseudonymization.
 * Never exposes account email or auth UIDs (US-023 AC 2).
 */
export function projectWorkspaceTeammateContact(params: {
  participant: Participant;
  projectedProfile: PermittedCandidateProfileView;
  membership?:
    | TeamMembership
    | {
        role: TeamMembershipRole;
        joined_at: string;
        identity_pseudonymized_at?: string | null;
      }
    | null;
}): WorkspaceTeammateContact {
  const { participant, projectedProfile, membership } = params;

  const isDeactivatedOrDeleted =
    participant.is_deactivated ||
    participant.firebase_uid.startsWith('deleted:') ||
    Boolean(
      (membership as { identity_pseudonymized_at?: string | null })
        ?.identity_pseudonymized_at
    );

  if (isDeactivatedOrDeleted) {
    const pseudonym = buildMembershipPseudonym(participant.id);
    return {
      participantId: participant.id,
      displayName: pseudonym,
      handle: null,
      institution: null,
      primaryRole: null,
      teamRole: membership?.role ?? 'Member',
      joinedAt: membership?.joined_at ?? '',
      skills: [],
      skillsSelfDeclared: true,
      portfolioLinks: [],
      selfDeclaredNotice: projectedProfile.selfDeclaredNotice,
      sharedContactHandle: null,
      sharedContactAudienceNotice:
        projectedProfile.sharedContactAudienceNotice || '',
      experienceBadge: 'Beginner',
      isPseudonymized: true,
    };
  }

  return {
    participantId: participant.id,
    displayName: participant.full_name,
    handle: projectedProfile.handle ?? null,
    institution: projectedProfile.institution ?? null,
    primaryRole: projectedProfile.primaryRole ?? null,
    teamRole: membership?.role ?? 'Member',
    joinedAt: membership?.joined_at ?? '',
    skills: projectedProfile.skills,
    skillsSelfDeclared: projectedProfile.skillsSelfDeclared,
    portfolioLinks: projectedProfile.portfolioLinks,
    selfDeclaredNotice: projectedProfile.selfDeclaredNotice,
    sharedContactHandle: projectedProfile.sharedContactHandle ?? null,
    sharedContactAudienceNotice:
      projectedProfile.sharedContactAudienceNotice || '',
    experienceBadge: projectedProfile.experienceBadge || 'Beginner',
    isPseudonymized: false,
  };
}

/**
 * Resolves author display name for a revision, taking into account account deletion/pseudonymization.
 */
export function resolveWorkspaceRevisionAuthor(revision: {
  author_id?: string | null;
  author_display_name?: string | null;
  author_pseudonymized_at?: string | null;
}): string {
  if (revision.author_pseudonymized_at && revision.author_display_name) {
    return revision.author_display_name;
  }
  if (!revision.author_id) {
    return revision.author_display_name || 'Former Member';
  }
  return revision.author_display_name || 'Former Member';
}

export function workspacePrivacyFlags(): {
  notice: string;
  emailsScrubbed: true;
  authUidsScrubbed: true;
} {
  return {
    notice: WORKSPACE_PRIVACY_NOTICE,
    emailsScrubbed: true,
    authUidsScrubbed: true,
  };
}
