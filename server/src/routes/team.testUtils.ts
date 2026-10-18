import type { DecodedIdToken } from 'firebase-admin/auth';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant, Team, TeamMembership, TeamVacancy } from '../db/types.js';

export const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;

export const ownerParticipant: Participant = {
  id: '11111111-1111-4111-8111-111111111111',
  firebase_uid: 'fb-owner-1',
  email: 'owner@example.com',
  full_name: 'Owner Participant',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

export const otherParticipant: Participant = {
  id: '22222222-2222-4222-8222-222222222222',
  firebase_uid: 'fb-other-2',
  email: 'other@example.com',
  full_name: 'Other Participant',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

export const adminParticipant: Participant = {
  id: '33333333-3333-4333-8333-333333333333',
  firebase_uid: 'fb-admin-3',
  email: 'admin@example.com',
  full_name: 'Admin User',
  role: 'ADMIN',
  is_verified: true,
  is_suspended: false,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

export const sampleTeamId = '44444444-4444-4444-8444-444444444444';
export const sampleEventId = '55555555-5555-4555-8555-555555555555';
export const sampleVacancyId = '66666666-6666-4666-8666-666666666666';

export const sampleEventId2 = '77777777-7777-4777-8777-777777777777';
export const sampleTeamId2 = '88888888-8888-4888-8888-888888888888';

export const sampleTeam: Team = {
  id: sampleTeamId,
  event_id: sampleEventId,
  owner_participant_id: ownerParticipant.id,
  name: 'HackMatch Innovators',
  pitch: 'Building accessible pair-programming platforms',
  goal: 'Project Completion',
  commitment_hours: 20.0,
  communication_link: 'https://discord.gg/hackmatch',
  recruitment_status: 'Open',
  disbanded_at: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

export const sampleTeamOther: Team = {
  id: sampleTeamId2,
  event_id: sampleEventId,
  owner_participant_id: otherParticipant.id,
  name: 'Other Team Same Event',
  pitch: 'Pitch for other team',
  goal: 'Learning',
  commitment_hours: 15.0,
  communication_link: null,
  recruitment_status: 'Open',
  disbanded_at: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

export const sampleTeamEvent2: Team = {
  id: '99999999-9999-4999-8999-999999999999',
  event_id: sampleEventId2,
  owner_participant_id: otherParticipant.id,
  name: 'Other Team Different Event',
  pitch: 'Different event team pitch',
  goal: 'Competitive',
  commitment_hours: 30.0,
  communication_link: null,
  recruitment_status: 'Open',
  disbanded_at: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

export const sampleMembership: TeamMembership = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  team_id: sampleTeamId,
  event_id: sampleEventId,
  participant_id: ownerParticipant.id,
  role: 'Owner',
  status: 'Confirmed',
  removal_reason: null,
  joined_at: '2026-10-18T10:00:00.000Z',
  ended_at: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

export const sampleVacancy: TeamVacancy = {
  id: sampleVacancyId,
  team_id: sampleTeamId,
  role: 'Frontend',
  skills: ['React', 'TypeScript'],
  status: 'Open',
  removed_at: null,
  created_at: '2026-10-18T10:05:00.000Z',
  updated_at: '2026-10-18T10:05:00.000Z',
};

export const sampleParts = {
  team: sampleTeam,
  event: { max_team_size: 4 },
  members: [
    {
      participant_id: ownerParticipant.id,
      role: 'Owner' as const,
      joined_at: '2026-10-18T10:00:00.000Z',
      handle: 'owner_lead',
      full_name: 'Owner Participant',
    },
  ],
  vacancies: [sampleVacancy],
};

export const validOwnerDecodedToken = {
  uid: ownerParticipant.firebase_uid,
  email: ownerParticipant.email,
  role: 'PART',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;

export const validOtherDecodedToken = {
  uid: otherParticipant.firebase_uid,
  email: otherParticipant.email,
  role: 'PART',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;

export const validAdminDecodedToken = {
  uid: adminParticipant.firebase_uid,
  email: adminParticipant.email,
  role: 'ADMIN',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;

export const validTokenHeader = 'Bearer valid-owner-token';
export const otherTokenHeader = 'Bearer valid-other-token';
export const adminTokenHeader = 'Bearer valid-admin-token';

export interface OwnerOnlyRoute {
  name: string;
  method: 'get' | 'patch' | 'post' | 'delete';
  path: (teamId: string, extraId?: string) => string;
  validPayload?: Record<string, unknown>;
  expectedStatus: number;
}

export const OWNER_ONLY_ROUTES: OwnerOnlyRoute[] = [
  {
    name: 'GET /api/teams/:teamId',
    method: 'get',
    path: (teamId) => `/api/teams/${teamId}`,
    expectedStatus: 200,
  },
  {
    name: 'PATCH /api/teams/:teamId',
    method: 'patch',
    path: (teamId) => `/api/teams/${teamId}`,
    validPayload: { pitch: 'Updated team pitch' },
    expectedStatus: 200,
  },
  {
    name: 'POST /api/teams/:teamId/vacancies',
    method: 'post',
    path: (teamId) => `/api/teams/${teamId}/vacancies`,
    validPayload: { role: 'Frontend', skills: ['React', 'TypeScript'] },
    expectedStatus: 200,
  },
  {
    name: 'PATCH /api/teams/:teamId/vacancies/:vacancyId',
    method: 'patch',
    path: (teamId, vacancyId) =>
      `/api/teams/${teamId}/vacancies/${vacancyId || sampleVacancyId}`,
    validPayload: { role: 'Backend', skills: ['Node.js'] },
    expectedStatus: 200,
  },
  {
    name: 'DELETE /api/teams/:teamId/vacancies/:vacancyId',
    method: 'delete',
    path: (teamId, vacancyId) =>
      `/api/teams/${teamId}/vacancies/${vacancyId || sampleVacancyId}`,
    expectedStatus: 200,
  },
  {
    name: 'POST /api/teams/:teamId/disband',
    method: 'post',
    path: (teamId) => `/api/teams/${teamId}/disband`,
    expectedStatus: 200,
  },
];
