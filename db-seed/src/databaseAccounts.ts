import type {
  DatabasePort,
  DatabaseReconciliationResult,
  ReconciliationPlan,
  ResolvedAccount,
} from './types.js';

function oneOrNull(rows: Array<Record<string, unknown>>, label: string): Record<string, unknown> | null {
  if (rows.length > 1) throw new Error(`DatabaseCollisionError: multiple participant rows matched ${label}.`);
  return rows[0] ?? null;
}

function escapeIlikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function rowId(row: Record<string, unknown> | null): string | null {
  return row && typeof row.id === 'string' ? row.id : null;
}

function participantNeedsUpdate(row: Record<string, unknown>, account: ResolvedAccount): boolean {
  return (
    row.firebase_uid !== account.uid ||
    row.email !== account.email ||
    row.full_name !== account.displayName ||
    row.role !== account.role ||
    row.is_verified !== true ||
    row.is_suspended !== false ||
    row.is_deactivated === true ||
    row.suspended_at != null ||
    row.suspended_by != null ||
    row.suspension_reason != null ||
    row.deactivated_at != null ||
    row.deactivated_by != null ||
    row.deactivation_reason != null
  );
}

export function participantRow(account: ResolvedAccount): Record<string, unknown> {
  return {
    id: account.participantId,
    firebase_uid: account.uid,
    email: account.email,
    full_name: account.displayName,
    role: account.role,
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    suspended_by: null,
    suspension_reason: null,
    is_deactivated: false,
    deactivated_at: null,
    deactivated_by: null,
    deactivation_reason: null,
    updated_at: new Date().toISOString(),
  };
}

export async function reconcileDatabaseAccounts(
  database: DatabasePort,
  accounts: readonly ResolvedAccount[],
  apply: boolean
): Promise<DatabaseReconciliationResult> {
  const plans: ReconciliationPlan[] = [];
  const pendingWrites: ResolvedAccount[] = [];

  // Detect every ID/UID/email conflict before the first database mutation.
  for (const account of accounts) {
    const [idRows, uidRows, emailRows] = await Promise.all([
      database.select('participants', [{ column: 'id', operator: 'eq', value: account.participantId }]),
      database.select('participants', [{ column: 'firebase_uid', operator: 'eq', value: account.uid }]),
      database.select('participants', [{ column: 'email', operator: 'ilike', value: escapeIlikeLiteral(account.email) }]),
    ]);
    const idMatch = oneOrNull(idRows, `${account.key} deterministic ID`);
    const uidMatch = oneOrNull(uidRows, `${account.key} Firebase UID`);
    const emailMatch = oneOrNull(emailRows, `${account.key} normalized email`);
    const matchedIds = new Set([rowId(idMatch), rowId(uidMatch), rowId(emailMatch)].filter(Boolean));
    if (matchedIds.size > 1) {
      throw new Error(`DatabaseCollisionError: ID, UID, and email resolve to different participant rows for ${account.key}.`);
    }
    if ((uidMatch || emailMatch) && [...matchedIds][0] !== account.participantId) {
      throw new Error(`DatabaseCollisionError: ${account.key} resolves to a participant outside its deterministic ID.`);
    }
    if (idMatch && (idMatch.firebase_uid !== account.uid || String(idMatch.email).trim().toLowerCase() !== account.email)) {
      throw new Error(`DatabaseCollisionError: deterministic participant ID for ${account.key} is owned by different identity data.`);
    }

    const existing = idMatch ?? uidMatch ?? emailMatch;
    const actions: ReconciliationPlan['actions'] = !existing
      ? ['create']
      : participantNeedsUpdate(existing, account)
        ? ['update']
        : ['unchanged'];
    plans.push({ accountKey: account.key, actions, existing: Boolean(existing) });
    if (actions[0] !== 'unchanged') pendingWrites.push(account);
  }
  if (apply) {
    for (const account of pendingWrites) {
      await database.upsert('participants', [participantRow(account)], 'id');
    }
  }
  return { plans };
}

export async function deleteOwnedDatabaseAccounts(
  database: DatabasePort,
  accounts: readonly ResolvedAccount[],
  apply: boolean
): Promise<ReconciliationPlan[]> {
  // Reuse reconciliation's exact ID/UID/email ownership checks before deletion.
  await reconcileDatabaseAccounts(database, accounts, false);
  const ids = accounts.map((account) => account.participantId);
  const existing = await database.select('participants', [{ column: 'id', operator: 'in', value: ids }]);
  const existingIds = new Set(existing.map((row) => String(row.id)));
  const plans = accounts.map((account) => ({
    accountKey: account.key,
    actions: existingIds.has(account.participantId) ? ['update'] : ['unchanged'],
    existing: existingIds.has(account.participantId),
  }) satisfies ReconciliationPlan);
  if (apply && existing.length > 0) {
    try {
      await database.delete('participants', [{ column: 'id', operator: 'in', value: ids }]);
    } catch (error) {
      throw new Error(
        `DatabaseResetError: exact demo participants could not be deleted. Remove only their dependent records or use scenario-only reset. ${(error as Error).message}`
      );
    }
  }
  return plans;
}
