import type { Request, Response, NextFunction } from 'express';
import { participantsRepository } from '../db/participants.repository.js';
import {
  profileRepository,
  type FullParticipantProfileRecord,
} from '../db/profile.repository.js';
import type {
  Participant,
  ParticipantHackathonHistory,
  ParticipantPrimaryRole,
} from '../db/types.js';
import {
  ALLOWED_PRIMARY_ROLES,
  isValidHttpsPortfolioUrl,
  validateProfileUpdateInput,
  type ProfileFieldErrors,
  type SanitizedProfilePayload,
} from '../validators/profile.validator.js';
import {
  SHARED_CONTACT_AUDIENCE_NOTICE,
  SELF_DECLARED_NOTICE,
  VISITOR_ANONYMIZED_NOTICE,
  resolveProfileViewerCategory,
  projectProfileForViewer,
} from '../services/profilePrivacy.js';

export {
  ALLOWED_PRIMARY_ROLES,
  isValidHttpsPortfolioUrl,
  validateProfileUpdateInput,
  SHARED_CONTACT_AUDIENCE_NOTICE,
  SELF_DECLARED_NOTICE,
  VISITOR_ANONYMIZED_NOTICE,
  type ProfileFieldErrors,
  type SanitizedProfilePayload,
};

export function formatProfileResponse(
  participant: Participant,
  record: FullParticipantProfileRecord,
  options: { isOwner: boolean; includeSharedContact: boolean }
): Record<string, unknown> {
  const category = options.isOwner
    ? 'OWNER'
    : options.includeSharedContact
      ? 'CONFIRMED_TEAMMATE'
      : 'PART';
  return projectProfileForViewer(participant, record, category) as unknown as Record<
    string,
    unknown
  >;
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
 * GET /api/profiles/:participantId/preview
 * Public anonymized preview for unauthenticated Visitors (US-006 Description, AC 3 / FR-014).
 * Never exposes member handles, display names, portfolio links, private contacts, or emails.
 */
export async function getVisitorProfilePreview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
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

    const fullProfile = await profileRepository.getFullProfile(targetParticipant.id);
    res.status(200).json({
      preview: projectProfileForViewer(targetParticipant, fullProfile, 'VISITOR'),
    });
  } catch (err: unknown) {
    next(err);
  }
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
      profile: projectProfileForViewer(participant, fullProfile, 'OWNER'),
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

    const viewerCategory = resolveProfileViewerCategory({
      viewerParticipantId: viewer.id,
      viewerRole: viewer.role,
      targetParticipantId: targetParticipant.id,
      isConfirmedTeammate: isTeammate,
    });

    const fullProfile = await profileRepository.getFullProfile(targetParticipant.id);
    res.status(200).json({
      profile: projectProfileForViewer(targetParticipant, fullProfile, viewerCategory),
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
      profile: projectProfileForViewer(participant, updatedRecord, 'OWNER'),
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

export function formatHistoryRecord(entry: ParticipantHackathonHistory) {
  return {
    id: entry.id,
    participantId: entry.participant_id,
    eventName: entry.event_name,
    eventDate: entry.event_date,
    teamRole: entry.team_role,
    projectTitle: entry.project_title,
    projectUrl: entry.project_url,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

/**
 * GET /api/profiles/me/history
 * Returns the authenticated PART user's own hackathon history list (US-007 / FR-015).
 */
export async function getMyHackathonHistory(
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
        error: 'Only participant accounts maintain hackathon history.',
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }

    const records = await profileRepository.findHistoryByParticipantId(participant.id);
    res.status(200).json({
      participantId: participant.id,
      viewerCategory: 'OWNER',
      hackathonCount: records.length,
      isSelfReported: true,
      history: records.map(formatHistoryRecord),
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * GET /api/profiles/:participantId/history
 * Returns hackathon history for authenticated PART viewers (US-007 AC 3 / FR-015).
 */
export async function getParticipantHackathonHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const viewer = await resolveAuthenticatedParticipant(req);
    if (!viewer) {
      res.status(401).json({
        error: 'Authentication required to inspect participant hackathon history.',
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

    const viewerCategory = resolveProfileViewerCategory({
      viewerParticipantId: viewer.id,
      viewerRole: viewer.role,
      targetParticipantId: targetParticipant.id,
      isConfirmedTeammate: isTeammate,
    });

    const records = await profileRepository.findHistoryByParticipantId(targetParticipant.id);
    res.status(200).json({
      participantId: targetParticipant.id,
      viewerCategory,
      hackathonCount: records.length,
      isSelfReported: true,
      history: records.map(formatHistoryRecord),
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * POST /api/profiles/me/history and POST /api/profiles/:participantId/history
 * Creates a new hackathon history entry for the authenticated participant (US-007 AC 1 / FR-015).
 */
export async function createHackathonHistoryEntry(
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
        error: 'Only participant accounts can manage hackathon history.',
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }

    const paramParticipantId = req.params.participantId
      ? String(req.params.participantId).trim()
      : undefined;
    if (paramParticipantId && paramParticipantId !== participant.id) {
      res.status(403).json({
        error: 'You can only edit your own hackathon history.',
        code: 'FORBIDDEN_HISTORY_EDIT',
      });
      return;
    }

    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    if (
      (body.participantId !== undefined && body.participantId !== participant.id) ||
      (body.participant_id !== undefined && body.participant_id !== participant.id)
    ) {
      res.status(403).json({
        error: 'You can only edit your own hackathon history.',
        code: 'FORBIDDEN_HISTORY_EDIT',
      });
      return;
    }

    const eventName = String(body.eventName ?? body.event_name ?? '').trim();
    const eventDate = String(body.eventDate ?? body.event_date ?? '').trim();
    const teamRole = String(body.teamRole ?? body.team_role ?? '').trim() as ParticipantPrimaryRole;
    const projectTitle = String(body.projectTitle ?? body.project_title ?? '').trim();
    const projectUrl = String(body.projectUrl ?? body.project_url ?? '').trim();

    if (!eventName || !eventDate || !teamRole || !projectTitle || !projectUrl) {
      res.status(400).json({
        error: 'Missing required hackathon history fields.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const existingRecords = await profileRepository.findHistoryByParticipantId(participant.id);
    const isDuplicate = existingRecords.some(
      (item) =>
        item.event_name.trim().toLowerCase() === eventName.toLowerCase() &&
        item.event_date.slice(0, 10) === eventDate.slice(0, 10) &&
        item.project_title.trim().toLowerCase() === projectTitle.toLowerCase()
    );
    if (isDuplicate) {
      res.status(409).json({
        error: 'A hackathon history record with this event name, date, and project title already exists.',
        code: 'DUPLICATE_HISTORY_RECORD',
      });
      return;
    }

    const created = await profileRepository.createHistoryEntry(participant.id, {
      event_name: eventName,
      event_date: eventDate,
      team_role: teamRole,
      project_title: projectTitle,
      project_url: projectUrl,
    });

    const updated = await profileRepository.findHistoryByParticipantId(participant.id);
    res.status(201).json({
      message: 'Hackathon history record created successfully.',
      entry: formatHistoryRecord(created),
      hackathonCount: updated.length,
      isSelfReported: true,
      history: updated.map(formatHistoryRecord),
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * PUT /api/profiles/me/history/:historyId and PUT /api/profiles/:participantId/history/:historyId
 * Updates an existing hackathon history entry for the authenticated participant (US-007 AC 4 / FR-015).
 */
export async function updateHackathonHistoryEntry(
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
        error: 'Only participant accounts can manage hackathon history.',
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }

    const paramParticipantId = req.params.participantId
      ? String(req.params.participantId).trim()
      : undefined;
    if (paramParticipantId && paramParticipantId !== participant.id) {
      res.status(403).json({
        error: 'You can only edit your own hackathon history.',
        code: 'FORBIDDEN_HISTORY_EDIT',
      });
      return;
    }

    const historyId = String(req.params.historyId || '').trim();
    if (!historyId) {
      res.status(400).json({
        error: 'History record identifier is required.',
        code: 'INVALID_HISTORY_ID',
      });
      return;
    }

    const existingEntry = await profileRepository.findHistoryEntryById(historyId);
    if (!existingEntry) {
      res.status(404).json({
        error: 'Hackathon history record not found.',
        code: 'HISTORY_RECORD_NOT_FOUND',
      });
      return;
    }

    if (existingEntry.participant_id !== participant.id) {
      res.status(403).json({
        error: 'You can only edit your own hackathon history records.',
        code: 'FORBIDDEN_HISTORY_EDIT',
      });
      return;
    }

    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    if (
      (body.participantId !== undefined && body.participantId !== participant.id) ||
      (body.participant_id !== undefined && body.participant_id !== participant.id)
    ) {
      res.status(403).json({
        error: 'You can only edit your own hackathon history.',
        code: 'FORBIDDEN_HISTORY_EDIT',
      });
      return;
    }

    const eventName = String(body.eventName ?? body.event_name ?? existingEntry.event_name).trim();
    const eventDate = String(body.eventDate ?? body.event_date ?? existingEntry.event_date).trim();
    const teamRole = String(
      body.teamRole ?? body.team_role ?? existingEntry.team_role
    ).trim() as ParticipantPrimaryRole;
    const projectTitle = String(
      body.projectTitle ?? body.project_title ?? existingEntry.project_title
    ).trim();
    const projectUrl = String(
      body.projectUrl ?? body.project_url ?? existingEntry.project_url
    ).trim();

    const existingRecords = await profileRepository.findHistoryByParticipantId(participant.id);
    const isDuplicate = existingRecords.some(
      (item) =>
        item.id !== historyId &&
        item.event_name.trim().toLowerCase() === eventName.toLowerCase() &&
        item.event_date.slice(0, 10) === eventDate.slice(0, 10) &&
        item.project_title.trim().toLowerCase() === projectTitle.toLowerCase()
    );
    if (isDuplicate) {
      res.status(409).json({
        error: 'A hackathon history record with this event name, date, and project title already exists.',
        code: 'DUPLICATE_HISTORY_RECORD',
      });
      return;
    }

    const updated = await profileRepository.updateHistoryEntry(participant.id, historyId, {
      event_name: eventName,
      event_date: eventDate,
      team_role: teamRole,
      project_title: projectTitle,
      project_url: projectUrl,
    });

    const allRecords = await profileRepository.findHistoryByParticipantId(participant.id);
    res.status(200).json({
      message: 'Hackathon history record updated successfully.',
      entry: updated ? formatHistoryRecord(updated) : null,
      hackathonCount: allRecords.length,
      isSelfReported: true,
      history: allRecords.map(formatHistoryRecord),
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * DELETE /api/profiles/me/history/:historyId and DELETE /api/profiles/:participantId/history/:historyId
 * Removes an existing hackathon history entry for the authenticated participant (US-007 AC 4 / FR-015).
 */
export async function deleteHackathonHistoryEntry(
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
        error: 'Only participant accounts can manage hackathon history.',
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }

    const paramParticipantId = req.params.participantId
      ? String(req.params.participantId).trim()
      : undefined;
    if (paramParticipantId && paramParticipantId !== participant.id) {
      res.status(403).json({
        error: 'You can only edit your own hackathon history.',
        code: 'FORBIDDEN_HISTORY_EDIT',
      });
      return;
    }

    const historyId = String(req.params.historyId || '').trim();
    if (!historyId) {
      res.status(400).json({
        error: 'History record identifier is required.',
        code: 'INVALID_HISTORY_ID',
      });
      return;
    }

    const existingEntry = await profileRepository.findHistoryEntryById(historyId);
    if (!existingEntry) {
      res.status(404).json({
        error: 'Hackathon history record not found.',
        code: 'HISTORY_RECORD_NOT_FOUND',
      });
      return;
    }

    if (existingEntry.participant_id !== participant.id) {
      res.status(403).json({
        error: 'You can only edit your own hackathon history records.',
        code: 'FORBIDDEN_HISTORY_EDIT',
      });
      return;
    }

    await profileRepository.deleteHistoryEntry(participant.id, historyId);
    const remaining = await profileRepository.findHistoryByParticipantId(participant.id);
    res.status(200).json({
      message: 'Hackathon history record removed.',
      deletedId: historyId,
      hackathonCount: remaining.length,
      isSelfReported: true,
      history: remaining.map(formatHistoryRecord),
    });
  } catch (err: unknown) {
    next(err);
  }
}
