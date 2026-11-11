import { buildTeamChannelDescription, buildTeamChannelTitle } from '../../server/src/db/chatModel.js';
import { manifestOwnedIds } from './manifest.js';
import type { DatabasePort, DemoManifests, ResolvedAccount } from './types.js';

/** Name of the guarded database function that removes the team chat of demo-owned teams (0062). */
export const DEMO_TEAM_CHAT_RESET_FUNCTION = 'demo_remove_team_chat';

function minutesBefore(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

/** A direct-message thread stores its two people in canonical order (low id < high id). */
export function canonicalPair(a: string, b: string): [string, string] {
  const first = a.toLowerCase();
  const second = b.toLowerCase();
  return first < second ? [first, second] : [second, first];
}

function byKey<T extends { key: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.key, item]));
}

function accountByKey(accounts: readonly ResolvedAccount[]): Map<string, ResolvedAccount> {
  return new Map(accounts.map((account) => [account.key, account]));
}

export interface CleanupSummary {
  tableCounts: Record<string, number>;
}

async function deleteExactIds(
  database: DatabasePort,
  table: string,
  column: string,
  ids: readonly string[],
  apply: boolean
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await database.select(table, [{ column, operator: 'in', value: ids }]);
  if (apply && rows.length > 0) {
    await database.delete(table, [{ column, operator: 'in', value: ids }]);
  }
  return rows.length;
}

export async function cleanupScenario(
  database: DatabasePort,
  manifests: DemoManifests,
  apply: boolean
): Promise<CleanupSummary> {
  const ids = manifestOwnedIds(manifests);
  const participantIds = ids.participants;
  const tableCounts: Record<string, number> = {};

  // #437 — direct messages: every message in a seeded thread first, then the thread itself
  // (read cursors and mentions are removed with them).
  tableCounts.direct_messages = await deleteExactIds(database, 'direct_messages', 'thread_id', ids.directMessageThreads, apply);
  tableCounts.direct_message_threads = await deleteExactIds(database, 'direct_message_threads', 'id', ids.directMessageThreads, apply);

  // #437 — team chat. Migration 0052 makes team channels and their messages permanent, so the
  // demo teams' chat is removed through one guarded database function that only accepts demo-owned
  // teams. This must happen before the memberships and teams below are deleted.
  const teamChannels = ids.teams.length === 0
    ? []
    : await database.select('chat_channels', [{ column: 'team_id', operator: 'in', value: ids.teams }]);
  const teamChannelIds = teamChannels.map((row) => String(row.id));
  const teamChatMessages = teamChannelIds.length === 0
    ? []
    : await database.select('chat_messages', [{ column: 'channel_id', operator: 'in', value: teamChannelIds }]);
  tableCounts.chat_channels = teamChannels.length;
  tableCounts.chat_messages = teamChatMessages.length;
  if (apply && teamChannels.length > 0) {
    await database.rpc(DEMO_TEAM_CHAT_RESET_FUNCTION, { p_team_ids: ids.teams });
  }

  tableCounts.participant_notifications = await deleteExactIds(database, 'participant_notifications', 'id', ids.notifications, apply);
  tableCounts.team_requests = await deleteExactIds(database, 'team_requests', 'id', ids.requests, apply);
  tableCounts.team_vacancies = await deleteExactIds(database, 'team_vacancies', 'id', ids.vacancies, apply);
  tableCounts.team_memberships = await deleteExactIds(database, 'team_memberships', 'id', ids.memberships, apply);
  tableCounts.teams = await deleteExactIds(database, 'teams', 'id', ids.teams, apply);
  tableCounts.events = await deleteExactIds(database, 'events', 'id', ids.events, apply);
  tableCounts.participant_portfolios = await deleteExactIds(database, 'participant_portfolios', 'id', ids.portfolios, apply);
  tableCounts.participant_skills = await deleteExactIds(database, 'participant_skills', 'id', ids.skills, apply);
  tableCounts.participant_profiles = await deleteExactIds(database, 'participant_profiles', 'participant_id', participantIds, apply);

  const availabilityFilters = [
    { column: 'participant_id', operator: 'in' as const, value: participantIds },
    { column: 'event_id', operator: 'eq' as const, value: manifests.availability.platformEventId },
  ];
  const availability = await database.select('event_availability', availabilityFilters);
  tableCounts.event_availability = availability.length;
  if (apply && availability.length > 0) {
    await database.delete('event_availability', availabilityFilters);
  }

  return { tableCounts };
}

export async function createRecruitmentGraph(
  database: DatabasePort,
  manifests: DemoManifests,
  accounts: readonly ResolvedAccount[],
  apply: boolean,
  now: Date
): Promise<void> {
  if (!apply) return;
  const accountMap = accountByKey(accounts);
  const teamMap = byKey(manifests.recruitment.teams);
  const vacancyMap = byKey(manifests.recruitment.vacancies);
  const timestamp = now.toISOString();

  await database.insert(
    'events',
    manifests.recruitment.shadowEvents.map((event) => ({
      id: event.id,
      title: event.title,
      official_url: event.officialUrl,
      normalized_url: event.officialUrl.toLowerCase(),
      event_edition: 'Backend compatibility',
      start_date: event.startDate,
      end_date: event.endDate,
      format: event.format,
      location: null,
      min_team_size: event.minTeamSize,
      max_team_size: event.maxTeamSize,
      is_link_disabled: false,
      status: event.status,
    }))
  );

  await database.insert(
    'teams',
    manifests.recruitment.teams.map((team) => ({
      id: team.id,
      event_id: team.eventId,
      owner_participant_id: accountMap.get(team.ownerAccountKey)!.participantId,
      name: team.name,
      pitch: team.pitch,
      goal: team.goal,
      commitment_hours: team.commitmentHours,
      communication_link: team.communicationLink,
      recruitment_status: team.recruitmentStatus,
      locked_at: team.recruitmentStatus === 'Locked' ? timestamp : null,
      disbanded_at: null,
      moderation_hidden_at: null,
      moderation_status: 'None',
      link_removal_notice: null,
    }))
  );

  await database.insert(
    'team_memberships',
    manifests.recruitment.memberships.map((membership) => {
      const team = teamMap.get(membership.teamKey)!;
      const account = accountMap.get(membership.accountKey)!;
      return {
        id: membership.id,
        team_id: team.id,
        event_id: team.eventId,
        participant_id: account.participantId,
        role: membership.role,
        status: membership.status,
        removal_reason: null,
        ended_at: null,
        identity_display_name: account.displayName,
        identity_handle: null,
        identity_email: null,
        identity_pseudonymized_at: null,
      };
    })
  );

  await database.insert(
    'team_vacancies',
    manifests.recruitment.vacancies.map((vacancy) => ({
      id: vacancy.id,
      team_id: teamMap.get(vacancy.teamKey)!.id,
      role: vacancy.role,
      skills: vacancy.skills,
      status: vacancy.status,
      removed_at: null,
    }))
  );

  await database.insert(
    'team_requests',
    manifests.recruitment.requests.map((request) => {
      const team = teamMap.get(request.teamKey)!;
      const expiresAt = request.expiresInHours === null
        ? null
        : new Date(now.getTime() + request.expiresInHours * 60 * 60 * 1000).toISOString();
      return {
        id: request.id,
        team_id: team.id,
        event_id: team.eventId,
        vacancy_id: vacancyMap.get(request.vacancyKey)!.id,
        participant_id: accountMap.get(request.accountKey)!.participantId,
        request_type: request.requestType,
        status: request.status,
        cancel_reason: null,
        resolved_at: null,
        expires_at: expiresAt,
        message: request.message,
        created_at: timestamp,
        updated_at: timestamp,
      };
    })
  );

  await database.insert(
    'participant_notifications',
    manifests.recruitment.notifications.map((notification) => {
      const team = teamMap.get(notification.teamKey)!;
      return {
        id: notification.id,
        participant_id: accountMap.get(notification.accountKey)!.participantId,
        team_id: team.id,
        event_id: team.eventId,
        type: notification.type,
        message: notification.message,
        read_at: null,
        created_at: timestamp,
      };
    })
  );

  await createDemoChat(database, manifests, accountMap, teamMap, now);
}

/**
 * #437 — the private channel of each seeded team with a few messages, and direct-message threads
 * between demo accounts. Runs after the teams and memberships exist, because the database only
 * accepts team-channel messages from confirmed members (0052) and thread messages from the
 * thread's two people (0055). Demo accounts only.
 */
async function createDemoChat(
  database: DatabasePort,
  manifests: DemoManifests,
  accountMap: ReadonlyMap<string, ResolvedAccount>,
  teamMap: ReadonlyMap<string, DemoManifests['recruitment']['teams'][number]>,
  now: Date
): Promise<void> {
  const { teamChannels, teamChannelMessages, directMessageThreads, directMessages } = manifests.recruitment;
  const channelByKey = new Map(teamChannels.map((channel) => [channel.key, channel]));
  const threadByKey = new Map(directMessageThreads.map((thread) => [thread.key, thread]));

  await database.insert(
    'chat_channels',
    teamChannels.map((channel) => {
      const team = teamMap.get(channel.teamKey)!;
      const oldest = Math.max(
        0,
        ...teamChannelMessages.filter((message) => message.channelKey === channel.key).map((message) => message.minutesAgo)
      );
      return {
        id: channel.id,
        title: buildTeamChannelTitle(team.name),
        description: buildTeamChannelDescription(team.id, team.name),
        created_by: accountMap.get(team.ownerAccountKey)!.participantId,
        channel_type: 'team',
        team_id: team.id,
        created_at: minutesBefore(now, oldest + 1),
      };
    })
  );

  // Oldest first, so the rows are written in conversation order.
  await database.insert(
    'chat_messages',
    [...teamChannelMessages]
      .sort((a, b) => b.minutesAgo - a.minutesAgo)
      .map((message) => ({
        id: message.id,
        channel_id: channelByKey.get(message.channelKey)!.id,
        author_id: accountMap.get(message.accountKey)!.participantId,
        body: message.body,
        created_at: minutesBefore(now, message.minutesAgo),
      }))
  );

  await database.insert(
    'direct_message_threads',
    directMessageThreads.map((thread) => {
      const [low, high] = canonicalPair(
        accountMap.get(thread.accountKeys[0])!.participantId,
        accountMap.get(thread.accountKeys[1])!.participantId
      );
      const minutes = directMessages.filter((message) => message.threadKey === thread.key).map((message) => message.minutesAgo);
      return {
        id: thread.id,
        participant_low_id: low,
        participant_high_id: high,
        created_at: minutesBefore(now, Math.max(...minutes) + 1),
        updated_at: minutesBefore(now, Math.min(...minutes)),
        last_message_at: minutesBefore(now, Math.min(...minutes)),
      };
    })
  );

  await database.insert(
    'direct_messages',
    [...directMessages]
      .sort((a, b) => b.minutesAgo - a.minutesAgo)
      .map((message) => ({
        id: message.id,
        thread_id: threadByKey.get(message.threadKey)!.id,
        author_id: accountMap.get(message.accountKey)!.participantId,
        body: message.body,
        created_at: minutesBefore(now, message.minutesAgo),
      }))
  );
}

export async function applyProfiles(
  database: DatabasePort,
  manifests: DemoManifests,
  accounts: readonly ResolvedAccount[],
  apply: boolean
): Promise<void> {
  if (!apply) return;
  const accountMap = accountByKey(accounts);
  await database.upsert(
    'participant_profiles',
    manifests.profiles.profiles.map((profile) => ({
      participant_id: accountMap.get(profile.accountKey)!.participantId,
      handle: profile.handle,
      primary_role: profile.primaryRole,
      institution: profile.institution,
      shared_contact_handle: profile.sharedContactHandle,
      moderation_status: 'None',
    })),
    'participant_id'
  );
  await database.upsert(
    'participant_skills',
    manifests.profiles.profiles.flatMap((profile) =>
      profile.skills.map((skill) => ({
        id: skill.id,
        participant_id: accountMap.get(profile.accountKey)!.participantId,
        skill_name: skill.name,
      }))
    ),
    'id'
  );
  await database.upsert(
    'participant_portfolios',
    manifests.profiles.profiles.flatMap((profile) =>
      profile.portfolios.map((portfolio) => ({
        id: portfolio.id,
        participant_id: accountMap.get(profile.accountKey)!.participantId,
        url: portfolio.url,
        label: portfolio.label,
      }))
    ),
    'id'
  );
}

export async function applyFinalAvailability(
  database: DatabasePort,
  manifests: DemoManifests,
  accounts: readonly ResolvedAccount[],
  apply: boolean
): Promise<void> {
  if (!apply) return;
  const accountMap = accountByKey(accounts);
  await database.upsert(
    'event_availability',
    manifests.availability.availability.map((entry) => ({
      participant_id: accountMap.get(entry.accountKey)!.participantId,
      event_id: manifests.availability.platformEventId,
      is_looking: entry.isLooking,
      desired_role: entry.desiredRole,
      commitment_hours: entry.commitmentHours,
      goal: entry.goal,
    })),
    'participant_id,event_id'
  );
}
