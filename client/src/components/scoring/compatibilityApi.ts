import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  CompatibilityScoreFieldErrors,
  CompatibilityScorePayload,
  CompatibilityScoreSuccess,
} from './compatibilityTypes';

export { AuthRequiredError };

export class CompatibilityScoreApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: CompatibilityScoreFieldErrors,
    readonly submitted?: unknown,
    message?: string
  ) {
    super(message || code);
    this.name = 'CompatibilityScoreApiError';
  }
}

/**
 * POST /api/scoring/compatibility — dry-run FR-043–045 scoring.
 * On validation failure, field errors and submitted payload are returned so the UI
 * can keep the form values (NR-017).
 */
export async function previewCompatibilityScore(
  payload: CompatibilityScorePayload
): Promise<CompatibilityScoreSuccess> {
  let res: Response;
  try {
    res = await authFetch('/api/scoring/compatibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new CompatibilityScoreApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Your entered values have been kept.' },
      payload,
      'Network error. Your entered values have been kept.'
    );
  }

  if (res.ok) {
    return (await res.json()) as CompatibilityScoreSuccess;
  }

  let errBody: {
    error?: string;
    code?: string;
    errors?: CompatibilityScoreFieldErrors;
    submitted?: unknown;
  } = {};
  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // non-JSON
  }

  throw new CompatibilityScoreApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.submitted ?? payload,
    errBody.error || `Request failed with status ${res.status}`
  );
}
