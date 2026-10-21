import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  AccountsFieldErrors,
  AccountsListQuery,
  AdminAccountDetail,
  AdminAccountListItem,
  SuspendAccountResult,
} from './accountTypes';

export { AuthRequiredError };

export class AccountsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: AccountsFieldErrors,
    readonly submitted?: unknown,
    message?: string
  ) {
    super(message || code);
    this.name = 'AccountsApiError';
  }
}

async function parseErrorBody(res: Response): Promise<{
  error?: string;
  code?: string;
  errors?: AccountsFieldErrors;
  submitted?: unknown;
}> {
  try {
    return (await res.json()) as {
      error?: string;
      code?: string;
      errors?: AccountsFieldErrors;
      submitted?: unknown;
    };
  } catch {
    return {};
  }
}

function throwFromResponse(
  res: Response,
  body: Awaited<ReturnType<typeof parseErrorBody>>,
  fallbackSubmitted?: unknown
): never {
  throw new AccountsApiError(
    res.status,
    body.code || 'UNKNOWN_ERROR',
    body.errors,
    body.submitted ?? fallbackSubmitted,
    body.error || `Request failed with status ${res.status}`
  );
}

/** GET /api/access/admin — ADMIN RBAC probe for account enforcement UI. */
export async function probeAdminAccountsAccess(): Promise<'granted' | 'denied'> {
  let res: Response;
  try {
    res = await authFetch('/api/access/admin', { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new AccountsApiError(
      0,
      'NETWORK',
      { _form: 'Network error while checking administrator access.' },
      undefined,
      'Network error while checking administrator access.'
    );
  }

  if (res.ok) return 'granted';
  if (res.status === 401 || res.status === 403) return 'denied';

  const body = await parseErrorBody(res);
  throwFromResponse(res, body);
}

/**
 * GET /api/admin/accounts — ADMIN account list (US-027 / #248 / AC 1).
 */
export async function fetchAdminAccounts(
  query?: AccountsListQuery
): Promise<AdminAccountListItem[]> {
  const params = new URLSearchParams();
  if (query?.q) params.set('q', query.q);
  if (query?.state) params.set('state', query.state);
  if (query?.role) params.set('role', query.role);
  if (query?.limit != null) params.set('limit', String(query.limit));
  const qs = params.toString();
  const path = qs ? `/api/admin/accounts?${qs}` : '/api/admin/accounts';

  let res: Response;
  try {
    res = await authFetch(path, { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new AccountsApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your search filters have been kept.' },
      query,
      'Network error. Your search filters have been kept.'
    );
  }

  if (res.ok) {
    const data = (await res.json()) as { accounts?: AdminAccountListItem[] };
    return Array.isArray(data.accounts) ? data.accounts : [];
  }

  const body = await parseErrorBody(res);
  throwFromResponse(res, body, query);
}

/**
 * GET /api/admin/accounts/:accountId — account detail + relevant listings.
 */
export async function fetchAdminAccountDetail(accountId: string): Promise<AdminAccountDetail> {
  let res: Response;
  try {
    res = await authFetch(`/api/admin/accounts/${accountId}`, { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new AccountsApiError(
      0,
      'NETWORK',
      { _form: 'Network error while loading the account.' },
      { accountId },
      'Network error while loading the account.'
    );
  }

  if (res.ok) {
    return (await res.json()) as AdminAccountDetail;
  }

  const body = await parseErrorBody(res);
  throwFromResponse(res, body, { accountId });
}

/**
 * POST /api/admin/accounts/:accountId/suspend — revoke sessions + suspension cascade (#250–#251).
 */
export async function suspendAdminAccount(
  accountId: string,
  input: { reason: string }
): Promise<SuspendAccountResult> {
  let res: Response;
  try {
    res = await authFetch(`/api/admin/accounts/${accountId}/suspend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new AccountsApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your entered reason was kept.' },
      input,
      'Network error. Your entered reason was kept.'
    );
  }

  if (res.ok) {
    return (await res.json()) as SuspendAccountResult;
  }

  const body = await parseErrorBody(res);
  throwFromResponse(res, body, input);
}

export function formatCascadeSuccess(result: SuspendAccountResult): string {
  const { effects, outcome, sessionsRevoked, firebaseSignInDisabled } = result;
  const parts = [
    outcome === 'account_already_suspended'
      ? 'Account was already suspended; enforcement was re-applied.'
      : 'Account suspended.',
    sessionsRevoked ? 'Sessions revoked.' : null,
    firebaseSignInDisabled ? 'Sign-in blocked.' : null,
    `Canceled ${effects.pendingIncomingRequestsCanceled} pending request(s) and ${effects.outgoingInvitationsCanceled} outgoing invitation(s).`,
    effects.profileHidden ? 'Profile hidden from discovery.' : 'No profile row to hide.',
    effects.availabilityCleared
      ? 'Looking-for-Team availability cleared.'
      : 'Looking-for-Team was already inactive.',
    `Paused recruitment on ${effects.ownedTeamsPaused} owned Open team(s).`,
    'Confirmed memberships were preserved.',
  ];
  return parts.filter(Boolean).join(' ');
}
