import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  ManifestExportFormat,
  TeamManifestExportPayload,
  ManifestExportArtifact,
} from './teamManifestExport';

export { AuthRequiredError };

export interface TeamManifestVerificationApiResponse {
  valid: boolean;
  expectedChecksum: string;
  providedChecksum: string;
  matchesStoredSnapshot: boolean;
  lockedAt: string;
  message: string;
}

export class TeamManifestApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string>,
    readonly details?: unknown,
    message?: string
  ) {
    super(message || code);
    this.name = 'TeamManifestApiError';
  }
}

async function parseResponseOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }

  let errBody: {
    error?: string;
    code?: string;
    errors?: Record<string, string>;
    details?: unknown;
  } = {};

  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // Non-JSON error payload
  }

  throw new TeamManifestApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    errBody.error || errBody.code || `HTTP_${res.status}`
  );
}

/**
 * Fetches the canonical manifest snapshot and integrity metadata for a locked team (US-024 / FR-071).
 */
export async function fetchTeamManifest(teamId: string): Promise<TeamManifestExportPayload> {
  const res = await authFetch(`/api/teams/${encodeURIComponent(teamId)}/manifest`);
  return parseResponseOrThrow<TeamManifestExportPayload>(res);
}

/**
 * Downloads team manifest in specified format (json, html, pdf) directly from the server.
 */
export async function downloadTeamManifestFromServer(
  teamId: string,
  format: ManifestExportFormat
): Promise<ManifestExportArtifact> {
  const res = await authFetch(
    `/api/teams/${encodeURIComponent(teamId)}/manifest?format=${encodeURIComponent(format)}`
  );

  if (!res.ok) {
    await parseResponseOrThrow<unknown>(res);
  }

  const contentType = res.headers.get('content-type') || (
    format === 'pdf' ? 'application/pdf' : format === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'
  );

  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match
    ? match[1]
    : format === 'pdf'
    ? `team-verification-card-${teamId}.pdf`
    : format === 'html'
    ? `team-verification-card-${teamId}.html`
    : `team-manifest-${teamId}.json`;

  if (format === 'pdf') {
    const arrayBuffer = await res.arrayBuffer();
    return {
      format: 'pdf',
      filename,
      contentType,
      content: new Uint8Array(arrayBuffer),
    };
  }

  const text = await res.text();
  return {
    format,
    filename,
    contentType,
    content: text,
  };
}

/**
 * Compares a candidate checksum against the stored server record (US-024 / FR-072).
 */
export async function verifyTeamManifestChecksum(
  teamId: string,
  checksum: string
): Promise<TeamManifestVerificationApiResponse> {
  const res = await authFetch(`/api/teams/${encodeURIComponent(teamId)}/manifest/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ checksum }),
  });

  return parseResponseOrThrow<TeamManifestVerificationApiResponse>(res);
}
