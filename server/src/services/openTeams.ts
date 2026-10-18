import type { TeamGoal, ParticipantPrimaryRole, TeamMembershipRole } from '../db/types.js';
import { teamsRepository, type ITeamsRepository, type OpenTeamRecord } from '../db/teams.repository.js';
import { deriveTeamLifecycle } from './teamLifecycle.js';
import type { OpenTeamsQuery } from '../validators/openTeams.validator.js';

export type OpenTeamsViewer = { category: 'PART'; participantId: string };

export interface OpenTeamPartCard {
  id: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  confirmedMembers: number;
  openSlots: number;
  isViewerMember: boolean;
  members: Array<{ displayName: string; role: TeamMembershipRole }>;
  vacancies: Array<{ id: string; role: ParticipantPrimaryRole; skills: string[] }>;
  createdAt: string;
}

export interface OpenTeamsDeps {
  repo: Pick<ITeamsRepository, 'findOpenTeamRecords'>;
}

export const OPEN_TEAMS_RESPONSE_CAP = 50;

/**
 * Pure filter function for open team records.
 * Keeps a record iff:
 * 1. deriveTeamLifecycle(r.team, r.event, now).mutable is true
 * 2. r.openVacancies.length >= max(1, q.minSlots)
 * 3. q.goal === null || r.team.goal === q.goal
 * 4. At least one open vacancy satisfies (q.role === null || v.role === q.role)
 *    AND every requested skill in q.skills is present in that vacancy.
 *
 * Results are sorted created_at desc, tie-break id asc without mutating input.
 */
export function filterOpenTeams(
  records: OpenTeamRecord[],
  q: OpenTeamsQuery,
  now: Date = new Date()
): OpenTeamRecord[] {
  const minSlotsRequired = Math.max(1, q.minSlots);

  const matched = records.filter((r) => {
    // 1. Mutability check
    const lifecycle = deriveTeamLifecycle(r.team, r.event, now);
    if (!lifecycle.mutable) {
      return false;
    }

    // 2. Open slots minimum check
    if (r.openVacancies.length < minSlotsRequired) {
      return false;
    }

    // 3. Goal check
    if (q.goal !== null && r.team.goal !== q.goal) {
      return false;
    }

    // 4. Same-vacancy role and skill tags matching
    const hasMatchingVacancy = r.openVacancies.some((v) => {
      if (q.role !== null && v.role !== q.role) {
        return false;
      }

      if (q.skills.length > 0) {
        const storedSkills = v.skills.map((s) => s.trim().toLowerCase());
        const hasAllSkills = q.skills.every((reqSkill) =>
          storedSkills.includes(reqSkill)
        );
        if (!hasAllSkills) {
          return false;
        }
      }

      return true;
    });

    return hasMatchingVacancy;
  });

  return [...matched].sort((a, b) => {
    const timeA = new Date(a.team.created_at).getTime();
    const timeB = new Date(b.team.created_at).getTime();
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return a.team.id.localeCompare(b.team.id);
  });
}

/**
 * Pure projection allow-list for authenticated PART cards.
 */
export function toPartCard(r: OpenTeamRecord, viewerId: string): OpenTeamPartCard {
  const members = r.members.map((m) => {
    const handle = m.handle?.trim();
    const displayName = handle && handle.length > 0 ? handle : (m.full_name?.trim() || 'Participant');
    return {
      displayName,
      role: m.role,
    };
  });

  const isViewerMember = r.members.some((m) => m.participant_id === viewerId);

  return {
    id: r.team.id,
    name: r.team.name,
    pitch: r.team.pitch,
    goal: r.team.goal,
    commitmentHours: Number(r.team.commitment_hours),
    confirmedMembers: r.members.length,
    openSlots: r.openVacancies.length,
    isViewerMember,
    members,
    vacancies: r.openVacancies.map((v) => ({
      id: v.id,
      role: v.role,
      skills: [...v.skills],
    })),
    createdAt: r.team.created_at,
  };
}

/**
 * Main service method to list open teams for PART viewers.
 */
export async function listOpenTeams(
  q: OpenTeamsQuery,
  viewer: OpenTeamsViewer,
  deps: OpenTeamsDeps = { repo: teamsRepository },
  now: Date = new Date()
): Promise<{ viewer: 'PART'; total: number; teams: OpenTeamPartCard[] }> {
  const records = await deps.repo.findOpenTeamRecords({ withMemberIdentities: true });
  const filtered = filterOpenTeams(records, q, now);
  const total = filtered.length;
  const capped = filtered.slice(0, OPEN_TEAMS_RESPONSE_CAP);
  const teams = capped.map((r) => toPartCard(r, viewer.participantId));

  return {
    viewer: 'PART',
    total,
    teams,
  };
}
