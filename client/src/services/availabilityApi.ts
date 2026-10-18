import { authFetch, AuthRequiredError } from '../config/authFetch';

export const AVAILABILITY_ROLES = [
  'Frontend',
  'Backend',
  'Mobile',
  'AI/ML',
  'UI/UX',
  'Pitch',
] as const;

export type AvailabilityRole = (typeof AVAILABILITY_ROLES)[number];

export const AVAILABILITY_GOALS = [
  'Learning',
  'Project Completion',
  'Competitive',
] as const;

export type AvailabilityGoal = (typeof AVAILABILITY_GOALS)[number];

export const AVAILABILITY_MIN_COMMITMENT_HOURS = 0;
export const AVAILABILITY_MAX_COMMITMENT_HOURS = 168;

export interface PlatformAvailabilityRecord {
  participantId: string;
  isLooking: boolean;
  desiredRole: AvailabilityRole | null;
  commitmentHours: number | null;
  goal: AvailabilityGoal | null;
  updatedAt: string | null;
}

export interface UpdatePlatformAvailabilityInput {
  isLooking: boolean;
  desiredRole?: AvailabilityRole | null;
  commitmentHours?: number | null;
  goal?: AvailabilityGoal | null;
}

export interface AvailableCandidateCard {
  participantId: string;
  displayName: string;
  handle: string | null;
  institution: string | null;
  primaryRole: string | null;
  desiredRole: AvailabilityRole | null;
  commitmentHours: number | null;
  goal: AvailabilityGoal | null;
  skills: string[];
  portfolioLinks: Array<{ url: string; label: string | null; isSelfDeclared: true }>;
  updatedAt: string | null;
}

export interface AvailabilityFieldErrors {
  isLooking?: string;
  desiredRole?: string;
  commitmentHours?: string;
  goal?: string;
  [key: string]: string | undefined;
}

export class AvailabilityApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fieldErrors?: AvailabilityFieldErrors,
    message?: string
  ) {
    super(message || code);
    this.name = 'AvailabilityApiError';
  }
}

export { AuthRequiredError };

async function parseResponseOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }

  let errBody: {
    error?: string;
    code?: string;
    fieldErrors?: AvailabilityFieldErrors;
    errors?: AvailabilityFieldErrors;
  } = {};

  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // Non-JSON response
  }

  const fieldErrors = errBody.fieldErrors || errBody.errors;
  const message = errBody.error || `Request failed with status ${res.status}`;
  const code = errBody.code || 'UNKNOWN_ERROR';

  throw new AvailabilityApiError(res.status, code, fieldErrors, message);
}

export async function fetchMyAvailability(
  token?: string | null
): Promise<PlatformAvailabilityRecord> {
  const init: RequestInit = {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
  const res = token
    ? await fetch('/api/availability/me', init)
    : await authFetch('/api/availability/me', init);

  const data = await parseResponseOrThrow<{
    status: string;
    availability: PlatformAvailabilityRecord;
  }>(res);
  return data.availability;
}

export async function updateMyAvailability(
  payload: UpdatePlatformAvailabilityInput,
  token?: string | null
): Promise<PlatformAvailabilityRecord> {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const init: RequestInit = {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  };
  const res = token
    ? await fetch('/api/availability/me', init)
    : await authFetch('/api/availability/me', init);

  const data = await parseResponseOrThrow<{
    status: string;
    availability: PlatformAvailabilityRecord;
  }>(res);
  return data.availability;
}

export async function fetchAvailableCandidates(
  token?: string | null
): Promise<AvailableCandidateCard[]> {
  const init: RequestInit = {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
  const res = token
    ? await fetch('/api/availability', init)
    : await authFetch('/api/availability', init);

  const data = await parseResponseOrThrow<{
    status: string;
    candidates: AvailableCandidateCard[];
  }>(res);
  return data.candidates;
}
