import type { ParticipantPrimaryRole, TeamMembershipRole } from './types.js';
import { isValidHttpsPortfolioUrl } from '../validators/profile.validator.js';

export const MANIFEST_SCHEMA_VERSION = '1.0' as const;

export const MANIFEST_RECORDED_BY_LABEL =
  'Lock time recorded by HackMatch server; SHA-256 checksum is for integrity comparison with the stored server record.';

export const MANIFEST_INTEGRITY_NOTICE =
  'This lock timestamp is recorded by HackMatch and the SHA-256 checksum is an integrity comparison with the stored server snapshot only. It does not independently prove pre-event team formation, legal eligibility, or official event organizer approval/acceptance.';

export const MANIFEST_PRIVACY_EXCLUSION_NOTICE =
  'Account email addresses and private teammate contact handles are strictly excluded from roster exports.';

export interface CanonicalRosterPortfolioLink {
  label: string | null;
  url: string;
}

export interface CanonicalRosterMember {
  participantId: string;
  displayName: string;
  handle: string | null;
  teamRole: TeamMembershipRole;
  primaryRole: ParticipantPrimaryRole | null;
  institution: string | null;
  portfolioLinks: CanonicalRosterPortfolioLink[];
  joinedAt: string;
  isPseudonymized: boolean;
}

export interface CanonicalRosterSnapshot {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  teamId: string;
  teamName: string;
  eventId: string;
  eventTitle: string;
  lockedAt: string;
  memberCount: number;
  members: CanonicalRosterMember[];
}

export interface BuildCanonicalRosterSnapshotInput {
  teamId: string;
  teamName: string;
  eventId: string;
  eventTitle: string;
  lockedAt: string | Date;
  members: Array<{
    participantId: string;
    displayName: string;
    handle?: string | null;
    teamRole: TeamMembershipRole;
    primaryRole?: ParticipantPrimaryRole | null;
    institution?: string | null;
    portfolioLinks?: Array<{ label?: string | null; url: string }>;
    joinedAt: string | Date;
    isPseudonymized?: boolean;
  }>;
}

/**
 * Normalizes and sorts all snapshot inputs into a deterministic canonical shape (US-024 / FR-072).
 *
 * Determinism guarantees:
 * 1. Timestamps normalized to ISO-8601 UTC strings.
 * 2. Members sorted canonically: Owner first, then participantId ascending.
 * 3. Portfolio links filtered to valid HTTPS, deduplicated by URL, sorted by url ASC then label ASC.
 * 4. Strings trimmed and whitespace-collapsed.
 */
export function buildCanonicalRosterSnapshot(
  input: BuildCanonicalRosterSnapshotInput
): CanonicalRosterSnapshot {
  const teamId = input.teamId.trim().toLowerCase();
  const teamName = input.teamName.trim().replace(/\s+/g, ' ');
  const eventId = input.eventId.trim().toLowerCase();
  const eventTitle = input.eventTitle.trim().replace(/\s+/g, ' ');
  const lockedAt = new Date(input.lockedAt).toISOString();

  const sortedMembers: CanonicalRosterMember[] = (input.members || [])
    .map((m) => {
      const participantId = m.participantId.trim().toLowerCase();
      const displayName = m.displayName.trim().replace(/\s+/g, ' ');
      const rawHandle = m.handle ? m.handle.trim().replace(/^@+/, '') : null;
      const handle = rawHandle && rawHandle.length > 0 ? rawHandle : null;
      const teamRole: TeamMembershipRole = m.teamRole === 'Owner' ? 'Owner' : 'Member';
      const primaryRole: ParticipantPrimaryRole | null = m.primaryRole ?? null;
      const rawInst = m.institution ? m.institution.trim().replace(/\s+/g, ' ') : null;
      const institution = rawInst && rawInst.length > 0 ? rawInst : null;

      // Filter and deduplicate portfolio links
      const linkMap = new Map<string, CanonicalRosterPortfolioLink>();
      for (const link of m.portfolioLinks || []) {
        if (!link || typeof link.url !== 'string') continue;
        const trimmedUrl = link.url.trim();
        if (!isValidHttpsPortfolioUrl(trimmedUrl)) continue;
        const normalizedKey = trimmedUrl.toLowerCase();
        if (!linkMap.has(normalizedKey)) {
          linkMap.set(normalizedKey, {
            label: link.label ? link.label.trim().replace(/\s+/g, ' ') || null : null,
            url: trimmedUrl,
          });
        }
      }

      const portfolioLinks = Array.from(linkMap.values()).sort((a, b) => {
        const urlCmp = a.url.localeCompare(b.url);
        if (urlCmp !== 0) return urlCmp;
        return (a.label ?? '').localeCompare(b.label ?? '');
      });

      const joinedAt = new Date(m.joinedAt).toISOString();
      const isPseudonymized = Boolean(m.isPseudonymized);

      return {
        participantId,
        displayName,
        handle,
        teamRole,
        primaryRole,
        institution,
        portfolioLinks,
        joinedAt,
        isPseudonymized,
      };
    })
    .sort((a, b) => {
      const aRank = a.teamRole === 'Owner' ? 0 : 1;
      const bRank = b.teamRole === 'Owner' ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      return a.participantId.localeCompare(b.participantId);
    });

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    teamId,
    teamName,
    eventId,
    eventTitle,
    lockedAt,
    memberCount: sortedMembers.length,
    members: sortedMembers,
  };
}

/**
 * Deterministically serializes a canonical snapshot with fixed key ordering (US-024 / FR-072).
 * Identical snapshots always produce identical character-for-character JSON string outputs.
 */
export function serializeCanonicalRosterSnapshot(
  snapshot: CanonicalRosterSnapshot
): string {
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
