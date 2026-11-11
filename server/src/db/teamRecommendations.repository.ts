/**
 * US-016 / #154 — set-based candidate query for participant team recommendations.
 *
 * Legacy event identifiers remain on team records for database compatibility, but this query is
 * intentionally platform-wide. It prefilters membership/request exclusions in PostgreSQL and
 * never returns either relationship to the participant-facing DTO.
 */

import { getSupabaseClient } from './client.js';
import type { ParticipantPrimaryRole, Team, TeamGoal, TeamVacancy } from './types.js';
import type { TeamVacancyCandidate } from '../services/teamRecommendationEligibility.js';

export interface RecommendationTeamRecord
  extends Omit<TeamVacancyCandidate, 'team' | 'vacancy'> {
  team: TeamVacancyCandidate['team'] &
    Pick<Team, 'name' | 'pitch' | 'goal' | 'commitment_hours' | 'created_at'>;
  vacancy: TeamVacancyCandidate['vacancy'] &
    Pick<TeamVacancy, 'role' | 'skills' | 'created_at'>;
}

export interface EligibleTeamVacancyQueryResult {
  candidates: RecommendationTeamRecord[];
  pendingRequestTeamIds: ReadonlySet<string>;
}

export interface ITeamRecommendationsRepository {
  listEligibleTeamVacanciesForParticipant(
    participantId: string
  ): Promise<EligibleTeamVacancyQueryResult>;
}

type TeamRow = {
  id: string;
  owner_participant_id: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitment_hours: number | string;
  recruitment_status: Team['recruitment_status'];
  locked_at: string | null;
  disbanded_at: string | null;
  moderation_hidden_at?: string | null;
  moderation_status?: Team['moderation_status'];
  created_at: string;
  team_memberships?: Array<{ participant_id: string; status: string }>;
};

type VacancyRow = {
  id: string;
  team_id: string;
  role: ParticipantPrimaryRole;
  skills: string[] | null;
  status: TeamVacancy['status'];
  removed_at: string | null;
  created_at: string;
  team: TeamRow | TeamRow[];
};

function idsFrom(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) =>
      row && typeof row === 'object' && 'team_id' in row
        ? String((row as { team_id: unknown }).team_id)
        : ''
    )
    .filter(Boolean);
}

function inFilter(ids: readonly string[]): string {
  // Values originate from UUID foreign keys, not request text. The parentheses are PostgREST's
  // `in` operator syntax.
  return `(${ids.join(',')})`;
}

export const teamRecommendationsRepository: ITeamRecommendationsRepository = {
  async listEligibleTeamVacanciesForParticipant(
    participantId: string
  ): Promise<EligibleTeamVacancyQueryResult> {
    const client = getSupabaseClient();

    // These indexed, participant-scoped lookups establish the two anti-join sets without a query
    // per team. They are independent and therefore intentionally run together.
    const [membershipsResult, requestsResult] = await Promise.all([
      client
        .from('team_memberships')
        .select('team_id')
        .eq('participant_id', participantId)
        .eq('status', 'Confirmed'),
      client
        .from('team_requests')
        .select('team_id')
        .eq('participant_id', participantId)
        .eq('status', 'Pending')
        .in('request_type', ['Application', 'Invitation']),
    ]);

    if (membershipsResult.error) throw membershipsResult.error;
    if (requestsResult.error) throw requestsResult.error;

    const memberTeamIds = idsFrom(membershipsResult.data);
    const pendingRequestTeamIds = new Set(idsFrom(requestsResult.data));
    const excludedTeamIds = [...new Set([...memberTeamIds, ...pendingRequestTeamIds])];

    let query = client
      .from('team_vacancies')
      .select(
        `
          id,
          team_id,
          role,
          skills,
          status,
          removed_at,
          created_at,
          team:teams!inner(
            id,
            owner_participant_id,
            name,
            pitch,
            goal,
            commitment_hours,
            recruitment_status,
            locked_at,
            disbanded_at,
            moderation_hidden_at,
            moderation_status,
            created_at,
            team_memberships(participant_id, status)
          )
        `.replace(/\s+/g, ' ').trim()
      )
      .eq('status', 'Open')
      .is('removed_at', null)
      .eq('team.recruitment_status', 'Open')
      .is('team.locked_at', null)
      .is('team.disbanded_at', null)
      .is('team.moderation_hidden_at', null)
      .neq('team.owner_participant_id', participantId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true });

    // `None` and `Warned` remain discoverable; Hidden is not. The database column is non-null in
    // current migrations, so this filter matches the #153 rule without loading hidden rows.
    query = query.neq('team.moderation_status', 'Hidden');

    if (excludedTeamIds.length > 0) {
      query = query.not('team_id', 'in', inFilter(excludedTeamIds));
    }

    const { data, error } = await query;
    if (error) throw error;

    const candidates: RecommendationTeamRecord[] = [];
    for (const raw of (data ?? []) as unknown as VacancyRow[]) {
      const team = Array.isArray(raw.team) ? raw.team[0] : raw.team;
      if (!team) continue;

      candidates.push({
        team: {
          id: team.id,
          owner_participant_id: team.owner_participant_id,
          name: team.name,
          pitch: team.pitch,
          goal: team.goal,
          commitment_hours: Number(team.commitment_hours),
          recruitment_status: team.recruitment_status,
          locked_at: team.locked_at,
          disbanded_at: team.disbanded_at,
          moderation_hidden_at: team.moderation_hidden_at ?? null,
          moderation_status: team.moderation_status ?? 'None',
          created_at: team.created_at,
        },
        vacancy: {
          id: raw.id,
          team_id: raw.team_id,
          role: raw.role,
          skills: Array.isArray(raw.skills) ? raw.skills : [],
          status: raw.status,
          removed_at: raw.removed_at,
          created_at: raw.created_at,
        },
        confirmedMemberIds: new Set(
          (team.team_memberships ?? [])
            .filter((membership) => membership.status === 'Confirmed')
            .map((membership) => membership.participant_id)
        ),
      });
    }

    return { candidates, pendingRequestTeamIds };
  },
};
