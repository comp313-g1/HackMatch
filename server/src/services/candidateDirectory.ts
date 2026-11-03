import type {
  ExperienceBadge,
  ParticipantPrimaryRole,
  TeamGoal,
} from '../db/types.js';
import { teamsRepository, type ITeamsRepository } from '../db/teams.repository.js';
import { participantsRepository, type IParticipantRepository } from '../db/participants.repository.js';
import { profileRepository, type IProfileRepository } from '../db/profile.repository.js';
import { availabilityRepository, type IAvailabilityRepository } from '../repositories/availability.repository.js';
import {
  listAvailableCandidates,
  isLookingForTeamProfileComplete,
  type AvailableCandidateCard,
} from './availability.service.js';
import {
  partitionRecommendationCandidates,
  type RecommendationEligibilityContext,
  type RecommendationExclusionSummary,
} from './recommendationEligibility.js';
import {
  projectProfileForViewer,
  type PermittedCandidateProfileView,
  type ProjectedHackathonHistoryEntry,
  SELF_REPORTED_HISTORY_NOTICE,
} from './profilePrivacy.js';
import { deriveTeamLifecycle } from './teamLifecycle.js';
import { TeamServiceError } from './teamErrors.js';

export type SkillMatchMode = 'AND' | 'OR';

export interface CandidateDirectoryFilters {
  skills?: string[];
  skillMatchMode?: SkillMatchMode;
  role?: ParticipantPrimaryRole | null;
  desiredRole?: ParticipantPrimaryRole | null;
  minHours?: number | null;
  maxHours?: number | null;
  badge?: ExperienceBadge | null;
  goal?: TeamGoal | null;
  search?: string | null;
}

export interface DirectoryCandidateCard {
  participantId: string;
  displayName: string;
  handle: string | null;
  institution: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  desiredRole: ParticipantPrimaryRole | null;
  commitmentHours: number | null;
  goal: TeamGoal | null;
  skills: string[];
  matchedSkills: string[];
  skillsSelfDeclared: true;
  portfolioLinks: Array<{ url: string; label: string | null; isSelfDeclared: true }>;
  selfDeclaredNotice: string;
  hackathonCount: number;
  experienceBadge: ExperienceBadge;
  experienceBadgeSelfReported: true;
  selfReportedNotice: string;
  hackathonHistory: ProjectedHackathonHistoryEntry[];
  updatedAt: string | null;
}

export interface CandidateDirectoryResult {
  teamId: string;
  eventId: string;
  filters: {
    skills: string[];
    skillMatchMode: SkillMatchMode;
    role: ParticipantPrimaryRole | null;
    desiredRole: ParticipantPrimaryRole | null;
    minHours: number | null;
    maxHours: number | null;
    badge: ExperienceBadge | null;
    goal: TeamGoal | null;
    search: string | null;
  };
  candidates: DirectoryCandidateCard[];
  totalEligible: number;
  totalMatched: number;
  empty: boolean;
  message: string | null;
  exclusions: RecommendationExclusionSummary;
}

export interface CandidateDirectoryDeps {
  teamsRepo: Pick<
    ITeamsRepository,
    'getTeamViewParts' | 'listConfirmedParticipantIdsForTeam'
  > & {
    listConfirmedParticipantIdsForEvent?: (eventId: string) => Promise<string[]>;
  };
  participantsRepo: Pick<IParticipantRepository, 'findById'>;
  profileRepo: Pick<IProfileRepository, 'getFullProfile'>;
  availabilityRepo: Pick<IAvailabilityRepository, 'findAllActiveLooking'>;
  listAvailableCandidates: () => Promise<AvailableCandidateCard[]>;
  now?: () => Date;
}

export const defaultCandidateDirectoryDeps: CandidateDirectoryDeps = {
  teamsRepo: teamsRepository,
  participantsRepo: participantsRepository,
  profileRepo: profileRepository,
  availabilityRepo: availabilityRepository,
  listAvailableCandidates: () => listAvailableCandidates(),
  now: () => new Date(),
};

/**
 * Filters and ranks directory candidates based on provided filters.
 */
export function filterDirectoryCandidates(
  candidates: DirectoryCandidateCard[],
  filters: {
    skills: string[];
    skillMatchMode: SkillMatchMode;
    role: ParticipantPrimaryRole | null;
    desiredRole: ParticipantPrimaryRole | null;
    minHours: number | null;
    maxHours: number | null;
    badge: ExperienceBadge | null;
    goal: TeamGoal | null;
    search: string | null;
  }
): DirectoryCandidateCard[] {
  const reqSkills = filters.skills.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const matchMode = filters.skillMatchMode || 'AND';
  const searchQ = (filters.search || '').trim().toLowerCase();

  const filtered = candidates
    .map((c) => {
      const candidateSkillsNormalized = c.skills.map((s) => s.trim().toLowerCase());
      const matched = c.skills.filter((s) => reqSkills.includes(s.trim().toLowerCase()));

      let skillMatchPass = true;
      if (reqSkills.length > 0) {
        if (matchMode === 'AND') {
          skillMatchPass = reqSkills.every((rs) => candidateSkillsNormalized.includes(rs));
        } else {
          skillMatchPass = reqSkills.some((rs) => candidateSkillsNormalized.includes(rs));
        }
      }

      if (!skillMatchPass) return null;

      if (filters.role && c.primaryRole !== filters.role) {
        return null;
      }

      if (filters.desiredRole && c.desiredRole !== filters.desiredRole) {
        return null;
      }

      if (filters.goal && c.goal !== filters.goal) {
        return null;
      }

      if (filters.badge && c.experienceBadge !== filters.badge) {
        return null;
      }

      if (filters.minHours !== null && filters.minHours !== undefined) {
        if (typeof c.commitmentHours !== 'number' || c.commitmentHours < filters.minHours) {
          return null;
        }
      }

      if (filters.maxHours !== null && filters.maxHours !== undefined) {
        if (typeof c.commitmentHours !== 'number' || c.commitmentHours > filters.maxHours) {
          return null;
        }
      }

      if (searchQ.length > 0) {
        const matchesHandle = (c.handle || '').toLowerCase().includes(searchQ);
        const matchesName = c.displayName.toLowerCase().includes(searchQ);
        if (!matchesHandle && !matchesName) {
          return null;
        }
      }

      return {
        ...c,
        matchedSkills: matched,
      };
    })
    .filter((c): c is DirectoryCandidateCard => c !== null);

  filtered.sort((a, b) => {
    if (reqSkills.length > 0 && b.matchedSkills.length !== a.matchedSkills.length) {
      return b.matchedSkills.length - a.matchedSkills.length;
    }
    const nameA = (a.handle || a.displayName).toLowerCase();
    const nameB = (b.handle || b.displayName).toLowerCase();
    const cmp = nameA.localeCompare(nameB);
    if (cmp !== 0) return cmp;
    return a.participantId.localeCompare(b.participantId);
  });

  return filtered;
}

/**
 * Collects all confirmed participant IDs for a team and its event (US-014 AC 1, FR-040).
 */
export async function collectConfirmedEventParticipantIds(
  teamId: string,
  eventId: string,
  rosterMemberIds: string[],
  teamsRepo: Pick<ITeamsRepository, 'listConfirmedParticipantIdsForTeam'> & {
    listConfirmedParticipantIdsForEvent?: (eventId: string) => Promise<string[]>;
  }
): Promise<Set<string>> {
  const teamConfirmedIds = await teamsRepo.listConfirmedParticipantIdsForTeam(teamId);
  const eventConfirmedIds = teamsRepo.listConfirmedParticipantIdsForEvent
    ? await teamsRepo.listConfirmedParticipantIdsForEvent(eventId)
    : [];

  return new Set<string>([
    ...rosterMemberIds,
    ...teamConfirmedIds,
    ...eventConfirmedIds,
  ]);
}

/**
 * Searches candidate pool for active team owner, strictly excluding all confirmed event participants.
 */
export async function queryCandidateDirectoryForTeamOwner(
  input: {
    actorParticipantId: string;
    teamId: string;
    filters?: CandidateDirectoryFilters;
  },
  deps: CandidateDirectoryDeps = defaultCandidateDirectoryDeps
): Promise<CandidateDirectoryResult> {
  const { actorParticipantId, teamId, filters } = input;
  const now = deps.now ? deps.now() : new Date();

  const viewParts = await deps.teamsRepo.getTeamViewParts(teamId);
  if (!viewParts || !viewParts.team) {
    throw new TeamServiceError('TEAM_NOT_FOUND');
  }

  // Active team owner gate (FR-040)
  if (viewParts.team.owner_participant_id !== actorParticipantId) {
    throw new TeamServiceError('FORBIDDEN_NOT_TEAM_OWNER');
  }

  // Lifecycle check (Disbanded / Locked / Event concluded)
  const event = {
    status: (viewParts.event?.status ?? 'Published') as 'Published' | 'Archived' | 'Disabled',
    end_date: viewParts.event?.end_date ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const lifecycle = deriveTeamLifecycle(viewParts.team, event, now);
  if (!lifecycle.mutable) {
    if (lifecycle.reason === 'EventNotRecruiting') {
      throw new TeamServiceError('EVENT_NOT_RECRUITING');
    }
    throw new TeamServiceError('TEAM_NOT_MUTABLE', { reason: lifecycle.reason });
  }

  // Collect all confirmed participant IDs for the team & event (US-014 AC 1, FR-040)
  const rosterConfirmedIds = (viewParts.members ?? []).map((m) => m.participant_id);
  const confirmedParticipantIds = await collectConfirmedEventParticipantIds(
    teamId,
    viewParts.team.event_id,
    rosterConfirmedIds,
    deps.teamsRepo
  );

  const eligibilityContext: RecommendationEligibilityContext = {
    teamId,
    eventId: viewParts.team.event_id,
    ownerParticipantId: viewParts.team.owner_participant_id,
    confirmedParticipantIds,
  };

  const pool = await deps.listAvailableCandidates();
  const partitioned = partitionRecommendationCandidates(pool, eligibilityContext);
  const exclusions = { ...partitioned.summary };

  const normalizedFilters = {
    skills: (filters?.skills ?? []).map((s) => s.trim()).filter(Boolean),
    skillMatchMode: filters?.skillMatchMode === 'OR' ? ('OR' as const) : ('AND' as const),
    role: filters?.role ?? null,
    desiredRole: filters?.desiredRole ?? null,
    minHours: typeof filters?.minHours === 'number' ? filters.minHours : null,
    maxHours: typeof filters?.maxHours === 'number' ? filters.maxHours : null,
    badge: filters?.badge ?? null,
    goal: filters?.goal ?? null,
    search: filters?.search ? filters.search.trim() : null,
  };

  const eligibleCards: DirectoryCandidateCard[] = [];
  for (const c of partitioned.eligible) {
    const fullProfile = await deps.profileRepo.getFullProfile(c.participantId);
    if (fullProfile.profile?.moderation_status === 'Hidden') {
      exclusions.unavailable += 1;
      exclusions.totalExcluded += 1;
      continue;
    }
    if (!isLookingForTeamProfileComplete(fullProfile)) {
      exclusions.unavailable += 1;
      exclusions.totalExcluded += 1;
      continue;
    }
    const participant = await deps.participantsRepo.findById(c.participantId);
    if (!participant) {
      exclusions.inactive += 1;
      exclusions.totalExcluded += 1;
      continue;
    }

    const projected = projectProfileForViewer(
      participant,
      fullProfile,
      'PART'
    ) as PermittedCandidateProfileView;

    eligibleCards.push({
      participantId: c.participantId,
      displayName: projected.displayName,
      handle: projected.handle,
      institution: projected.institution,
      primaryRole: projected.primaryRole,
      desiredRole: (c.desiredRole as ParticipantPrimaryRole | null) ?? null,
      commitmentHours: c.commitmentHours,
      goal: (c.goal as TeamGoal | null) ?? null,
      skills: projected.skills,
      matchedSkills: [],
      skillsSelfDeclared: true,
      portfolioLinks: projected.portfolioLinks,
      selfDeclaredNotice: projected.selfDeclaredNotice,
      hackathonCount: projected.hackathonCount,
      experienceBadge: projected.experienceBadge,
      experienceBadgeSelfReported: true,
      selfReportedNotice: SELF_REPORTED_HISTORY_NOTICE,
      hackathonHistory: projected.hackathonHistory,
      updatedAt: c.updatedAt,
    });
  }

  const filteredCards = filterDirectoryCandidates(eligibleCards, normalizedFilters);

  let message: string | null = null;
  if (eligibleCards.length === 0) {
    message =
      'No eligible Looking-for-Team candidates are available for this event. Confirmed event participants and inactive accounts are excluded.';
  } else if (filteredCards.length === 0) {
    message =
      'No eligible candidates match the selected filters. Try broadening your skills, role, hours, or experience badge criteria.';
  }

  return {
    teamId,
    eventId: viewParts.team.event_id,
    filters: normalizedFilters,
    candidates: filteredCards,
    totalEligible: eligibleCards.length,
    totalMatched: filteredCards.length,
    empty: filteredCards.length === 0,
    message,
    exclusions,
  };
}
