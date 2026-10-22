import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executeSeed, redactSensitiveText } from './cli.js';
import { reconcileDatabaseAccounts } from './databaseAccounts.js';
import { reconcileFirebaseAccounts, decideFirebaseReconciliation } from './firebaseAccounts.js';
import {
  loadManifests,
  manifestOwnedIds,
  normalizeEmail,
  resolveAccounts,
  validateManifests,
  validateRuntimeEnvironment,
} from './manifest.js';
import { cleanupScenario } from './recruitmentGraph.js';
import { selectResetMode } from './reset.js';
import type {
  DatabaseFilter,
  DatabasePort,
  FirebaseCreateInput,
  FirebasePort,
  FirebaseUpdateInput,
  FirebaseUserRecord,
  ResolvedAccount,
} from './types.js';

class FakeFirebase implements FirebasePort {
  readonly users = new Map<string, FirebaseUserRecord>();
  writes = 0;

  async getByUid(uid: string): Promise<FirebaseUserRecord | null> {
    return this.users.get(uid) ?? null;
  }

  async getByEmail(email: string): Promise<FirebaseUserRecord | null> {
    return [...this.users.values()].find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async create(input: FirebaseCreateInput): Promise<FirebaseUserRecord> {
    this.writes++;
    const user: FirebaseUserRecord = { ...input, customClaims: {} };
    this.users.set(input.uid, user);
    return user;
  }

  async update(uid: string, input: FirebaseUpdateInput): Promise<FirebaseUserRecord> {
    this.writes++;
    const existing = this.users.get(uid)!;
    const updated = { ...existing, ...input };
    this.users.set(uid, updated);
    return updated;
  }

  async setClaims(uid: string, claims: Record<string, unknown>): Promise<void> {
    this.writes++;
    const existing = this.users.get(uid)!;
    this.users.set(uid, { ...existing, customClaims: claims });
  }

  async revokeRefreshTokens(): Promise<void> {
    this.writes++;
  }

  async delete(uid: string): Promise<void> {
    this.writes++;
    this.users.delete(uid);
  }
}

class FakeDatabase implements DatabasePort {
  readonly rows = new Map<string, Array<Record<string, unknown>>>();
  writes = 0;

  private matches(row: Record<string, unknown>, filters: readonly DatabaseFilter[]): boolean {
    return filters.every((filter) => {
      const actual = row[filter.column];
      if (filter.operator === 'eq') return actual === filter.value;
      if (filter.operator === 'in') return filter.value.includes(actual);
      return String(actual).toLowerCase() === filter.value.replace(/\\([\\%_])/g, '$1').toLowerCase();
    });
  }

  async select(table: string, filters: readonly DatabaseFilter[] = []): Promise<Array<Record<string, unknown>>> {
    return (this.rows.get(table) ?? []).filter((row) => this.matches(row, filters));
  }

  async insert(table: string, rows: readonly Record<string, unknown>[]): Promise<void> {
    this.writes++;
    this.rows.set(table, [...(this.rows.get(table) ?? []), ...rows.map((row) => ({ ...row }))]);
  }

  async upsert(table: string, rows: readonly Record<string, unknown>[], onConflict = 'id'): Promise<void> {
    this.writes++;
    const columns = onConflict.split(',');
    const existing = [...(this.rows.get(table) ?? [])];
    for (const row of rows) {
      const index = existing.findIndex((candidate) => columns.every((column) => candidate[column] === row[column]));
      if (index >= 0) existing[index] = { ...existing[index], ...row };
      else existing.push({ ...row });
    }
    this.rows.set(table, existing);
  }

  async update(table: string, values: Record<string, unknown>, filters: readonly DatabaseFilter[]): Promise<void> {
    this.writes++;
    this.rows.set(table, (this.rows.get(table) ?? []).map((row) => this.matches(row, filters) ? { ...row, ...values } : row));
  }

  async delete(table: string, filters: readonly DatabaseFilter[]): Promise<void> {
    this.writes++;
    this.rows.set(table, (this.rows.get(table) ?? []).filter((row) => !this.matches(row, filters)));
  }
}

function resolved(account: Partial<ResolvedAccount> = {}): ResolvedAccount {
  return {
    key: 'avery',
    uid: 'hm-demo-v1-part-avery',
    participantId: '10000000-0000-4000-8000-000000000003',
    emailEnv: 'HACKMATCH_DEMO_AVERY_EMAIL',
    email: 'avery+demo@example.test',
    displayName: 'Avery',
    role: 'PART',
    purpose: 'test',
    ...account,
  };
}

function safetyEnvironment(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    HACKMATCH_DEMO_NAMESPACE: 'hm-demo-v1',
    HACKMATCH_DEMO_EXPECTED_FIREBASE_PROJECT_ID: 'hackmatch-demo-test',
    HACKMATCH_DEMO_EXPECTED_SUPABASE_HOST: '127.0.0.1:54321',
    HACKMATCH_DEMO_ALLOW_REMOTE: 'false',
    FIREBASE_PROJECT_ID: 'hackmatch-demo-test',
    FIREBASE_CLIENT_EMAIL: 'firebase-operator@example.test',
    FIREBASE_PRIVATE_KEY: 'test-only-private-key-placeholder',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-placeholder',
    HACKMATCH_DEMO_PASSWORD: 'test-only-password-placeholder',
  };
}

describe('manifest validation and deterministic ownership', () => {
  it('loads the committed scenario and exposes exact deterministic IDs', async () => {
    const manifests = await loadManifests('recruitment-v1');
    validateManifests(manifests);
    const ids = manifestOwnedIds(manifests);
    assert.equal(ids.participants.length, 6);
    assert.equal(ids.teams.length, 2);
    assert.equal(ids.requests.length, 2);
    assert.ok(ids.participants.includes('10000000-0000-4000-8000-000000000003'));
  });

  it('rejects a scenario whose invitation no longer uses the 48-hour rule', async () => {
    const manifests = structuredClone(await loadManifests('recruitment-v1'));
    manifests.recruitment.requests[0]!.expiresInHours = 24;
    assert.throws(() => validateManifests(manifests), /48 hours/);
  });

  it('normalizes email without stripping plus addressing and rejects collisions', async () => {
    assert.equal(normalizeEmail('  Avery+Demo@Example.Test '), 'avery+demo@example.test');
    const manifests = await loadManifests('recruitment-v1');
    const env: Record<string, string> = {};
    for (const account of manifests.accounts.accounts) env[account.emailEnv] = `${account.key}@example.test`;
    env[manifests.accounts.accounts[1]!.emailEnv] = env[manifests.accounts.accounts[0]!.emailEnv]!;
    assert.throws(() => resolveAccounts(manifests.accounts, env), /EmailCollisionError/);
  });
});

describe('environment safety guards', () => {
  it('accepts an exact local target and rejects project/remote mismatches', () => {
    const safe = safetyEnvironment();
    assert.equal(validateRuntimeEnvironment(safe, true).supabaseHost, '127.0.0.1:54321');
    assert.throws(
      () => validateRuntimeEnvironment({ ...safe, FIREBASE_PROJECT_ID: 'production-project' }, true),
      /Firebase project/
    );
    assert.throws(
      () => validateRuntimeEnvironment({
        ...safe,
        SUPABASE_URL: 'https://example.supabase.co',
        HACKMATCH_DEMO_EXPECTED_SUPABASE_HOST: 'example.supabase.co',
      }, true),
      /ALLOW_REMOTE/
    );
  });
});

describe('account collision and reconciliation decisions', () => {
  it('fails when deterministic UID and email resolve to different Firebase users', async () => {
    const firebase = new FakeFirebase();
    firebase.users.set('hm-demo-v1-part-avery', {
      uid: 'hm-demo-v1-part-avery', email: 'old@example.test', emailVerified: true, disabled: false,
    });
    firebase.users.set('someone-else', {
      uid: 'someone-else', email: 'avery+demo@example.test', emailVerified: true, disabled: false,
    });
    await assert.rejects(
      reconcileFirebaseAccounts(firebase, [resolved()], { apply: false, rotatePassword: false }),
      /FirebaseCollisionError/
    );
    assert.equal(firebase.writes, 0);
  });

  it('preserves unrelated claims and requests revocation for a role correction', () => {
    const decision = decideFirebaseReconciliation(
      resolved({ role: 'ADMIN' }),
      {
        uid: 'hm-demo-v1-part-avery',
        email: 'avery+demo@example.test',
        displayName: 'Avery',
        emailVerified: true,
        disabled: false,
        customClaims: { role: 'PART', theme: 'dark' },
      },
      false
    );
    assert.deepEqual(decision.claims, { role: 'ADMIN', theme: 'dark' });
    assert.equal(decision.revoke, true);
  });

  it('rejects a deterministic PostgreSQL UUID owned by different identity data', async () => {
    const database = new FakeDatabase();
    database.rows.set('participants', [{
      id: '10000000-0000-4000-8000-000000000003',
      firebase_uid: 'different-uid',
      email: 'different@example.test',
    }]);
    await assert.rejects(reconcileDatabaseAccounts(database, [resolved()], false), /DatabaseCollisionError/);
    assert.equal(database.writes, 0);
  });
});

describe('CLI safety behavior', () => {
  it('performs no Firebase, database, or runtime writes in check mode', async () => {
    const manifests = await loadManifests('recruitment-v1');
    const env: Record<string, string> = {};
    for (const account of manifests.accounts.accounts) env[account.emailEnv] = `${account.key}+demo@example.test`;
    const accounts = resolveAccounts(manifests.accounts, env);
    const firebase = new FakeFirebase();
    const database = new FakeDatabase();
    let runtimeWrites = 0;
    await executeSeed(
      { apply: false, scenario: 'recruitment-v1', rotatePassword: false },
      {
        firebase,
        database,
        now: () => new Date('2030-01-01T00:00:00.000Z'),
        writeRuntimeIndex: async () => { runtimeWrites++; },
        log: () => undefined,
      },
      manifests,
      accounts
    );
    assert.equal(firebase.writes, 0);
    assert.equal(database.writes, 0);
    assert.equal(runtimeWrites, 0);
  });

  it('can apply the deterministic graph twice without duplicate owned entities', async () => {
    const manifests = await loadManifests('recruitment-v1');
    const env: Record<string, string> = {};
    for (const account of manifests.accounts.accounts) env[account.emailEnv] = `${account.key}+demo@example.test`;
    const accounts = resolveAccounts(manifests.accounts, env);
    const firebase = new FakeFirebase();
    const database = new FakeDatabase();
    const dependencies = {
      firebase,
      database,
      now: () => new Date('2030-01-01T00:00:00.000Z'),
      writeRuntimeIndex: async () => undefined,
      log: () => undefined,
    };
    const options = { apply: true, scenario: 'recruitment-v1', rotatePassword: false } as const;
    await executeSeed(options, dependencies, manifests, accounts, 'test-only-password-placeholder');
    await executeSeed(options, dependencies, manifests, accounts, 'test-only-password-placeholder');
    assert.equal((database.rows.get('participants') ?? []).length, 6);
    assert.equal((database.rows.get('participant_profiles') ?? []).length, 4);
    assert.equal((database.rows.get('teams') ?? []).length, 2);
    assert.equal((database.rows.get('team_requests') ?? []).length, 2);
    assert.equal(firebase.users.size, 6);
  });

  it('requires an unambiguous reset selection', () => {
    assert.equal(selectResetMode({ scenarioOnly: true, all: false }), 'scenario-only');
    assert.equal(selectResetMode({ scenarioOnly: false, all: true }), 'all');
    assert.throws(() => selectResetMode({ scenarioOnly: false, all: false }), /exactly one/);
    assert.throws(() => selectResetMode({ scenarioOnly: true, all: true }), /exactly one/);
  });

  it('scenario cleanup removes exact manifest IDs and preserves unrelated rows', async () => {
    const manifests = await loadManifests('recruitment-v1');
    const database = new FakeDatabase();
    const ownedTeamId = manifests.recruitment.teams[0]!.id;
    const unrelatedTeamId = '90000000-0000-4000-8000-000000000001';
    database.rows.set('teams', [{ id: ownedTeamId }, { id: unrelatedTeamId }]);
    await cleanupScenario(database, manifests, true);
    assert.deepEqual(database.rows.get('teams'), [{ id: unrelatedTeamId }]);
  });

  it('redacts every supplied sensitive value', () => {
    const text = 'email=user@example.test password=secret-value key=service-key';
    const redacted = redactSensitiveText(text, ['user@example.test', 'secret-value', 'service-key']);
    assert.equal(redacted.includes('user@example.test'), false);
    assert.equal(redacted.includes('secret-value'), false);
    assert.equal(redacted.includes('service-key'), false);
    assert.match(redacted, /\[REDACTED\]/);
  });
});
