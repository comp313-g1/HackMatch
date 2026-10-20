import { authFetch, AuthRequiredError } from '../../config/authFetch';

export { AuthRequiredError };

/** FR-053 / R-02 — optional applicant message max length (mirrors server applicationModel). */
export const APPLICATION_MESSAGE_MAX_LENGTH = 250;

/** US-018 — concurrent Pending Review apps per PART across the platform. */
export const MAX_PENDING_APPLICATIONS = 3;

/** FR-054 / US-018 — legacy alias for concurrent Pending Review apps. */
export const MAX_PENDING_APPLICATIONS_PER_EVENT = MAX_PENDING_APPLICATIONS;

export const DUPLICATE_PENDING_APPLICATION_MESSAGE =
  'You already have a pending application for this team. Withdraw it or wait for a decision before applying again.';

export const APPLICATION_PENDING_LIMIT_MESSAGE =
  'You already have 3 pending applications across the platform. Withdraw one or wait for a decision before applying again.';

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
  vacancyId?: string;
  slotId?: string;
  /** Optional pitch; omit or null when empty. Max 250 characters when set. */
  message?: string | null;
}

export interface SubmittedApplication {
  id: string;
  teamId: string;
  eventId?: string;
  vacancyId: string | null;
  slotId?: string | null;
  applicantParticipantId: string;
  status: string;
  requestType: 'Application';
  message: string | null;
  createdAt: string;
  teamName: string;
  vacancyRole: string;
  pendingCount?: number;
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
  const vacancyId = payload.vacancyId ?? payload.slotId ?? '';
  const data = await authCall<{ application: SubmittedApplication } | SubmittedApplication>(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vacancyId,
        message,
      }),
    })
  );

  if ('application' in data && data.application) {
    return data.application;
  }
  return data as SubmittedApplication;
}

export interface MyApplicationListItem {
  id: string;
  teamId: string;
  eventId?: string;
  vacancyId: string | null;
  slotId?: string | null;
  applicantParticipantId: string;
  status: string;
  statusLabel: string;
  requestType: 'Application';
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
  cancelReason: string | null;
  teamName: string;
  vacancyRole: string | null;
  withdrawable: boolean;
}

export interface MyApplicationsListResult {
  applications: MyApplicationListItem[];
  empty: boolean;
  message: string | null;
}

export interface ApplicationStatusAlert {
  audience: string;
  type: string;
  message: string;
}

export interface WithdrawnApplicationResult {
  application: {
    id: string;
    teamId: string;
    eventId?: string;
    vacancyId: string | null;
    slotId?: string | null;
    applicantParticipantId: string;
    status: string;
    statusLabel: string;
    requestType: 'Application';
    message: string | null;
    resolvedAt: string | null;
    cancelReason: string | null;
    teamName: string;
    vacancyRole: string | null;
  };
  changed: boolean;
  idempotent: boolean;
  alerts: ApplicationStatusAlert[];
  notice: string;
}

export function formatApplicationSubmitError(err: unknown): string {
  if (err instanceof ApplicationsApiError) {
    if (err.errors?._form) return err.errors._form;
    if (err.code === 'APPLICATION_PENDING_LIMIT') return APPLICATION_PENDING_LIMIT_MESSAGE;
    if (err.code === 'DUPLICATE_PENDING_APPLICATION') return DUPLICATE_PENDING_APPLICATION_MESSAGE;
    if (err.code === 'APPLICANT_ALREADY_CONFIRMED') return 'You are already a confirmed member of this team.';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Failed to submit application.';
}

/** GET /api/applications/mine — applicant status list (US-018 / #175). */
export async function fetchMyApplications(): Promise<MyApplicationsListResult> {
  return authCall(() => authFetch('/api/applications/mine'));
}

/**
 * POST /api/applications/:applicationId/withdraw — FR-055 self-withdraw (#175).
 * Releases pending quota; returns basic owner/applicant status alerts.
 */
export async function withdrawTeamApplication(
  applicationId: string
): Promise<WithdrawnApplicationResult> {
  return authCall(() =>
    authFetch(`/api/applications/${encodeURIComponent(applicationId)}/withdraw`, {
      method: 'POST',
    })
  );
}
