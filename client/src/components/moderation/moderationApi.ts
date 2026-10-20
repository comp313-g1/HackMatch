import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  CreateModerationCaseInput,
  ModerationCaseDetail,
  ModerationCaseView,
  ModerationFieldErrors,
} from './moderationTypes';

export { AuthRequiredError };

export class ModerationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: ModerationFieldErrors,
    readonly submitted?: unknown,
    message?: string
  ) {
    super(message || code);
    this.name = 'ModerationApiError';
  }
}

async function parseErrorBody(res: Response): Promise<{
  error?: string;
  code?: string;
  errors?: ModerationFieldErrors;
  submitted?: unknown;
}> {
  try {
    return (await res.json()) as {
      error?: string;
      code?: string;
      errors?: ModerationFieldErrors;
      submitted?: unknown;
    };
  } catch {
    return {};
  }
}

function throwFromResponse(res: Response, body: Awaited<ReturnType<typeof parseErrorBody>>, fallbackSubmitted?: unknown): never {
  throw new ModerationApiError(
    res.status,
    body.code || 'UNKNOWN_ERROR',
    body.errors,
    body.submitted ?? fallbackSubmitted,
    body.error || `Request failed with status ${res.status}`
  );
}

/** GET /api/access/admin — ADMIN RBAC probe for the safety queue UI. */
export async function probeAdminModerationAccess(): Promise<'granted' | 'denied'> {
  let res: Response;
  try {
    res = await authFetch('/api/access/admin', { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new ModerationApiError(
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
 * GET /api/admin/moderation/cases — newest-first safety queue (US-026 / FR-075).
 */
export async function fetchModerationCases(options?: {
  status?: string;
  limit?: number;
}): Promise<ModerationCaseView[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit != null) params.set('limit', String(options.limit));
  const qs = params.toString();
  const path = qs ? `/api/admin/moderation/cases?${qs}` : '/api/admin/moderation/cases';

  let res: Response;
  try {
    res = await authFetch(path, { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new ModerationApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your queue filters have been kept.' },
      options,
      'Network error. Your queue filters have been kept.'
    );
  }

  if (res.ok) {
    const data = (await res.json()) as { cases?: ModerationCaseView[] };
    return Array.isArray(data.cases) ? data.cases : [];
  }

  const body = await parseErrorBody(res);
  throwFromResponse(res, body, options);
}

/**
 * GET /api/admin/moderation/cases/:caseId — case + sanitized target detail.
 */
export async function fetchModerationCaseDetail(caseId: string): Promise<ModerationCaseDetail> {
  let res: Response;
  try {
    res = await authFetch(`/api/admin/moderation/cases/${caseId}`, { method: 'GET' });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new ModerationApiError(
      0,
      'NETWORK',
      { _form: 'Network error while loading the case.' },
      { caseId },
      'Network error while loading the case.'
    );
  }

  if (res.ok) {
    return (await res.json()) as ModerationCaseDetail;
  }

  const body = await parseErrorBody(res);
  throwFromResponse(res, body, { caseId });
}

/**
 * POST /api/admin/moderation/cases — open a case (target, reason, time).
 * On validation failure, field errors and submitted values are returned (NR-017).
 */
export async function createModerationCase(
  input: CreateModerationCaseInput
): Promise<ModerationCaseView> {
  let res: Response;
  try {
    res = await authFetch('/api/admin/moderation/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new ModerationApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your entered values have been kept.' },
      input,
      'Network error. Your entered values have been kept.'
    );
  }

  if (res.ok || res.status === 201) {
    const data = (await res.json()) as { case: ModerationCaseView };
    return data.case;
  }

  const body = await parseErrorBody(res);
  throwFromResponse(res, body, input);
}

/** Newest-first sort for defensive client ordering (FR-075). */
export function sortCasesNewestFirst(cases: ModerationCaseView[]): ModerationCaseView[] {
  return [...cases].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
