export const DEMO_NAMESPACE = 'hm-demo-v1';
export const PLATFORM_AVAILABILITY_EVENT_ID = '00000000-0000-4000-8000-000000000001';

export type AccountRole = 'ADMIN' | 'PART';
export type PrimaryRole = 'Frontend' | 'Backend' | 'Mobile' | 'AI/ML' | 'UI/UX' | 'Pitch';
export type TeamGoal = 'Learning' | 'Project Completion' | 'Competitive';
export type RecruitmentStatus = 'Open' | 'Locked' | 'Disbanded';
export type RequestType = 'Invitation' | 'Application';
export type RequestStatus = 'Pending' | 'Accepted' | 'Declined' | 'Withdrawn' | 'Expired' | 'Canceled';

export interface AccountManifestEntry {
  key: string;
  uid: string;
  participantId: string;
  emailEnv: string;
  displayName: string;
  role: AccountRole;
  purpose: string;
}

export interface AccountsManifest {
  namespace: string;
  accounts: AccountManifestEntry[];
}

export interface ProfileManifestEntry {
  accountKey: string;
  handle: string;
  primaryRole: PrimaryRole;
  institution: string | null;
  sharedContactHandle: string | null;
  skills: Array<{ id: string; name: string }>;
  portfolios: Array<{ id: string; url: string; label: string | null }>;
}

export interface ProfilesManifest {
  profiles: ProfileManifestEntry[];
}

export interface AvailabilityManifestEntry {
  accountKey: string;
  isLooking: boolean;
  desiredRole: PrimaryRole | null;
  commitmentHours: number | null;
  goal: TeamGoal | null;
}

export interface AvailabilityManifest {
  platformEventId: string;
  availability: AvailabilityManifestEntry[];
}

export interface ShadowEventManifestEntry {
  id: string;
  title: string;
  officialUrl: string;
  startDate: string;
  endDate: string;
  format: string;
  minTeamSize: number;
  maxTeamSize: number;
  status: 'Published';
}

export interface TeamManifestEntry {
  key: string;
  id: string;
  eventId: string;
  ownerAccountKey: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitmentHours: number;
  communicationLink: string | null;
  recruitmentStatus: RecruitmentStatus;
}

export interface MembershipManifestEntry {
  id: string;
  teamKey: string;
  accountKey: string;
  role: 'Owner' | 'Member';
  status: 'Confirmed';
}

export interface VacancyManifestEntry {
  key: string;
  id: string;
  teamKey: string;
  role: PrimaryRole;
  skills: string[];
  status: 'Open' | 'Filled' | 'Removed';
}

export interface RequestManifestEntry {
  id: string;
  teamKey: string;
  vacancyKey: string;
  accountKey: string;
  requestType: RequestType;
  status: RequestStatus;
  expiresInHours: number | null;
  message: string | null;
}

export interface NotificationManifestEntry {
  id: string;
  accountKey: string;
  teamKey: string;
  type: string;
  message: string;
}

export interface RecruitmentManifest {
  scenario: string;
  shadowEvents: ShadowEventManifestEntry[];
  teams: TeamManifestEntry[];
  memberships: MembershipManifestEntry[];
  vacancies: VacancyManifestEntry[];
  requests: RequestManifestEntry[];
  notifications: NotificationManifestEntry[];
}

export interface DemoManifests {
  accounts: AccountsManifest;
  profiles: ProfilesManifest;
  availability: AvailabilityManifest;
  recruitment: RecruitmentManifest;
}

export interface ResolvedAccount extends AccountManifestEntry {
  email: string;
}

export interface RuntimeEnvironment {
  namespace: string;
  firebaseProjectId: string;
  expectedFirebaseProjectId: string;
  supabaseUrl: string;
  supabaseHost: string;
  expectedSupabaseHost: string;
  allowRemote: boolean;
  password?: string;
}

export interface FirebaseUserRecord {
  uid: string;
  email?: string;
  displayName?: string;
  emailVerified: boolean;
  disabled: boolean;
  customClaims?: Record<string, unknown>;
}

export interface FirebaseCreateInput {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  disabled: boolean;
  password: string;
}

export interface FirebaseUpdateInput {
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  password?: string;
}

export interface FirebasePort {
  getByUid(uid: string): Promise<FirebaseUserRecord | null>;
  getByEmail(email: string): Promise<FirebaseUserRecord | null>;
  create(input: FirebaseCreateInput): Promise<FirebaseUserRecord>;
  update(uid: string, input: FirebaseUpdateInput): Promise<FirebaseUserRecord>;
  setClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
  delete(uid: string): Promise<void>;
}

export type DatabaseFilter =
  | { column: string; operator: 'eq'; value: unknown }
  | { column: string; operator: 'ilike'; value: string }
  | { column: string; operator: 'in'; value: readonly unknown[] };

export interface DatabasePort {
  select(table: string, filters?: readonly DatabaseFilter[]): Promise<Array<Record<string, unknown>>>;
  insert(table: string, rows: readonly Record<string, unknown>[]): Promise<void>;
  upsert(table: string, rows: readonly Record<string, unknown>[], onConflict?: string): Promise<void>;
  update(table: string, values: Record<string, unknown>, filters: readonly DatabaseFilter[]): Promise<void>;
  delete(table: string, filters: readonly DatabaseFilter[]): Promise<void>;
}

export type ChangeAction = 'create' | 'update' | 'claims' | 'revoke' | 'unchanged';

export interface ReconciliationPlan {
  accountKey: string;
  actions: ChangeAction[];
  existing: boolean;
}

export interface FirebaseReconciliationResult {
  plans: ReconciliationPlan[];
  newlyCreatedUids: string[];
}

export interface DatabaseReconciliationResult {
  plans: ReconciliationPlan[];
}

export interface VerificationResult {
  ok: boolean;
  issues: string[];
  summary: {
    firebaseAccounts: number;
    databaseAccounts: number;
    profiles: number;
    teams: number;
    memberships: number;
    vacancies: number;
    requests: number;
  };
}

export interface SeedOptions {
  apply: boolean;
  scenario: string;
  rotatePassword: boolean;
}

export interface ResetOptions {
  apply: boolean;
  scenario: string;
  selection: 'scenario-only' | 'all';
  confirm: string;
}

export interface SeedExecutionDependencies {
  firebase: FirebasePort;
  database: DatabasePort;
  now: () => Date;
  writeRuntimeIndex: (content: Record<string, unknown>) => Promise<void>;
  log: (message: string) => void;
}
