import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFirebaseAdminAuth } from '../../server/src/config/firebase.js';
import { getSupabaseClient } from '../../server/src/db/client.js';
import { reconcileDatabaseAccounts } from './databaseAccounts.js';
import {
  compensateNewFirebaseUsers,
  reconcileFirebaseAccounts,
} from './firebaseAccounts.js';
import {
  loadManifests,
  manifestOwnedIds,
  maskEmail,
  resolveAccounts,
  validateRuntimeEnvironment,
} from './manifest.js';
import {
  applyFinalAvailability,
  applyProfiles,
  cleanupScenario,
  createRecruitmentGraph,
} from './recruitmentGraph.js';
import { resetDemoData, selectResetMode } from './reset.js';
import type {
  DatabaseFilter,
  DatabasePort,
  FirebasePort,
  FirebaseUserRecord,
  ResetOptions,
  SeedExecutionDependencies,
  SeedOptions,
} from './types.js';
import { DEMO_NAMESPACE } from './types.js';
import { verifyDemoState } from './verify.js';

interface QueryResult {
  data: Array<Record<string, unknown>> | null;
  error: { message?: string; code?: string } | null;
}

interface QueryBuilder {
  select(columns?: string): QueryBuilder;
  insert(rows: readonly Record<string, unknown>[]): QueryBuilder;
  upsert(rows: readonly Record<string, unknown>[], options?: { onConflict?: string }): QueryBuilder;
  update(values: Record<string, unknown>): QueryBuilder;
  delete(): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  ilike(column: string, value: string): QueryBuilder;
  in(column: string, values: readonly unknown[]): QueryBuilder;
}

interface SupabaseLike {
  from(table: string): QueryBuilder;
}

interface FirebaseAuthLike {
  getUser(uid: string): Promise<unknown>;
  getUserByEmail(email: string): Promise<unknown>;
  createUser(input: Record<string, unknown>): Promise<unknown>;
  updateUser(uid: string, input: Record<string, unknown>): Promise<unknown>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
  deleteUser(uid: string): Promise<void>;
}

function firebaseRecord(value: unknown): FirebaseUserRecord {
  const record = value as {
    uid: string;
    email?: string;
    displayName?: string;
    emailVerified?: boolean;
    disabled?: boolean;
    customClaims?: Record<string, unknown>;
  };
  return {
    uid: record.uid,
    email: record.email,
    displayName: record.displayName,
    emailVerified: Boolean(record.emailVerified),
    disabled: Boolean(record.disabled),
    customClaims: record.customClaims,
  };
}

function firebaseErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

export function createFirebasePort(): FirebasePort {
  const auth = getFirebaseAdminAuth() as unknown as FirebaseAuthLike;
  return {
    async getByUid(uid) {
      try {
        return firebaseRecord(await auth.getUser(uid));
      } catch (error) {
        if (firebaseErrorCode(error) === 'auth/user-not-found') return null;
        throw error;
      }
    },
    async getByEmail(email) {
      try {
        return firebaseRecord(await auth.getUserByEmail(email));
      } catch (error) {
        if (firebaseErrorCode(error) === 'auth/user-not-found') return null;
        throw error;
      }
    },
    async create(input) {
      return firebaseRecord(await auth.createUser({ ...input }));
    },
    async update(uid, input) {
      return firebaseRecord(await auth.updateUser(uid, { ...input }));
    },
    setClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
    delete: (uid) => auth.deleteUser(uid),
  };
}

function applyFilters(builder: QueryBuilder, filters: readonly DatabaseFilter[]): QueryBuilder {
  return filters.reduce((query, filter) => {
    if (filter.operator === 'eq') return query.eq(filter.column, filter.value);
    if (filter.operator === 'ilike') return query.ilike(filter.column, filter.value);
    return query.in(filter.column, filter.value);
  }, builder);
}

async function executeQuery(builder: QueryBuilder, table: string): Promise<Array<Record<string, unknown>>> {
  const result = await (builder as unknown as PromiseLike<QueryResult>);
  if (result.error) {
    throw new Error(`DatabaseError(${table}): ${result.error.code ?? 'unknown'} ${result.error.message ?? 'operation failed'}`);
  }
  return result.data ?? [];
}

export function createDatabasePort(): DatabasePort {
  const client = getSupabaseClient() as unknown as SupabaseLike;
  return {
    async select(table, filters = []) {
      return executeQuery(applyFilters(client.from(table).select('*'), filters), table);
    },
    async insert(table, rows) {
      await executeQuery(client.from(table).insert(rows), table);
    },
    async upsert(table, rows, onConflict) {
      await executeQuery(client.from(table).upsert(rows, onConflict ? { onConflict } : undefined), table);
    },
    async update(table, values, filters) {
      await executeQuery(applyFilters(client.from(table).update(values), filters), table);
    },
    async delete(table, filters) {
      if (filters.length === 0) throw new Error(`SafetyError: refusing unfiltered delete from ${table}.`);
      await executeQuery(applyFilters(client.from(table).delete(), filters), table);
    },
  };
}

export function redactSensitiveText(value: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce((redacted, secret) => redacted.split(secret).join('[REDACTED]'), value);
}

function summarizePlans(label: string, plans: Array<{ accountKey: string; actions: string[] }>): string {
  return `${label}: ${plans.map((plan) => `${plan.accountKey}=${plan.actions.join('+')}`).join(', ')}`;
}

export async function executeSeed(
  options: SeedOptions,
  dependencies: SeedExecutionDependencies,
  manifests: Awaited<ReturnType<typeof loadManifests>>,
  resolvedAccounts: ReturnType<typeof resolveAccounts>,
  password?: string
): Promise<void> {
  const firebaseResult = await reconcileFirebaseAccounts(dependencies.firebase, resolvedAccounts, {
    apply: options.apply,
    rotatePassword: options.rotatePassword,
    password,
  });
  dependencies.log(summarizePlans('Firebase', firebaseResult.plans));

  let databaseResult;
  try {
    databaseResult = await reconcileDatabaseAccounts(dependencies.database, resolvedAccounts, options.apply);
  } catch (error) {
    if (options.apply && firebaseResult.newlyCreatedUids.length > 0) {
      await compensateNewFirebaseUsers(dependencies.firebase, firebaseResult.newlyCreatedUids);
    }
    throw error;
  }
  dependencies.log(summarizePlans('PostgreSQL', databaseResult.plans));

  if (!options.apply) {
    const cleanup = await cleanupScenario(dependencies.database, manifests, false);
    const verification = await verifyDemoState(
      dependencies.firebase,
      dependencies.database,
      manifests,
      resolvedAccounts,
      dependencies.now()
    );
    dependencies.log(`Read-only check: ${Object.values(cleanup.tableCounts).reduce((total, count) => total + count, 0)} manifest-owned scenario rows currently exist.`);
    dependencies.log(verification.ok ? 'Current state already matches recruitment-v1.' : `Current state has ${verification.issues.length} expected difference(s); --apply would reconcile them.`);
    return;
  }

  const now = dependencies.now();
  await cleanupScenario(dependencies.database, manifests, true);
  await createRecruitmentGraph(dependencies.database, manifests, resolvedAccounts, true, now);
  await applyProfiles(dependencies.database, manifests, resolvedAccounts, true);
  await applyFinalAvailability(dependencies.database, manifests, resolvedAccounts, true);
  // Reapply final LFT values after all membership-triggering writes. This intentionally
  // leaves Blake enabled despite confirmed membership on a different team.
  await applyFinalAvailability(dependencies.database, manifests, resolvedAccounts, true);

  const verification = await verifyDemoState(
    dependencies.firebase,
    dependencies.database,
    manifests,
    resolvedAccounts,
    now
  );
  if (!verification.ok) {
    throw new Error(`SeedVerificationError: ${verification.issues.join(' ')}`);
  }

  await dependencies.writeRuntimeIndex({
    namespace: DEMO_NAMESPACE,
    scenario: options.scenario,
    generatedAt: now.toISOString(),
    accounts: resolvedAccounts.map((account) => ({
      key: account.key,
      maskedEmail: maskEmail(account.email),
      participantId: account.participantId,
      firebaseUid: account.uid,
    })),
    ids: manifestOwnedIds(manifests),
  });
  dependencies.log(`Applied and verified ${verification.summary.firebaseAccounts} Firebase accounts, ${verification.summary.databaseAccounts} PostgreSQL accounts, ${verification.summary.teams} teams, and ${verification.summary.requests} pending requests.`);
}

interface ParsedArguments {
  command: 'seed' | 'reset';
  values: Map<string, string | true>;
}

export function parseArguments(args: readonly string[]): ParsedArguments {
  const command = args[0] === 'reset' ? 'reset' : 'seed';
  const start = args[0] === 'seed' || args[0] === 'reset' ? 1 : 0;
  const values = new Map<string, string | true>();
  for (let index = start; index < args.length; index++) {
    const argument = args[index]!;
    if (!argument.startsWith('--')) throw new Error(`CLIError: unexpected argument ${argument}.`);
    const key = argument.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, next);
      index++;
    } else {
      values.set(key, true);
    }
  }
  return { command, values };
}

function flag(values: Map<string, string | true>, key: string): boolean {
  return values.get(key) === true;
}

function value(values: Map<string, string | true>, key: string, fallback = ''): string {
  const found = values.get(key);
  return typeof found === 'string' ? found : fallback;
}

function runtimeWriter(): (content: Record<string, unknown>) => Promise<void> {
  const runtimeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.runtime');
  return async (content) => {
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      path.join(runtimeDirectory, 'recruitment-v1.index.json'),
      `${JSON.stringify(content, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
  };
}

export async function runCli(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseArguments(args);
  const scenario = value(parsed.values, 'scenario', 'recruitment-v1');
  const apply = flag(parsed.values, 'apply');
  const check = flag(parsed.values, 'check');
  const rotatePassword = flag(parsed.values, 'rotate-password');

  if (parsed.command === 'seed' && apply === check) {
    throw new Error('CLIError: choose exactly one of --check or --apply.');
  }
  if (parsed.command === 'reset' && check) {
    throw new Error('CLIError: reset does not support --check; omit --apply to make no changes.');
  }

  validateRuntimeEnvironment(process.env, parsed.command === 'seed' && (apply || rotatePassword));
  const manifests = await loadManifests(scenario);
  const accounts = resolveAccounts(manifests.accounts, process.env);
  const firebase = createFirebasePort();
  const database = createDatabasePort();
  const dependencies: SeedExecutionDependencies = {
    firebase,
    database,
    now: () => new Date(),
    writeRuntimeIndex: runtimeWriter(),
    log: (message) => console.log(`[demo-data] ${message}`),
  };

  if (parsed.command === 'seed') {
    await executeSeed(
      { apply, scenario, rotatePassword },
      dependencies,
      manifests,
      accounts,
      process.env.HACKMATCH_DEMO_PASSWORD
    );
    return;
  }

  const selection = selectResetMode({
    scenarioOnly: flag(parsed.values, 'scenario-only'),
    all: flag(parsed.values, 'all'),
  });
  const resetOptions: ResetOptions = {
    apply,
    scenario,
    selection,
    confirm: value(parsed.values, 'confirm'),
  };
  await resetDemoData(firebase, database, manifests, accounts, resetOptions);
  console.log(`[demo-data] Reset completed for ${selection}.`);
}

const isDirectExecution = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  runCli().catch((error) => {
    const secrets = [
      process.env.HACKMATCH_DEMO_PASSWORD ?? '',
      process.env.FIREBASE_PRIVATE_KEY ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      ...Object.entries(process.env)
        .filter(([key]) => /^HACKMATCH_DEMO_.+_EMAIL$/.test(key))
        .map(([, secret]) => secret ?? ''),
    ];
    console.error(`[demo-data] ${redactSensitiveText((error as Error).message, secrets)}`);
    process.exitCode = 1;
  });
}
