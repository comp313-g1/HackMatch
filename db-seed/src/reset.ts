import { deleteOwnedDatabaseAccounts } from './databaseAccounts.js';
import { deleteOwnedFirebaseAccounts } from './firebaseAccounts.js';
import { cleanupScenario } from './recruitmentGraph.js';
import type {
  DatabasePort,
  DemoManifests,
  FirebasePort,
  ResetOptions,
  ResolvedAccount,
} from './types.js';
import { DEMO_NAMESPACE } from './types.js';

export function selectResetMode(flags: { scenarioOnly: boolean; all: boolean }): 'scenario-only' | 'all' {
  if (flags.scenarioOnly === flags.all) {
    throw new Error('ResetValidationError: choose exactly one of --scenario-only or --all.');
  }
  return flags.all ? 'all' : 'scenario-only';
}

export function validateResetOptions(options: ResetOptions): void {
  if (!options.apply) throw new Error('ResetSafetyError: reset requires --apply.');
  if (options.confirm !== DEMO_NAMESPACE) {
    throw new Error(`ResetSafetyError: --confirm must equal ${DEMO_NAMESPACE}.`);
  }
  if (options.scenario !== 'recruitment-v1') {
    throw new Error('ResetValidationError: only recruitment-v1 is supported.');
  }
}

export async function resetDemoData(
  firebase: FirebasePort,
  database: DatabasePort,
  manifests: DemoManifests,
  accounts: readonly ResolvedAccount[],
  options: ResetOptions
): Promise<void> {
  validateResetOptions(options);
  if (options.selection === 'all') {
    // Fail closed on identity collisions before removing any scenario data.
    await deleteOwnedFirebaseAccounts(firebase, accounts, false);
    await deleteOwnedDatabaseAccounts(database, accounts, false);
  }
  await cleanupScenario(database, manifests, true);
  if (options.selection === 'scenario-only') return;

  // PostgreSQL is removed first. If an unrelated FK (for example manually-created
  // chat content) references a demo participant, deletion fails closed and Firebase
  // accounts remain available for recovery.
  await deleteOwnedDatabaseAccounts(database, accounts, true);
  await deleteOwnedFirebaseAccounts(firebase, accounts, true);
}
