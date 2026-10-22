import type {
  FirebasePort,
  FirebaseReconciliationResult,
  FirebaseUpdateInput,
  FirebaseUserRecord,
  ReconciliationPlan,
  ResolvedAccount,
} from './types.js';
import { normalizeEmail } from './manifest.js';

export interface FirebaseReconcileOptions {
  apply: boolean;
  rotatePassword: boolean;
  password?: string;
}

export interface FirebaseDecision {
  update: FirebaseUpdateInput;
  claims: Record<string, unknown> | null;
  revoke: boolean;
  actions: ReconciliationPlan['actions'];
}

export function decideFirebaseReconciliation(
  account: ResolvedAccount,
  existing: FirebaseUserRecord,
  rotatePassword: boolean,
  password?: string
): FirebaseDecision {
  const update: FirebaseUpdateInput = {};
  const actions: ReconciliationPlan['actions'] = [];
  if (normalizeEmail(existing.email ?? '') !== account.email) update.email = account.email;
  if ((existing.displayName ?? '') !== account.displayName) update.displayName = account.displayName;
  if (!existing.emailVerified) update.emailVerified = true;
  if (existing.disabled) update.disabled = false;
  if (rotatePassword) {
    if (!password) throw new Error('EnvironmentError: password is required for rotation.');
    update.password = password;
  }
  if (Object.keys(update).length > 0) actions.push('update');

  const existingClaims = { ...(existing.customClaims ?? {}) };
  const roleChanged = existingClaims.role !== account.role;
  const claims = roleChanged ? { ...existingClaims, role: account.role } : null;
  if (roleChanged) actions.push('claims');

  const revoke = roleChanged || rotatePassword || existing.disabled;
  if (revoke) actions.push('revoke');
  if (actions.length === 0) actions.push('unchanged');
  return { update, claims, revoke, actions };
}

export async function reconcileFirebaseAccounts(
  firebase: FirebasePort,
  accounts: readonly ResolvedAccount[],
  options: FirebaseReconcileOptions
): Promise<FirebaseReconciliationResult> {
  if (options.apply && !options.password) {
    throw new Error('EnvironmentError: HACKMATCH_DEMO_PASSWORD is required for Firebase creation.');
  }

  const plans: ReconciliationPlan[] = [];
  const newlyCreatedUids: string[] = [];
  const prepared: Array<{
    account: ResolvedAccount;
    existing: FirebaseUserRecord | null;
    decision: FirebaseDecision | null;
  }> = [];

  // Resolve every UID/email pair before the first mutation so a late collision
  // cannot leave earlier accounts partially provisioned.
  for (const account of accounts) {
    const [uidMatch, emailMatch] = await Promise.all([
      firebase.getByUid(account.uid),
      firebase.getByEmail(account.email),
    ]);

    if (uidMatch && emailMatch && uidMatch.uid !== emailMatch.uid) {
      throw new Error(`FirebaseCollisionError: UID and email resolve to different users for ${account.key}.`);
    }
    if (!uidMatch && emailMatch) {
      throw new Error(`FirebaseCollisionError: The resolved email for ${account.key} belongs to a different Firebase UID.`);
    }

    if (!uidMatch) {
      plans.push({ accountKey: account.key, actions: ['create', 'claims'], existing: false });
      prepared.push({ account, existing: null, decision: null });
      continue;
    }

    const decision = decideFirebaseReconciliation(
      account,
      uidMatch,
      options.rotatePassword,
      options.password
    );
    plans.push({ accountKey: account.key, actions: decision.actions, existing: true });
    prepared.push({ account, existing: uidMatch, decision });
  }

  if (!options.apply) return { plans, newlyCreatedUids };

  try {
    for (const item of prepared) {
      const { account, existing, decision } = item;
      if (!existing) {
        await firebase.create({
          uid: account.uid,
          email: account.email,
          displayName: account.displayName,
          emailVerified: true,
          disabled: false,
          password: options.password!,
        });
        newlyCreatedUids.push(account.uid);
        await firebase.setClaims(account.uid, { role: account.role });
        continue;
      }
      if (decision && Object.keys(decision.update).length > 0) {
        await firebase.update(account.uid, decision.update);
      }
      if (decision?.claims) {
        await firebase.setClaims(account.uid, decision.claims);
      }
      if (decision?.revoke) {
        await firebase.revokeRefreshTokens(account.uid);
      }
    }
  } catch (error) {
    if (newlyCreatedUids.length > 0) {
      await compensateNewFirebaseUsers(firebase, newlyCreatedUids);
    }
    throw error;
  }

  return { plans, newlyCreatedUids };
}

export async function compensateNewFirebaseUsers(
  firebase: FirebasePort,
  newlyCreatedUids: readonly string[]
): Promise<void> {
  const errors: string[] = [];
  for (const uid of [...newlyCreatedUids].reverse()) {
    try {
      await firebase.delete(uid);
    } catch (error) {
      errors.push(`${uid}: ${(error as Error).message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`FirebaseCompensationError: ${errors.join('; ')}`);
  }
}

export async function deleteOwnedFirebaseAccounts(
  firebase: FirebasePort,
  accounts: readonly ResolvedAccount[],
  apply: boolean
): Promise<ReconciliationPlan[]> {
  const plans: ReconciliationPlan[] = [];
  const existingByAccount = new Map<string, FirebaseUserRecord | null>();
  for (const account of accounts) {
    const [existing, emailMatch] = await Promise.all([
      firebase.getByUid(account.uid),
      firebase.getByEmail(account.email),
    ]);
    if (existing && normalizeEmail(existing.email ?? '') !== account.email) {
      throw new Error(`FirebaseResetCollisionError: deterministic UID for ${account.key} has an unexpected email.`);
    }
    if (emailMatch && emailMatch.uid !== account.uid) {
      throw new Error(`FirebaseResetCollisionError: resolved email for ${account.key} belongs to a different UID.`);
    }
    existingByAccount.set(account.key, existing);
    plans.push({
      accountKey: account.key,
      actions: existing ? ['update'] : ['unchanged'],
      existing: Boolean(existing),
    });
  }
  if (apply) {
    for (const account of accounts) {
      if (existingByAccount.get(account.key)) await firebase.delete(account.uid);
    }
  }
  return plans;
}
