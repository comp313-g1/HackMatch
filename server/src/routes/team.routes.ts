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
import { validateOpenTeamsQuery } from '../validators/openTeams.validator.js';
import {
  createTeamHandler,
  getMyTeamHandler,
  getTeamHandler,
  updateTeamHandler,
  addVacancyHandler,
  updateVacancyHandler,
  removeVacancyHandler,
  disbandTeamHandler,
  removeMemberHandler,
  listOpenTeamsHandler,
} from '../controllers/team.controller.js';

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
teamRouter.patch('/:teamId', ...participantAuth, validateTeamIdParams, requireTeamOwner, requireJsonObjectBody, validateUpdateTeamBody, updateTeamHandler);
teamRouter.post('/:teamId/vacancies', ...participantAuth, validateTeamIdParams, requireTeamOwner, requireJsonObjectBody, validateVacancyBody, addVacancyHandler);
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

