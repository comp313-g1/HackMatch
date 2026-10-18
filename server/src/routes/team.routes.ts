import { Router } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import {
  validateTeamIdParams,
  validateMyTeamQuery,
  requireJsonObjectBody,
  validateCreateTeamBody,
  validateUpdateTeamBody,
  validateVacancyBody,
} from '../validators/team.validator.js';
import {
  createTeamHandler,
  getMyTeamHandler,
  getTeamHandler,
  updateTeamHandler,
  addVacancyHandler,
  updateVacancyHandler,
} from '../controllers/team.controller.js';

export const teamRouter = Router();

const participantAuth = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

teamRouter.post('/', ...participantAuth, requireJsonObjectBody, validateCreateTeamBody, createTeamHandler);
teamRouter.get('/mine', ...participantAuth, validateMyTeamQuery, getMyTeamHandler);
teamRouter.get('/:teamId', ...participantAuth, validateTeamIdParams, getTeamHandler);
teamRouter.patch('/:teamId', ...participantAuth, validateTeamIdParams, requireJsonObjectBody, validateUpdateTeamBody, updateTeamHandler);
teamRouter.post('/:teamId/vacancies', ...participantAuth, validateTeamIdParams, requireJsonObjectBody, validateVacancyBody, addVacancyHandler);
teamRouter.patch('/:teamId/vacancies/:vacancyId', ...participantAuth, validateTeamIdParams, requireJsonObjectBody, validateVacancyBody, updateVacancyHandler);
