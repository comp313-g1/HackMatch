import type { Request, Response, NextFunction } from 'express';
import { participantsRepository } from '../db/participants.repository.js';
import {
  profileRepository,
  type FullParticipantProfileRecord,
  type PortfolioLinkInput,
} from '../db/profile.repository.js';
import type { Participant, ParticipantPrimaryRole } from '../db/types.js';

export const ALLOWED_PRIMARY_ROLES: readonly ParticipantPrimaryRole[] = [
  'Frontend',
  'Backend',
  'Mobile',
  'AI/ML',
  'UI/UX',
  'Pitch',
];

export const SHARED_CONTACT_AUDIENCE_NOTICE =
  'Shared contact handle is visible only to confirmed teammates. Leaving or removal from a team revokes access.';

export const SELF_DECLARED_NOTICE =
  'Self-declared — HackMatch validates URL format only and does not certify skills, identity, or achievements.';

export interface ProfileFieldErrors {
  handle?: string;
  primaryRole?: string;
  institution?: string;
  skills?: string;
  portfolioLinks?: string;
  sharedContactHandle?: string;
}

export interface SanitizedProfilePayload {
  handle: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  institution: string | null;
  skills: string[];
  portfolioLinks: PortfolioLinkInput[];
  sharedContactHandle: string | null;
}

const HANDLE_REGEX = /^[A-Za-z0-9_-]{2,50}$/;

export function isValidHttpsPortfolioUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (trimmed.length <= 8 || trimmed.length > 2048) return false;
  if (!trimmed.toLowerCase().startsWith('https://')) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (!parsed.hostname || !parsed.hostname.includes('.') || parsed.hostname.endsWith('.')) {
      return false;
    }
    if (/\s/.test(trimmed)) return false;
    return true;
  } catch {
    return false;
  }
}

export function validateProfileUpdateInput(body: unknown): {
  errors: ProfileFieldErrors;
  sanitized?: SanitizedProfilePayload;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      errors: {
        primaryRole: 'Invalid profile payload.',
      },
    };
  }

  const record = body as Record<string, unknown>;
  const errors: ProfileFieldErrors = {};

  // 1. Handle validation (optional, 2-50 chars alphanumeric, underscore, hyphen)
  let handle: string | null = null;
  if (record.handle !== undefined && record.handle !== null && record.handle !== '') {
    if (typeof record.handle !== 'string') {
      errors.handle = 'Handle must be a text value.';
    } else {
      const trimmedHandle = record.handle.trim();
      if (trimmedHandle.length > 0) {
        if (!HANDLE_REGEX.test(trimmedHandle)) {
          errors.handle =
            'Handle must be 2 to 50 characters and contain only letters, numbers, underscores, or hyphens.';
        } else {
          handle = trimmedHandle;
        }
      }
    }
  }

  // 2. Primary role validation (Frontend, Backend, Mobile, AI/ML, UI/UX, Pitch)
  let primaryRole: ParticipantPrimaryRole | null = null;
  if (
    record.primaryRole !== undefined &&
    record.primaryRole !== null &&
    record.primaryRole !== ''
  ) {
    if (
      typeof record.primaryRole !== 'string' ||
      !ALLOWED_PRIMARY_ROLES.includes(record.primaryRole.trim() as ParticipantPrimaryRole)
    ) {
      errors.primaryRole = `Primary role must be one of: ${ALLOWED_PRIMARY_ROLES.join(', ')}.`;
    } else {
      primaryRole = record.primaryRole.trim() as ParticipantPrimaryRole;
    }
  }

  // 3. Institution validation (optional, max 150 chars)
  let institution: string | null = null;
  if (
    record.institution !== undefined &&
    record.institution !== null &&
    record.institution !== ''
  ) {
    if (typeof record.institution !== 'string') {
      errors.institution = 'Academic institution must be a text value.';
    } else {
      const trimmedInstitution = record.institution.trim();
      if (trimmedInstitution.length > 150) {
        errors.institution = 'Academic institution must not exceed 150 characters.';
      } else if (trimmedInstitution.length > 0) {
        institution = trimmedInstitution;
      }
    }
  }

  // 4. Skills validation (array of non-empty strings, max 50 chars each, deduplicated case-insensitively)
  const skills: string[] = [];
  if (record.skills !== undefined && record.skills !== null) {
    if (!Array.isArray(record.skills)) {
      errors.skills = 'Skills must be provided as a list of skill tags.';
    } else if (record.skills.length > 25) {
      errors.skills = 'You can specify at most 25 skill tags.';
    } else {
      const seenSkills = new Set<string>();
      for (const item of record.skills) {
        if (typeof item !== 'string' || item.trim().length === 0) {
          errors.skills = 'Each skill tag must be a non-empty string.';
          break;
        }
        const trimmedSkill = item.trim();
        if (trimmedSkill.length > 50) {
          errors.skills = 'Each skill tag must not exceed 50 characters.';
          break;
        }
        const lower = trimmedSkill.toLowerCase();
        if (!seenSkills.has(lower)) {
          seenSkills.add(lower);
          skills.push(trimmedSkill);
        }
      }
    }
  }

  // 5. Portfolio links validation (HTTPS URLs only, optional label <= 100 chars)
  const portfolioLinks: PortfolioLinkInput[] = [];
  if (record.portfolioLinks !== undefined && record.portfolioLinks !== null) {
    if (!Array.isArray(record.portfolioLinks)) {
      errors.portfolioLinks = 'Portfolio links must be provided as a list.';
    } else if (record.portfolioLinks.length > 10) {
      errors.portfolioLinks = 'You can provide at most 10 portfolio links.';
    } else {
      for (const item of record.portfolioLinks) {
        if (typeof item === 'string') {
          const trimmedUrl = item.trim();
          if (trimmedUrl.length === 0) continue;
          if (!isValidHttpsPortfolioUrl(trimmedUrl)) {
            errors.portfolioLinks =
              'All portfolio links must be valid HTTPS URLs (e.g., https://github.com/username).';
            break;
          }
          portfolioLinks.push({ url: trimmedUrl, label: null });
        } else if (item && typeof item === 'object' && !Array.isArray(item)) {
          const linkObj = item as Record<string, unknown>;
          const rawUrl = typeof linkObj.url === 'string' ? linkObj.url.trim() : '';
          if (!isValidHttpsPortfolioUrl(rawUrl)) {
            errors.portfolioLinks =
              'All portfolio links must be valid HTTPS URLs (e.g., https://github.com/username).';
            break;
          }
          let label: string | null = null;
          if (linkObj.label !== undefined && linkObj.label !== null && linkObj.label !== '') {
            if (typeof linkObj.label !== 'string' || linkObj.label.trim().length > 100) {
              errors.portfolioLinks = 'Portfolio link label must not exceed 100 characters.';
              break;
            }
            label = linkObj.label.trim();
          }
          portfolioLinks.push({ url: rawUrl, label });
        } else {
          errors.portfolioLinks =
            'All portfolio links must be valid HTTPS URLs (e.g., https://github.com/username).';
          break;
        }
      }
    }
  }

  // 6. Shared contact handle validation (optional, max 150 chars)
  let sharedContactHandle: string | null = null;
  if (
    record.sharedContactHandle !== undefined &&
    record.sharedContactHandle !== null &&
    record.sharedContactHandle !== ''
  ) {
    if (typeof record.sharedContactHandle !== 'string') {
      errors.sharedContactHandle = 'Shared contact handle must be a text value.';
    } else {
      const trimmedContact = record.sharedContactHandle.trim();
      if (trimmedContact.length > 150) {
        errors.sharedContactHandle = 'Shared contact handle must not exceed 150 characters.';
      } else if (trimmedContact.length > 0) {
        sharedContactHandle = trimmedContact;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    sanitized: {
      handle,
      primaryRole,
      institution,
      skills,
      portfolioLinks,
      sharedContactHandle,
    },
  };
}

export function formatProfileResponse(
  participant: Participant,
  record: FullParticipantProfileRecord,
  options: { isOwner: boolean; includeSharedContact: boolean }
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    displayName: participant.full_name,
    handle: record.profile?.handle ?? null,
    primaryRole: record.profile?.primary_role ?? null,
    institution: record.profile?.institution ?? null,
    skills: record.skills.map((s) => s.skill_name),
    skillsSelfDeclared: true,
    portfolioLinks: record.portfolios.map((p) => ({
      url: p.url,
      label: p.label ?? null,
      isSelfDeclared: true,
    })),
    selfDeclaredNotice: SELF_DECLARED_NOTICE,
  };

  if (options.isOwner) {
    base.participantId = participant.id;
    base.sharedContactHandle = record.profile?.shared_contact_handle ?? null;
    base.sharedContactAudienceNotice = SHARED_CONTACT_AUDIENCE_NOTICE;
  } else if (options.includeSharedContact) {
    base.sharedContactHandle = record.profile?.shared_contact_handle ?? null;
    base.sharedContactAudienceNotice = SHARED_CONTACT_AUDIENCE_NOTICE;
  }

  return base;
}

async function resolveAuthenticatedParticipant(req: Request): Promise<Participant | null> {
  if (req.participant) {
    return req.participant;
  }
  const uid = req.firebaseUser?.uid;
  if (!uid) return null;
  return participantsRepository.findByFirebaseUid(uid);
}

/**
 * GET /api/profiles/me
 * Returns the authenticated PART user's own profile (US-006 AC 1 / FR-013).
 */
export async function getMyProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const participant = await resolveAuthenticatedParticipant(req);
    if (!participant) {
      res.status(404).json({
        error: 'Participant record not found.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    if (participant.role !== 'PART') {
      res.status(403).json({
        error: 'Only participant accounts maintain participant profiles.',
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }

    const fullProfile = await profileRepository.getFullProfile(participant.id);
    res.status(200).json({
      profile: formatProfileResponse(participant, fullProfile, {
        isOwner: true,
        includeSharedContact: true,
      }),
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * GET /api/profiles/:participantId
 * Returns a participant profile according to US-006 AC 3 & AC 4 / FR-014 privacy rules.
 */
export async function getParticipantProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const viewer = await resolveAuthenticatedParticipant(req);
    if (!viewer) {
      res.status(401).json({
        error: 'Authentication required to inspect participant profiles.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const targetParticipantId = String(req.params.participantId || '').trim();
    if (!targetParticipantId) {
      res.status(400).json({
        error: 'Participant identifier is required.',
        code: 'INVALID_PARTICIPANT_ID',
      });
      return;
    }

    const targetParticipant = await participantsRepository.findById(targetParticipantId);
    if (!targetParticipant || targetParticipant.role !== 'PART' || targetParticipant.is_suspended) {
      res.status(404).json({
        error: 'Participant profile not found.',
        code: 'PROFILE_NOT_FOUND',
      });
      return;
    }

    const isOwner = viewer.id === targetParticipant.id;
    const isTeammate = isOwner
      ? true
      : await profileRepository.areConfirmedTeammates(viewer.id, targetParticipant.id);

    const fullProfile = await profileRepository.getFullProfile(targetParticipant.id);
    res.status(200).json({
      profile: formatProfileResponse(targetParticipant, fullProfile, {
        isOwner,
        includeSharedContact: isOwner || isTeammate,
      }),
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * PUT /api/profiles/me and PUT /api/profiles/:participantId
 * Updates the authenticated PART user's own profile (US-006 AC 1, AC 2, AC 5 / FR-013 / FR-082).
 * Rejects cross-account updates with 403 and preserves existing data on validation errors.
 */
export async function updateParticipantProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const participant = await resolveAuthenticatedParticipant(req);
    if (!participant) {
      res.status(404).json({
        error: 'Participant record not found.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    if (participant.role !== 'PART') {
      res.status(403).json({
        error: 'Only participant accounts can edit participant profiles.',
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }

    const paramParticipantId = req.params.participantId
      ? String(req.params.participantId).trim()
      : undefined;
    if (paramParticipantId && paramParticipantId !== participant.id) {
      res.status(403).json({
        error: 'You can only edit your own participant profile.',
        code: 'FORBIDDEN_PROFILE_EDIT',
      });
      return;
    }

    const bodyRecord =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    if (
      (bodyRecord.participantId !== undefined && bodyRecord.participantId !== participant.id) ||
      (bodyRecord.participant_id !== undefined && bodyRecord.participant_id !== participant.id)
    ) {
      res.status(403).json({
        error: 'You can only edit your own participant profile.',
        code: 'FORBIDDEN_PROFILE_EDIT',
      });
      return;
    }

    if (bodyRecord.role !== undefined && String(bodyRecord.role).trim().toUpperCase() !== 'PART') {
      res.status(403).json({
        error: 'Profile updates cannot modify account role or privileges.',
        code: 'FORBIDDEN_ROLE_CHANGE',
      });
      return;
    }

    const { errors, sanitized } = validateProfileUpdateInput(req.body);
    if (Object.keys(errors).length > 0 || !sanitized) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors,
      });
      return;
    }

    if (sanitized.handle) {
      const existingByHandle = await profileRepository.findByHandle(sanitized.handle);
      if (existingByHandle && existingByHandle.participant_id !== participant.id) {
        res.status(409).json({
          error: 'Handle is already taken.',
          code: 'HANDLE_ALREADY_IN_USE',
          errors: {
            handle: 'This handle is already in use by another participant.',
          },
        });
        return;
      }
    }

    const updatedRecord = await profileRepository.upsertFullProfile({
      participantId: participant.id,
      handle: sanitized.handle,
      primaryRole: sanitized.primaryRole,
      institution: sanitized.institution,
      sharedContactHandle: sanitized.sharedContactHandle,
      skills: sanitized.skills,
      portfolioLinks: sanitized.portfolioLinks,
    });

    res.status(200).json({
      message: 'Profile updated successfully.',
      profile: formatProfileResponse(participant, updatedRecord, {
        isOwner: true,
        includeSharedContact: true,
      }),
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    ) {
      res.status(409).json({
        error: 'Handle is already taken.',
        code: 'HANDLE_ALREADY_IN_USE',
        errors: {
          handle: 'This handle is already in use by another participant.',
        },
      });
      return;
    }
    next(err);
  }
}
