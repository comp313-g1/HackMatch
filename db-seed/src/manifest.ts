import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AccountManifestEntry,
  AccountsManifest,
  AvailabilityManifest,
  DemoManifests,
  ProfilesManifest,
  RecruitmentManifest,
  ResolvedAccount,
  RuntimeEnvironment,
} from './types.js';
import { DEMO_NAMESPACE, PLATFORM_AVAILABILITY_EVENT_ID } from './types.js';

const MANIFEST_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../manifests'
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const EXPECTED_UIDS = new Set([
  'hm-demo-v1-admin-ops',
  'hm-demo-v1-admin-safety',
  'hm-demo-v1-part-avery',
  'hm-demo-v1-part-blake',
  'hm-demo-v1-part-casey',
  'hm-demo-v1-part-drew',
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ManifestValidationError: ${message}`);
}

function assertUnique(values: readonly string[], label: string): void {
  assert(new Set(values).size === values.length, `${label} values must be unique.`);
}

function assertUuid(value: string, label: string): void {
  assert(UUID_PATTERN.test(value), `${label} must be a valid UUID.`);
}

async function readJson<T>(filename: string): Promise<T> {
  const raw = await readFile(path.join(MANIFEST_DIRECTORY, filename), 'utf8');
  return JSON.parse(raw) as T;
}

export async function loadManifests(scenario: string): Promise<DemoManifests> {
  if (scenario !== 'recruitment-v1') {
    throw new Error(`ManifestValidationError: Unsupported scenario "${scenario}".`);
  }

  const [accounts, profiles, availability, recruitment] = await Promise.all([
    readJson<AccountsManifest>('accounts.json'),
    readJson<ProfilesManifest>('profiles.json'),
    readJson<AvailabilityManifest>('availability.json'),
    readJson<RecruitmentManifest>(`${scenario}.json`),
  ]);
  const manifests = { accounts, profiles, availability, recruitment };
  validateManifests(manifests);
  return manifests;
}

export function validateManifests(manifests: DemoManifests): void {
  const { accounts, profiles, availability, recruitment } = manifests;
  assert(accounts.namespace === DEMO_NAMESPACE, `namespace must be ${DEMO_NAMESPACE}.`);
  assert(accounts.accounts.length === 6, 'accounts.json must define exactly six accounts.');
  assert(accounts.accounts.filter((account) => account.role === 'ADMIN').length === 2, 'exactly two accounts must be ADMIN.');
  assert(accounts.accounts.filter((account) => account.role === 'PART').length === 4, 'exactly four accounts must be PART.');
  assertUnique(accounts.accounts.map((account) => account.key), 'account key');
  assertUnique(accounts.accounts.map((account) => account.uid), 'Firebase UID');
  assertUnique(accounts.accounts.map((account) => account.participantId), 'participant UUID');
  assertUnique(accounts.accounts.map((account) => account.emailEnv), 'email environment variable');
  assert(accounts.accounts.every((account) => EXPECTED_UIDS.has(account.uid)), 'Firebase UIDs must match the six owned deterministic UIDs.');
  for (const account of accounts.accounts) {
    assertUuid(account.participantId, `${account.key}.participantId`);
    assert(account.uid.startsWith(`${DEMO_NAMESPACE}-`), `${account.key}.uid must use the demo namespace.`);
    assert(account.displayName.trim().length > 0, `${account.key}.displayName is required.`);
    assert(/^HACKMATCH_DEMO_[A-Z_]+_EMAIL$/.test(account.emailEnv), `${account.key}.emailEnv is invalid.`);
  }

  const accountByKey = new Map(accounts.accounts.map((account) => [account.key, account]));
  const partKeys = new Set(accounts.accounts.filter((account) => account.role === 'PART').map((account) => account.key));
  assert(profiles.profiles.length === 4, 'profiles.json must define exactly four PART profiles.');
  assertUnique(profiles.profiles.map((profile) => profile.accountKey), 'profile account key');
  assertUnique(profiles.profiles.map((profile) => profile.handle.toLowerCase()), 'profile handle');
  const skillIds = profiles.profiles.flatMap((profile) => profile.skills.map((skill) => skill.id));
  const portfolioIds = profiles.profiles.flatMap((profile) => profile.portfolios.map((portfolio) => portfolio.id));
  assertUnique(skillIds, 'skill UUID');
  assertUnique(portfolioIds, 'portfolio UUID');
  for (const profile of profiles.profiles) {
    assert(partKeys.has(profile.accountKey), `${profile.accountKey} profile must belong to a PART account.`);
    assert(profile.handle.trim().length > 0, `${profile.accountKey}.handle is required.`);
    assert(profile.skills.length > 0, `${profile.accountKey} must have at least one skill.`);
    for (const skill of profile.skills) {
      assertUuid(skill.id, `${profile.accountKey} skill id`);
      assert(skill.name.trim().length > 0, `${profile.accountKey} skill name is required.`);
    }
    for (const portfolio of profile.portfolios) {
      assertUuid(portfolio.id, `${profile.accountKey} portfolio id`);
      assert(portfolio.url.startsWith('https://'), `${profile.accountKey} portfolio must use HTTPS.`);
    }
  }

  assert(availability.platformEventId === PLATFORM_AVAILABILITY_EVENT_ID, 'availability must use the platform pool event ID.');
  assert(availability.availability.length === 4, 'availability.json must define exactly four PART states.');
  assertUnique(availability.availability.map((entry) => entry.accountKey), 'availability account key');
  for (const entry of availability.availability) {
    assert(partKeys.has(entry.accountKey), `${entry.accountKey} availability must belong to a PART account.`);
    assert(entry.commitmentHours === null || (entry.commitmentHours >= 0 && entry.commitmentHours <= 168), `${entry.accountKey} commitment hours must be 0–168.`);
  }

  assert(recruitment.scenario === 'recruitment-v1', 'recruitment manifest scenario must be recruitment-v1.');
  assert(recruitment.shadowEvents.length === 2, 'recruitment-v1 requires two shadow events.');
  assert(recruitment.teams.length === 2, 'recruitment-v1 requires two teams.');
  assertUnique(recruitment.shadowEvents.map((event) => event.id), 'shadow-event UUID');
  assertUnique(recruitment.teams.map((team) => team.id), 'team UUID');
  assertUnique(recruitment.teams.map((team) => team.key), 'team key');
  assertUnique(recruitment.memberships.map((membership) => membership.id), 'membership UUID');
  assertUnique(recruitment.vacancies.map((vacancy) => vacancy.id), 'vacancy UUID');
  assertUnique(recruitment.vacancies.map((vacancy) => vacancy.key), 'vacancy key');
  assertUnique(recruitment.requests.map((request) => request.id), 'request UUID');
  assertUnique(recruitment.notifications.map((notification) => notification.id), 'notification UUID');

  const eventIds = new Set(recruitment.shadowEvents.map((event) => event.id));
  const teamByKey = new Map(recruitment.teams.map((team) => [team.key, team]));
  const vacancyByKey = new Map(recruitment.vacancies.map((vacancy) => [vacancy.key, vacancy]));
  for (const event of recruitment.shadowEvents) {
    assertUuid(event.id, 'shadow-event id');
    assert(event.status === 'Published', `${event.title} must be Published.`);
    assert(event.minTeamSize === 2 && event.maxTeamSize === 4, `${event.title} must use capacity 2–4.`);
    assert(new Date(event.endDate).getTime() > Date.now(), `${event.title} end date must remain in the future.`);
  }
  for (const team of recruitment.teams) {
    assertUuid(team.id, `${team.key}.id`);
    assert(eventIds.has(team.eventId), `${team.key} must reference an owned shadow event.`);
    assert(partKeys.has(team.ownerAccountKey), `${team.key} owner must be a PART account.`);
    assert(team.commitmentHours >= 0 && team.commitmentHours <= 168, `${team.key} commitment hours must be 0–168.`);
  }
  for (const membership of recruitment.memberships) {
    assertUuid(membership.id, 'membership id');
    assert(teamByKey.has(membership.teamKey), `membership references unknown team ${membership.teamKey}.`);
    assert(partKeys.has(membership.accountKey), `membership references unknown PART ${membership.accountKey}.`);
  }
  for (const vacancy of recruitment.vacancies) {
    assertUuid(vacancy.id, `${vacancy.key}.id`);
    assert(teamByKey.has(vacancy.teamKey), `${vacancy.key} references an unknown team.`);
    assert(vacancy.skills.length <= 10, `${vacancy.key} exceeds the ten-skill database limit.`);
  }
  for (const request of recruitment.requests) {
    assertUuid(request.id, 'request id');
    const team = teamByKey.get(request.teamKey);
    const vacancy = vacancyByKey.get(request.vacancyKey);
    assert(Boolean(team && vacancy), 'request references an unknown team or vacancy.');
    assert(vacancy?.teamKey === request.teamKey, 'request vacancy must belong to its team.');
    assert(accountByKey.has(request.accountKey), `request references unknown account ${request.accountKey}.`);
    assert(request.status === 'Pending', 'demo requests must begin Pending.');
    if (request.requestType === 'Invitation') {
      assert(request.expiresInHours === 48, 'invitations must expire exactly 48 hours after creation.');
      assert(request.message === null, 'invitation message must be null in the current model.');
    } else {
      assert(request.expiresInHours === null, 'applications must not have an expiry timestamp.');
      assert(request.message === null || request.message.length <= 250, 'application message must be at most 250 characters.');
    }
  }

  const civic = teamByKey.get('civic-signal');
  const campus = teamByKey.get('campus-compass');
  assert(civic?.recruitmentStatus === 'Open' && civic.ownerAccountKey === 'avery', 'Civic Signal must be Open and owned by Avery.');
  assert(campus?.recruitmentStatus === 'Locked' && campus.ownerAccountKey === 'drew', 'Campus Compass must be Locked and owned by Drew.');
  assert(recruitment.memberships.filter((item) => item.teamKey === 'campus-compass').length === 2, 'Campus Compass must have exactly two confirmed members.');
  assert(recruitment.requests.some((item) => item.requestType === 'Invitation' && item.accountKey === 'blake'), 'Blake pending invitation is required.');
  assert(recruitment.requests.some((item) => item.requestType === 'Application' && item.accountKey === 'casey'), 'Casey pending application is required.');

  const serialized = JSON.stringify(manifests).toLowerCase();
  assert(!serialized.includes('"password"'), 'manifests must not contain passwords.');
  assert(!serialized.includes('mfa_auth_time'), 'manifests must not contain MFA claims.');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveAccounts(
  accounts: AccountsManifest,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): ResolvedAccount[] {
  const resolved = accounts.accounts.map((account) => {
    const raw = env[account.emailEnv];
    if (!raw) throw new Error(`EnvironmentError: Missing ${account.emailEnv}.`);
    const email = normalizeEmail(raw);
    if (!EMAIL_PATTERN.test(email)) {
      throw new Error(`EnvironmentError: ${account.emailEnv} must contain a valid email address.`);
    }
    return { ...account, email };
  });
  const collisions = new Map<string, string[]>();
  for (const account of resolved) {
    const keys = collisions.get(account.email) ?? [];
    keys.push(account.key);
    collisions.set(account.email, keys);
  }
  const duplicate = [...collisions.entries()].find(([, keys]) => keys.length > 1);
  if (duplicate) {
    throw new Error(`EmailCollisionError: Resolved demo emails collide for account keys ${duplicate[1].join(', ')}.`);
  }
  return resolved;
}

function requireEnvironment(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`EnvironmentError: Missing ${key}.`);
  return value;
}

export function validateRuntimeEnvironment(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  requirePassword: boolean
): RuntimeEnvironment {
  const namespace = requireEnvironment(env, 'HACKMATCH_DEMO_NAMESPACE');
  if (namespace !== DEMO_NAMESPACE) {
    throw new Error(`SafetyError: HACKMATCH_DEMO_NAMESPACE must equal ${DEMO_NAMESPACE}.`);
  }
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new Error('SafetyError: demo seed/reset is disabled when NODE_ENV=production.');
  }

  const firebaseProjectId = requireEnvironment(env, 'FIREBASE_PROJECT_ID');
  const expectedFirebaseProjectId = requireEnvironment(env, 'HACKMATCH_DEMO_EXPECTED_FIREBASE_PROJECT_ID');
  if (firebaseProjectId !== expectedFirebaseProjectId) {
    throw new Error('SafetyError: Firebase project does not match HACKMATCH_DEMO_EXPECTED_FIREBASE_PROJECT_ID.');
  }
  requireEnvironment(env, 'FIREBASE_CLIENT_EMAIL');
  requireEnvironment(env, 'FIREBASE_PRIVATE_KEY');

  const supabaseUrl = requireEnvironment(env, 'SUPABASE_URL');
  requireEnvironment(env, 'SUPABASE_SERVICE_ROLE_KEY');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error('EnvironmentError: SUPABASE_URL must be a valid URL.');
  }
  const supabaseHost = parsedUrl.host.toLowerCase();
  const expectedSupabaseHost = requireEnvironment(env, 'HACKMATCH_DEMO_EXPECTED_SUPABASE_HOST').toLowerCase();
  if (supabaseHost !== expectedSupabaseHost) {
    throw new Error('SafetyError: Supabase host does not match HACKMATCH_DEMO_EXPECTED_SUPABASE_HOST.');
  }
  const allowRemote = (env.HACKMATCH_DEMO_ALLOW_REMOTE ?? 'false').trim().toLowerCase() === 'true';
  if (!LOCAL_HOSTS.has(parsedUrl.hostname.toLowerCase()) && !allowRemote) {
    throw new Error('SafetyError: remote Supabase targets require HACKMATCH_DEMO_ALLOW_REMOTE=true.');
  }

  const password = env.HACKMATCH_DEMO_PASSWORD;
  if (requirePassword && !password) {
    throw new Error('EnvironmentError: Missing HACKMATCH_DEMO_PASSWORD for apply mode.');
  }

  return {
    namespace,
    firebaseProjectId,
    expectedFirebaseProjectId,
    supabaseUrl,
    supabaseHost,
    expectedSupabaseHost,
    allowRemote,
    ...(password ? { password } : {}),
  };
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export function manifestOwnedIds(manifests: DemoManifests): Record<string, string[]> {
  return {
    participants: manifests.accounts.accounts.map((item) => item.participantId),
    skills: manifests.profiles.profiles.flatMap((profile) => profile.skills.map((item) => item.id)),
    portfolios: manifests.profiles.profiles.flatMap((profile) => profile.portfolios.map((item) => item.id)),
    events: manifests.recruitment.shadowEvents.map((item) => item.id),
    teams: manifests.recruitment.teams.map((item) => item.id),
    memberships: manifests.recruitment.memberships.map((item) => item.id),
    vacancies: manifests.recruitment.vacancies.map((item) => item.id),
    requests: manifests.recruitment.requests.map((item) => item.id),
    notifications: manifests.recruitment.notifications.map((item) => item.id),
  };
}

export function accountMap(accounts: readonly AccountManifestEntry[]): Map<string, AccountManifestEntry> {
  return new Map(accounts.map((account) => [account.key, account]));
}
