import { authFetch, AuthRequiredError } from '../../config/authFetch';

export { AuthRequiredError };

/** FR-053 / R-02 — optional applicant message max length (mirrors server applicationModel). */
export const APPLICATION_MESSAGE_MAX_LENGTH = 250;

export class ApplicationsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string | undefined>,
    readonly details?: Record<string, unknown>,
    message?: string
  ) {
    super(message || code);
    this.name = 'ApplicationsApiError';
  }
}

export interface SubmitApplicationPayload {
  vacancyId: string;
  /** Optional pitch; omit or null when empty. Max 250 characters when set. */
  message?: string | null;
}

export interface SubmittedApplication {
  id: string;
  teamId: string;
  eventId: string;
  vacancyId: string | null;
  applicantParticipantId: string;
  status: string;
  requestType: 'Application';
  message: string | null;
  createdAt: string;
  teamName: string;
  vacancyRole: string;
  pendingCountForEvent?: number;
  notice: string;
}

/** Trim; blank → null. Does not truncate (callers validate length). */
export function normalizeApplicationMessage(
  message: string | null | undefined
): string | null {
  if (message == null) return null;
  const trimmed = message.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isApplicationMessageTooLong(
  message: string | null | undefined
): boolean {
  const normalized = normalizeApplicationMessage(message);
  if (normalized == null) return false;
  return normalized.length > APPLICATION_MESSAGE_MAX_LENGTH;
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }

  let errBody: {
    error?: string;
    code?: string;
    errors?: Record<string, string | undefined>;
    details?: Record<string, unknown>;
  } = {};

  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // Non-JSON
  }

  throw new ApplicationsApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    errBody.error || `Request failed with status ${res.status}`
  );
}

async function authCall<T>(call: () => Promise<Response>): Promise<T> {
  let res: Response;
  try {
    res = await call();
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new ApplicationsApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your application draft has been kept.' },
      undefined,
      'Network error. Your application draft has been kept.'
    );
  }
  return parseOrThrow<T>(res);
}

/**
 * POST /api/teams/:teamId/applications — US-018 / #171 client for #172 Express endpoint.
 * Body: { vacancyId, message? }. Creates Pending Review application (FR-053).
 */
export async function submitTeamApplication(
  teamId: string,
  payload: SubmitApplicationPayload
): Promise<SubmittedApplication> {
  const message = normalizeApplicationMessage(payload.message);
  const data = await authCall<{ application: SubmittedApplication } | SubmittedApplication>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vacancyId: payload.vacancyId,
        message,
      }),
    })
  );

  if ('application' in data && data.application) {
    return data.application;
  }
  return data as SubmittedApplication;
}
