import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireTeamOwner } from '../middleware/requireTeamOwner.js';
import { optionalParticipantAuth } from '../middleware/optionalParticipantAuth.js';
import {
  validateTeamIdParams,
  validateMyTeamQuery,
  requireJsonObjectBody,
  validateCreateTeamBody,
  validateUpdateTeamBody,
  validateVacancyBody,
  validateRemovalReasonBody,
} from '../validators/team.validator.js';
import { validateIssueInvitationBody } from '../validators/invitation.validator.js';
import { validateOpenTeamsQuery } from '../validators/openTeams.validator.js';
import {
  createTeamHandler,
  getMyTeamHandler,
  getTeamHandler,
  validateLockHandler,
  lockTeamHandler,
  updateTeamHandler,
  addVacancyHandler,
  updateVacancyHandler,
  removeVacancyHandler,
  disbandTeamHandler,
  removeMemberHandler,
  leaveTeamHandler,
  listOpenTeamsHandler,
} from '../controllers/team.controller.js';
import { getVacancyRecommendationsHandler } from '../controllers/recommendations.controller.js';
import { getTeamCandidateDirectoryHandler } from '../controllers/candidateDirectory.controller.js';
import { validateCandidateDirectoryQueryMiddleware } from '../validators/candidateDirectory.validator.js';
import {
  issueInvitationHandler,
  listTeamInvitationsHandler,
} from '../controllers/invitations.controller.js';
import {
  listTeamApplicationsHandler,
  submitApplicationHandler,
} from '../controllers/applications.controller.js';
import { validateSubmitApplicationBody } from '../validators/application.validator.js';
import {
  getTeamWorkspaceHandler,
  listTeamWorkspaceRevisionsHandler,
  saveTeamWorkspaceNoteHandler,
  updateTeamWorkspaceLinksHandler,
} from '../controllers/teamWorkspace.controller.js';
import {
  validateWorkspaceLinksBody,
  validateWorkspaceNoteBody,
} from '../validators/teamWorkspace.validator.js';
import {
  validateManifestExportQueryMiddleware,
  validateManifestVerifyBodyMiddleware,
} from '../validators/teamManifest.validator.js';
import {
  getTeamManifestHandler,
  verifyTeamManifestChecksumHandler,
} from '../controllers/teamManifest.controller.js';

export const teamRouter = Router();

const participantAuth = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

teamRouter.get('/', optionalParticipantAuth, validateOpenTeamsQuery, listOpenTeamsHandler);
teamRouter.post('/', ...participantAuth, requireJsonObjectBody, validateCreateTeamBody, createTeamHandler);
teamRouter.get('/mine', ...participantAuth, validateMyTeamQuery, getMyTeamHandler);
teamRouter.get('/:teamId', ...participantAuth, validateTeamIdParams, requireTeamOwner, getTeamHandler);
/** US-022 / #207 / FR-066 — owner-only roster lock validation (non-mutating). */
teamRouter.get(
  '/:teamId/lock/validate',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  validateLockHandler
);
/** US-022 / #208 / FR-066 — atomic owner roster lock (serializes with join/leave). */
teamRouter.post(
  '/:teamId/lock',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  lockTeamHandler
);
/** US-023 / #US-023-T2 / FR-068 — member-only private coordination workspace for locked teams. */
teamRouter.get(
  '/:teamId/workspace',
  ...participantAuth,
  validateTeamIdParams,
  getTeamWorkspaceHandler
);
/** US-023 / #US-023-T3 / FR-069 — owner-only external HTTPS links update. */
teamRouter.put(
  '/:teamId/workspace/links',
  ...participantAuth,
  validateTeamIdParams,
  requireJsonObjectBody,
  validateWorkspaceLinksBody,
  updateTeamWorkspaceLinksHandler
);
/** US-023 / #US-023-T4 / FR-070 — collaborative team note save with optimistic locking. */
teamRouter.put(
  '/:teamId/workspace/note',
  ...participantAuth,
  validateTeamIdParams,
  requireJsonObjectBody,
  validateWorkspaceNoteBody,
  saveTeamWorkspaceNoteHandler
);
/** US-023 / #US-023-T4 / FR-070 — inspect team note revision history. */
teamRouter.get(
  '/:teamId/workspace/revisions',
  ...participantAuth,
  validateTeamIdParams,
  listTeamWorkspaceRevisionsHandler
);
teamRouter.patch('/:teamId', ...participantAuth, validateTeamIdParams, requireTeamOwner, requireJsonObjectBody, validateUpdateTeamBody, updateTeamHandler);
teamRouter.post('/:teamId/vacancies', ...participantAuth, validateTeamIdParams, requireTeamOwner, requireJsonObjectBody, validateVacancyBody, addVacancyHandler);
teamRouter.get(
  '/:teamId/slots/:slotId/recommendations',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  getVacancyRecommendationsHandler
);
teamRouter.get(
  '/:teamId/vacancies/:vacancyId/recommendations',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  getVacancyRecommendationsHandler
);
/** US-014 / FR-040 — active team owner candidate directory search & filter. */
teamRouter.get(
  '/:teamId/candidates',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  validateCandidateDirectoryQueryMiddleware,
  getTeamCandidateDirectoryHandler
);
teamRouter.get(
  '/:teamId/invitations',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  listTeamInvitationsHandler
);
teamRouter.post(
  '/:teamId/invitations',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  requireJsonObjectBody,
  validateIssueInvitationBody,
  issueInvitationHandler
);
teamRouter.post(
  '/:teamId/applications',
  ...participantAuth,
  validateTeamIdParams,
  requireJsonObjectBody,
  validateSubmitApplicationBody,
  submitApplicationHandler
);
teamRouter.get(
  '/:teamId/applications',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  listTeamApplicationsHandler
);
teamRouter.patch('/:teamId/vacancies/:vacancyId', ...participantAuth, validateTeamIdParams, requireTeamOwner, requireJsonObjectBody, validateVacancyBody, updateVacancyHandler);
teamRouter.delete('/:teamId/vacancies/:vacancyId', ...participantAuth, validateTeamIdParams, requireTeamOwner, removeVacancyHandler);
teamRouter.post('/:teamId/disband', ...participantAuth, validateTeamIdParams, requireTeamOwner, disbandTeamHandler);
teamRouter.post(
  '/:teamId/members/:participantId/remove',
  ...participantAuth,
  validateTeamIdParams,
  requireTeamOwner,
  requireJsonObjectBody,
  validateRemovalReasonBody,
  removeMemberHandler
);
/** US-019 / #183 / FR-059 — confirmed non-owner leave (not owner-gated). */
teamRouter.post('/:teamId/leave', ...participantAuth, validateTeamIdParams, leaveTeamHandler);

/** US-024 / #228 / FR-071 — export locked team manifest and check-in verification card. */
teamRouter.get(
  '/:teamId/manifest',
  ...participantAuth,
  validateTeamIdParams,
  validateManifestExportQueryMiddleware,
  getTeamManifestHandler
);

/** US-024 / #228 / FR-072 — verify SHA-256 checksum comparison against stored server snapshot. */
teamRouter.post(
  '/:teamId/manifest/verify',
  ...participantAuth,
  validateTeamIdParams,
  requireJsonObjectBody,
  validateManifestVerifyBodyMiddleware,
  verifyTeamManifestChecksumHandler
);

