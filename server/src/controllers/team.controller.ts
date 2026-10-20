import type { Request, Response, NextFunction } from 'express';
import { createTeam } from '../services/teamCreation.js';
import {
  getOwnerTeamView,
  getMyTeamView,
  getMyTeamsView,
  updateListing,
  addVacancy,
  updateVacancy,
  removeVacancy,
  disbandTeam,
  removeMember,
  leaveTeam,
} from '../services/teamManagement.js';
import { toTeamView } from '../services/teamView.js';
import { teamsRepository, type TeamListingPatch } from '../db/teams.repository.js';
import { toTeamServiceError } from '../services/teamErrors.js';
import { listOpenTeams, type OpenTeamsViewer } from '../services/openTeams.js';
import type { OpenTeamsQuery } from '../validators/openTeams.validator.js';
import type { TeamGoal, ParticipantPrimaryRole } from '../db/types.js';

function handleControllerError(err: unknown, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  const serviceErr = toTeamServiceError(err);
  if (serviceErr) {
    if (serviceErr.code === 'CAPACITY_EXCEEDED' && serviceErr.details) {
      const max = (serviceErr.details.max as number) ?? 4;
      const confirmed = (serviceErr.details.confirmed as number) ?? 0;
      const open = (serviceErr.details.open as number) ?? 0;
      const total = confirmed + open;
      const errorMessage = `This team can have at most ${max} members including open slots. ${confirmed} confirmed + ${open} open = ${total}.`;
      res.status(409).json({
        code: 'CAPACITY_EXCEEDED',
        error: errorMessage,
        errors: {
          vacancies: errorMessage,
        },
        limits: {
          maxTeamSize: max,
          confirmedMembers: confirmed,
          openSlots: open,
        },
      });
      return;
    }

    res.status(serviceErr.status).json({
      error: serviceErr.message,
      code: serviceErr.code,
      ...(serviceErr.details ? { details: serviceErr.details } : {}),
    });
    return;
  }
  next(err);
}

export async function createTeamHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const { eventId, name, pitch, goal, commitmentHours, communicationLink, maxTeamSize } = req.body;

    const { team } = await createTeam({
      ownerParticipantId: actorId,
      ...(eventId ? { eventId: String(eventId) } : {}),
      name: String(name || ''),
      pitch: String(pitch || ''),
      goal: goal as TeamGoal,
      commitmentHours: Number(commitmentHours),
      communicationLink: communicationLink ? String(communicationLink) : null,
      ...(maxTeamSize ? { maxTeamSize: Number(maxTeamSize) } : {}),
    });

    const parts = await teamsRepository.getTeamViewParts(team.id);
    const teamView = toTeamView(parts, { viewerParticipantId: actorId });

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ team: teamView });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function getMyTeamHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const rawEventId = req.query.eventId;

    if (rawEventId && typeof rawEventId === 'string' && rawEventId.trim() !== '') {
      const team = await getMyTeamView(actorId, rawEventId.trim());
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ team });
      return;
    }

    // When eventId is omitted, return all teams the participant belongs to
    const teams = await getMyTeamsView(actorId);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ teams, team: teams[0] || null });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function getTeamHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);

    const team = await getOwnerTeamView(actorId, teamId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ team });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function updateTeamHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);

    const patch: TeamListingPatch = {};
    if (typeof req.body.name === 'string') patch.name = req.body.name;
    if (typeof req.body.pitch === 'string') patch.pitch = req.body.pitch;
    if (typeof req.body.goal === 'string') patch.goal = req.body.goal as TeamGoal;
    if (typeof req.body.commitmentHours === 'number') patch.commitmentHours = req.body.commitmentHours;
    if (req.body.communicationLink !== undefined) {
      patch.communicationLink = req.body.communicationLink === null ? null : String(req.body.communicationLink);
    }

    const team = await updateListing(actorId, teamId, patch);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ team });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function addVacancyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);

    const role = req.body.role as ParticipantPrimaryRole;
    const skills = Array.isArray(req.body.skills) ? (req.body.skills as string[]) : [];

    const team = await addVacancy(actorId, teamId, { role, skills });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ team });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function updateVacancyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);
    const vacancyId = String(req.params.vacancyId);

    const role = req.body.role as ParticipantPrimaryRole;
    const skills = Array.isArray(req.body.skills) ? (req.body.skills as string[]) : [];

    const team = await updateVacancy(actorId, teamId, vacancyId, { role, skills });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ team });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function removeVacancyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);
    const vacancyId = String(req.params.vacancyId);

    const { canceledRequests, team } = await removeVacancy(actorId, teamId, vacancyId);

    const requestText =
      canceledRequests === 1
        ? '1 pending request was canceled.'
        : `${canceledRequests} pending requests were canceled.`;
    const message = `Slot removed. ${requestText}`;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      message,
      canceledRequests,
      team,
    });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function disbandTeamHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);

    const { releasedMembers, canceledRequests } = await disbandTeam(actorId, teamId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      message: 'Team disbanded.',
      releasedMembers,
      canceledRequests,
    });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function removeMemberHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);
    const participantId = String(req.params.participantId);
    const reason = String(req.body.reason);

    const { availabilityRestored, team } = await removeMember(actorId, teamId, participantId, reason);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      message: 'Team member removed.',
      availabilityRestored,
      team,
    });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

/** POST /api/teams/:teamId/leave — US-019 / #183 / FR-059 pre-lock non-owner leave. */
export async function leaveTeamHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);

    const result = await leaveTeam(actorId, teamId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      message: result.notice,
      availabilityRestored: result.availabilityRestored,
      leftParticipantId: result.leftParticipantId,
      teamId,
    });
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}

export async function listOpenTeamsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const query = res.locals.openTeamsQuery as OpenTeamsQuery;
    const viewer: OpenTeamsViewer = req.participant
      ? { category: 'PART', participantId: req.participant.id }
      : { category: 'VISITOR' };
    const result = await listOpenTeams(query, viewer);
    res.status(200).json(result);
  } catch (err: unknown) {
    handleControllerError(err, res, next);
  }
}


