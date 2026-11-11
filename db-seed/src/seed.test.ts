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
import { canonicalPair, cleanupScenario } from './recruitmentGraph.js';
import { selectResetMode } from './reset.js';
import { verifyDemoState } from './verify.js';
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

  readonly rpcCalls: string[] = [];

  /** Mirrors migration 0062: removes the team channels (and their messages) of the given teams only. */
  async rpc(name: string, args: Record<string, unknown>): Promise<void> {
    this.writes++;
    this.rpcCalls.push(name);
    if (name !== 'demo_remove_team_chat') throw new Error(`unexpected rpc ${name}`);
    const teamIds = args.p_team_ids as string[];
    const channels = (this.rows.get('chat_channels') ?? []).filter((row) => teamIds.includes(String(row.team_id)));
    const channelIds = channels.map((row) => row.id);
    this.rows.set('chat_messages', (this.rows.get('chat_messages') ?? []).filter((row) => !channelIds.includes(row.channel_id)));
    this.rows.set('chat_channels', (this.rows.get('chat_channels') ?? []).filter((row) => !channelIds.includes(row.id)));
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

describe('seeded team chat and direct messages (#437)', () => {
  const NOW = new Date('2030-01-01T00:00:00.000Z');

  async function setup() {
    const manifests = await loadManifests('recruitment-v1');
    const env: Record<string, string> = {};
    for (const account of manifests.accounts.accounts) env[account.emailEnv] = `${account.key}+demo@example.test`;
    const accounts = resolveAccounts(manifests.accounts, env);
    const firebase = new FakeFirebase();
    const database = new FakeDatabase();
    const dependencies = {
      firebase,
      database,
      now: () => NOW,
      writeRuntimeIndex: async () => undefined,
      log: () => undefined,
    };
    const apply = () => executeSeed(
      { apply: true, scenario: 'recruitment-v1', rotatePassword: false },
      dependencies, manifests, accounts, 'test-only-password-placeholder'
    );
    return { manifests, accounts, firebase, database, dependencies, apply };
  }

  const rowsOf = (database: FakeDatabase, table: string) => database.rows.get(table) ?? [];

  it('the committed manifest has a channel with messages for each team and at least one direct-message thread', async () => {
    const { recruitment } = await loadManifests('recruitment-v1');
    for (const team of recruitment.teams) {
      const channel = recruitment.teamChannels.find((item) => item.teamKey === team.key);
      assert.ok(channel, `${team.key} has a channel`);
      assert.ok(recruitment.teamChannelMessages.filter((m) => m.channelKey === channel.key).length >= 2);
    }
    assert.ok(recruitment.directMessageThreads.length >= 1);
    assert.ok(recruitment.directMessages.length >= 1);
    const ids = manifestOwnedIds({ ...(await loadManifests('recruitment-v1')) });
    assert.equal(ids.teamChannels.length, 2);
    assert.equal(ids.directMessageThreads.length, recruitment.directMessageThreads.length);
  });

  it('apply creates one private team channel per team, written to by confirmed members only', async () => {
    const { manifests, accounts, database, apply } = await setup();
    await apply();

    const channels = rowsOf(database, 'chat_channels');
    assert.equal(channels.length, 2);
    for (const team of manifests.recruitment.teams) {
      const channel = channels.find((row) => row.team_id === team.id);
      assert.ok(channel, `${team.key} channel exists`);
      assert.equal(channel.channel_type, 'team');
      assert.equal(channel.title, `Team: ${team.name}`);
      assert.equal(channel.created_by, accounts.find((a) => a.key === team.ownerAccountKey)!.participantId);
      const members = new Set(
        manifests.recruitment.memberships.filter((m) => m.teamKey === team.key).map((m) => accounts.find((a) => a.key === m.accountKey)!.participantId)
      );
      const messages = rowsOf(database, 'chat_messages').filter((row) => row.channel_id === channel.id);
      assert.ok(messages.length >= 2);
      assert.ok(messages.every((row) => members.has(String(row.author_id))), 'only confirmed members wrote');
    }
  });

  it('apply creates direct-message threads between two demo accounts, in canonical order, with messages only from those two', async () => {
    const { manifests, accounts, database, apply } = await setup();
    await apply();

    const demoParticipants = new Set(accounts.map((a) => a.participantId));
    const threads = rowsOf(database, 'direct_message_threads');
    assert.equal(threads.length, manifests.recruitment.directMessageThreads.length);
    for (const thread of threads) {
      assert.ok(String(thread.participant_low_id) < String(thread.participant_high_id));
      assert.ok(demoParticipants.has(String(thread.participant_low_id)));
      assert.ok(demoParticipants.has(String(thread.participant_high_id)));
      const messages = rowsOf(database, 'direct_messages').filter((row) => row.thread_id === thread.id);
      assert.ok(messages.length >= 1);
      assert.ok(messages.every((row) => [thread.participant_low_id, thread.participant_high_id].includes(row.author_id)));
      const latest = Math.max(...messages.map((row) => new Date(String(row.created_at)).getTime()));
      assert.equal(new Date(String(thread.last_message_at)).getTime(), latest, 'inbox order uses the newest message');
    }
  });

  it('seeded chat only ever involves demo accounts and never contains contact details', async () => {
    const { accounts, database, apply } = await setup();
    await apply();
    const demo = new Set(accounts.map((a) => a.participantId));
    for (const row of [...rowsOf(database, 'chat_messages'), ...rowsOf(database, 'direct_messages')]) {
      assert.ok(demo.has(String(row.author_id)));
      assert.doesNotMatch(String(row.body), /@|https?:\/\/|password|otp/i);
    }
  });

  it('applying twice removes the old team chat first and leaves exactly one copy', async () => {
    const { database, apply } = await setup();
    await apply();
    assert.deepEqual(database.rpcCalls, [], 'nothing to remove on a first run');
    await apply();
    assert.deepEqual(database.rpcCalls, ['demo_remove_team_chat']);
    assert.equal(rowsOf(database, 'chat_channels').length, 2);
    assert.equal(rowsOf(database, 'chat_messages').length, 7);
    assert.equal(rowsOf(database, 'direct_message_threads').length, 2);
    assert.equal(rowsOf(database, 'direct_messages').length, 5);
  });

  it('scenario cleanup removes only the demo chat and keeps unrelated chat', async () => {
    const { manifests, database, apply } = await setup();
    await apply();
    const publicChannel = { id: '90000000-0000-4000-8000-0000000000a1', team_id: null, channel_type: 'public' };
    const otherTeamChannel = { id: '90000000-0000-4000-8000-0000000000a2', team_id: '90000000-0000-4000-8000-000000000001', channel_type: 'team' };
    const unrelatedThread = { id: '90000000-0000-4000-8000-0000000000a3', participant_low_id: 'x', participant_high_id: 'y' };
    database.rows.set('chat_channels', [...rowsOf(database, 'chat_channels'), publicChannel, otherTeamChannel]);
    database.rows.set('chat_messages', [...rowsOf(database, 'chat_messages'), { id: 'm-public', channel_id: publicChannel.id }]);
    database.rows.set('direct_message_threads', [...rowsOf(database, 'direct_message_threads'), unrelatedThread]);
    database.rows.set('direct_messages', [...rowsOf(database, 'direct_messages'), { id: 'dm-other', thread_id: unrelatedThread.id }]);

    const summary = await cleanupScenario(database, manifests, true);

    assert.deepEqual(rowsOf(database, 'chat_channels').map((row) => row.id).sort(), [publicChannel.id, otherTeamChannel.id].sort());
    assert.deepEqual(rowsOf(database, 'chat_messages').map((row) => row.id), ['m-public']);
    assert.deepEqual(rowsOf(database, 'direct_message_threads'), [unrelatedThread]);
    assert.deepEqual(rowsOf(database, 'direct_messages').map((row) => row.id), ['dm-other']);
    assert.equal(summary.tableCounts.chat_channels, 2);
    assert.equal(summary.tableCounts.chat_messages, 7);
    assert.equal(summary.tableCounts.direct_message_threads, 2);
    assert.equal(summary.tableCounts.direct_messages, 5);
  });

  it('messages added by hand to a demo thread are removed with it, so a reset never fails on them', async () => {
    const { manifests, database, apply } = await setup();
    await apply();
    const thread = rowsOf(database, 'direct_message_threads')[0]!;
    database.rows.set('direct_messages', [...rowsOf(database, 'direct_messages'), { id: 'typed-live', thread_id: thread.id }]);
    await cleanupScenario(database, manifests, true);
    assert.equal(rowsOf(database, 'direct_messages').length, 0);
  });

  it('check mode (no --apply) reports existing chat but never calls the removal function or writes', async () => {
    const { manifests, accounts, database, dependencies, apply } = await setup();
    await apply();
    database.writes = 0;
    database.rpcCalls.length = 0;
    await executeSeed({ apply: false, scenario: 'recruitment-v1', rotatePassword: false }, dependencies, manifests, accounts);
    assert.equal(database.writes, 0);
    assert.deepEqual(database.rpcCalls, []);
  });

  it('verification reports a missing channel, a missing message and a wrong direct-message pair', async () => {
    const { manifests, accounts, firebase, database, apply } = await setup();
    await apply();
    const ok = await verifyDemoState(firebase, database, manifests, accounts, NOW);
    assert.equal(ok.ok, true, ok.issues.join(' '));
    assert.equal(ok.summary.teamChannels, 2);
    assert.equal(ok.summary.teamChannelMessages, 7);
    assert.equal(ok.summary.directMessageThreads, 2);
    assert.equal(ok.summary.directMessages, 5);

    database.rows.set('chat_channels', rowsOf(database, 'chat_channels').slice(1));
    database.rows.set('chat_messages', rowsOf(database, 'chat_messages').slice(1));
    database.rows.set('direct_message_threads', rowsOf(database, 'direct_message_threads').map((row, index) => (
      index === 0 ? { ...row, participant_high_id: '10000000-0000-4000-8000-000000000001' } : row
    )));
    const broken = await verifyDemoState(firebase, database, manifests, accounts, NOW);
    assert.equal(broken.ok, false);
    assert.match(broken.issues.join(' '), /team channels: expected 2, found 1/);
    assert.match(broken.issues.join(' '), /team chat messages: expected 7, found 6/);
    assert.match(broken.issues.join(' '), /does not connect the two demo accounts/);
  });

  describe('manifest rules', () => {
    it('rejects a team channel message written by someone who is not a confirmed member', async () => {
      const manifests = structuredClone(await loadManifests('recruitment-v1'));
      manifests.recruitment.teamChannelMessages[0]!.accountKey = 'casey';
      assert.throws(() => validateManifests(manifests), /confirmed member/);
    });

    it('rejects a team without a channel, or with fewer than two messages', async () => {
      const noChannel = structuredClone(await loadManifests('recruitment-v1'));
      noChannel.recruitment.teamChannels.pop();
      noChannel.recruitment.teamChannelMessages = noChannel.recruitment.teamChannelMessages.filter((m) => m.channelKey !== 'campus-compass-chat');
      assert.throws(() => validateManifests(noChannel), /must have a team channel/);

      const fewMessages = structuredClone(await loadManifests('recruitment-v1'));
      fewMessages.recruitment.teamChannelMessages = fewMessages.recruitment.teamChannelMessages.filter((m) => m.id !== '36000000-0000-4000-8000-000000000002' && m.id !== '36000000-0000-4000-8000-000000000003');
      assert.throws(() => validateManifests(fewMessages), /at least two messages/);
    });

    it('rejects a direct message from someone outside its thread, a conversation with oneself, or an ADMIN', async () => {
      const outsider = structuredClone(await loadManifests('recruitment-v1'));
      outsider.recruitment.directMessages[0]!.accountKey = 'drew';
      assert.throws(() => validateManifests(outsider), /is not in thread/);

      const self = structuredClone(await loadManifests('recruitment-v1'));
      self.recruitment.directMessageThreads[0]!.accountKeys = ['avery', 'avery'];
      assert.throws(() => validateManifests(self), /oneself/);

      const admin = structuredClone(await loadManifests('recruitment-v1'));
      admin.recruitment.directMessageThreads[0]!.accountKeys = ['avery', 'admin-ops'];
      assert.throws(() => validateManifests(admin), /must be a PART demo account/);
    });

    it('rejects empty or overlong bodies, bad ages and duplicate ids', async () => {
      const empty = structuredClone(await loadManifests('recruitment-v1'));
      empty.recruitment.directMessages[0]!.body = '   ';
      assert.throws(() => validateManifests(empty), /body is required/);

      const long = structuredClone(await loadManifests('recruitment-v1'));
      long.recruitment.teamChannelMessages[0]!.body = 'x'.repeat(4001);
      assert.throws(() => validateManifests(long), /at most 4000/);

      const age = structuredClone(await loadManifests('recruitment-v1'));
      age.recruitment.directMessages[0]!.minutesAgo = 0;
      assert.throws(() => validateManifests(age), /positive whole number/);

      const duplicate = structuredClone(await loadManifests('recruitment-v1'));
      duplicate.recruitment.directMessages[1]!.id = duplicate.recruitment.directMessages[0]!.id;
      assert.throws(() => validateManifests(duplicate), /direct message UUID values must be unique/);
    });
  });

  it('puts the two people of a thread in canonical order whichever way round they are given', () => {
    const a = '10000000-0000-4000-8000-000000000003';
    const b = '10000000-0000-4000-8000-000000000005';
    assert.deepEqual(canonicalPair(a, b), [a, b]);
    assert.deepEqual(canonicalPair(b, a), [a, b]);
    assert.deepEqual(canonicalPair(a.toUpperCase(), b), [a, b]);
  });
});
