import { manifestOwnedIds } from './manifest.js';
import type {
  DatabasePort,
  DemoManifests,
  FirebasePort,
  ResolvedAccount,
  VerificationResult,
} from './types.js';

function indexBy(rows: Array<Record<string, unknown>>, column: string): Map<string, Record<string, unknown>> {
  return new Map(rows.map((row) => [String(row[column]), row]));
}

function addCountIssue(issues: string[], label: string, actual: number, expected: number): void {
  if (actual !== expected) issues.push(`${label}: expected ${expected}, found ${actual}.`);
}

export async function verifyDemoState(
  firebase: FirebasePort,
  database: DatabasePort,
  manifests: DemoManifests,
  accounts: readonly ResolvedAccount[],
  now: Date
): Promise<VerificationResult> {
  const issues: string[] = [];
  const ids = manifestOwnedIds(manifests);
  const accountByKey = new Map(accounts.map((account) => [account.key, account]));
  const teamByKey = new Map(manifests.recruitment.teams.map((team) => [team.key, team]));
  const vacancyByKey = new Map(manifests.recruitment.vacancies.map((vacancy) => [vacancy.key, vacancy]));

  const firebaseUsers = await Promise.all(accounts.map((account) => firebase.getByUid(account.uid)));
  addCountIssue(issues, 'Firebase demo accounts', firebaseUsers.filter(Boolean).length, 6);
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index]!;
    const user = firebaseUsers[index];
    if (!user) continue;
    if (user.email?.trim().toLowerCase() !== account.email) issues.push(`${account.key}: Firebase email differs from resolved manifest email.`);
    if (!user.emailVerified) issues.push(`${account.key}: Firebase email is not verified.`);
    if (user.disabled) issues.push(`${account.key}: Firebase account is disabled.`);
    if (user.customClaims?.role !== account.role) issues.push(`${account.key}: Firebase role claim does not match ${account.role}.`);
  }

  const [participants, profiles, skills, portfolios, events, teams, memberships, vacancies, requests, notifications, availability] = await Promise.all([
    database.select('participants', [{ column: 'id', operator: 'in', value: ids.participants }]),
    database.select('participant_profiles', [{ column: 'participant_id', operator: 'in', value: ids.participants }]),
    database.select('participant_skills', [{ column: 'id', operator: 'in', value: ids.skills }]),
    database.select('participant_portfolios', [{ column: 'id', operator: 'in', value: ids.portfolios }]),
    database.select('events', [{ column: 'id', operator: 'in', value: ids.events }]),
    database.select('teams', [{ column: 'id', operator: 'in', value: ids.teams }]),
    database.select('team_memberships', [{ column: 'id', operator: 'in', value: ids.memberships }]),
    database.select('team_vacancies', [{ column: 'id', operator: 'in', value: ids.vacancies }]),
    database.select('team_requests', [{ column: 'id', operator: 'in', value: ids.requests }]),
    database.select('participant_notifications', [{ column: 'id', operator: 'in', value: ids.notifications }]),
    database.select('event_availability', [
      { column: 'participant_id', operator: 'in', value: ids.participants },
      { column: 'event_id', operator: 'eq', value: manifests.availability.platformEventId },
    ]),
  ]);

  addCountIssue(issues, 'PostgreSQL demo participants', participants.length, 6);
  addCountIssue(issues, 'PART profiles', profiles.length, 4);
  addCountIssue(issues, 'skills', skills.length, ids.skills.length);
  addCountIssue(issues, 'portfolios', portfolios.length, ids.portfolios.length);
  addCountIssue(issues, 'shadow events', events.length, ids.events.length);
  addCountIssue(issues, 'teams', teams.length, ids.teams.length);
  addCountIssue(issues, 'memberships', memberships.length, ids.memberships.length);
  addCountIssue(issues, 'vacancies', vacancies.length, ids.vacancies.length);
  addCountIssue(issues, 'requests', requests.length, ids.requests.length);
  addCountIssue(issues, 'notifications', notifications.length, ids.notifications.length);
  addCountIssue(issues, 'platform availability rows', availability.length, 4);

  const participantMap = indexBy(participants, 'id');
  for (const account of accounts) {
    const row = participantMap.get(account.participantId);
    if (!row) continue;
    if (row.firebase_uid !== account.uid || String(row.email).toLowerCase() !== account.email) issues.push(`${account.key}: PostgreSQL identity differs from Firebase identity.`);
    if (row.role !== account.role) issues.push(`${account.key}: PostgreSQL role differs from ${account.role}.`);
    if (row.is_verified !== true || row.is_suspended !== false || row.is_deactivated === true) issues.push(`${account.key}: PostgreSQL account is not verified and active.`);
  }
  const adminIds = new Set(accounts.filter((account) => account.role === 'ADMIN').map((account) => account.participantId));
  if (profiles.some((profile) => adminIds.has(String(profile.participant_id)))) {
    issues.push('ADMIN accounts must not have participant profile rows.');
  }
  addCountIssue(issues, 'owned ADMIN rows', participants.filter((row) => row.role === 'ADMIN').length, 2);
  addCountIssue(issues, 'owned PART rows', participants.filter((row) => row.role === 'PART').length, 4);

  const eventMap = indexBy(events, 'id');
  for (const event of manifests.recruitment.shadowEvents) {
    const row = eventMap.get(event.id);
    if (row && (row.status !== 'Published' || Number(row.max_team_size) !== 4 || Number(row.min_team_size) !== 2)) {
      issues.push(`${event.title}: shadow event must be Published with capacity 2–4.`);
    }
  }

  const teamMap = indexBy(teams, 'id');
  for (const team of manifests.recruitment.teams) {
    const row = teamMap.get(team.id);
    if (!row) continue;
    const owner = accountByKey.get(team.ownerAccountKey)!;
    if (row.owner_participant_id !== owner.participantId) issues.push(`${team.name}: owner is incorrect.`);
    if (row.recruitment_status !== team.recruitmentStatus) issues.push(`${team.name}: recruitment state is incorrect.`);
    if (team.recruitmentStatus === 'Locked' && !row.locked_at) issues.push(`${team.name}: Locked team is missing locked_at.`);
  }

  const membershipMap = indexBy(memberships, 'id');
  for (const membership of manifests.recruitment.memberships) {
    const row = membershipMap.get(membership.id);
    if (!row) continue;
    if (row.team_id !== teamByKey.get(membership.teamKey)!.id || row.participant_id !== accountByKey.get(membership.accountKey)!.participantId || row.role !== membership.role || row.status !== 'Confirmed') {
      issues.push(`${membership.id}: membership does not match the manifest.`);
    }
  }

  const vacancyMap = indexBy(vacancies, 'id');
  for (const vacancy of manifests.recruitment.vacancies) {
    const row = vacancyMap.get(vacancy.id);
    if (row && (row.team_id !== teamByKey.get(vacancy.teamKey)!.id || row.role !== vacancy.role || row.status !== vacancy.status)) {
      issues.push(`${vacancy.key}: vacancy does not match the manifest.`);
    }
  }

  const requestMap = indexBy(requests, 'id');
  for (const request of manifests.recruitment.requests) {
    const row = requestMap.get(request.id);
    if (!row) continue;
    const expectedParticipant = accountByKey.get(request.accountKey)!.participantId;
    const expectedTeam = teamByKey.get(request.teamKey)!.id;
    const expectedVacancy = vacancyByKey.get(request.vacancyKey)!.id;
    if (row.participant_id !== expectedParticipant || row.team_id !== expectedTeam || row.vacancy_id !== expectedVacancy || row.request_type !== request.requestType || row.status !== 'Pending') {
      issues.push(`${request.id}: request does not match the manifest.`);
    }
    if (request.requestType === 'Invitation') {
      const expiry = new Date(String(row.expires_at)).getTime();
      if (!Number.isFinite(expiry) || expiry <= now.getTime()) issues.push('Civic Signal invitation is expired or missing expiry.');
      const created = new Date(String(row.created_at)).getTime();
      if (Number.isFinite(created) && Math.abs(expiry - created - 48 * 60 * 60 * 1000) > 1000) issues.push('Civic Signal invitation does not use the 48-hour expiry rule.');
    } else if (row.expires_at != null) {
      issues.push('Casey application must not have an expiry timestamp.');
    }
  }

  const availabilityMap = indexBy(availability, 'participant_id');
  for (const expected of manifests.availability.availability) {
    const account = accountByKey.get(expected.accountKey)!;
    const row = availabilityMap.get(account.participantId);
    if (!row || row.is_looking !== expected.isLooking || row.desired_role !== expected.desiredRole || Number(row.commitment_hours) !== expected.commitmentHours || row.goal !== expected.goal) {
      issues.push(`${expected.accountKey}: final Looking-for-Team state or preferences are incorrect.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      firebaseAccounts: firebaseUsers.filter(Boolean).length,
      databaseAccounts: participants.length,
      profiles: profiles.length,
      teams: teams.length,
      memberships: memberships.length,
      vacancies: vacancies.length,
      requests: requests.length,
    },
  };
}
