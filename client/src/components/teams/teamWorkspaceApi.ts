import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  ParticipantPrimaryRole,
  TeamMembershipRole,
  TeamRecruitmentStatus,
} from './teamTypes';
import type { ExperienceBadge } from '../profile/hackathonHistoryValidation';
import { isValidHttpsPortfolioUrl } from '../profile/profileValidation';

export { AuthRequiredError };

export const WORKSPACE_LINK_LABEL_MAX_LENGTH = 80;
export const WORKSPACE_LINK_URL_MAX_LENGTH = 2048;
export const WORKSPACE_MAX_LINKS = 10;
export const WORKSPACE_NOTE_MAX_LENGTH = 10000;

export interface WorkspaceTeammateContact {
  participantId: string;
  displayName: string;
  handle: string | null;
  institution: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  teamRole: TeamMembershipRole;
  joinedAt: string;
  skills: string[];
  skillsSelfDeclared: true;
  portfolioLinks: Array<{
    url: string;
    label: string | null;
    isSelfDeclared: true;
  }>;
  selfDeclaredNotice: string;
  sharedContactHandle: string | null;
  sharedContactAudienceNotice: string;
  experienceBadge: ExperienceBadge;
}

export interface WorkspaceExternalLink {
  id?: string;
  team_id?: string;
  label: string;
  url: string;
  display_order?: number;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceNoteView {
  team_id: string;
  content: string;
  version: number;
  updated_by: string | null;
  author_display_name: string;
  author_pseudonymized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceNoteRevisionView {
  id: string;
  team_id: string;
  version: number;
  content: string;
  author_id: string | null;
  author_display_name: string;
  author_pseudonymized_at: string | null;
  created_at: string;
}

export interface PrivateTeamWorkspaceView {
  teamId: string;
  teamName: string;
  recruitmentStatus: TeamRecruitmentStatus;
  lockedAt: string;
  viewerRole: TeamMembershipRole | null;
  isOwner: boolean;
  teammates: WorkspaceTeammateContact[];
  links: WorkspaceExternalLink[];
  note: WorkspaceNoteView | null;
  revisions: WorkspaceNoteRevisionView[];
}

export interface WorkspaceConflictDetails {
  expectedVersion: number;
  currentVersion: number;
  latestNote?: WorkspaceNoteView | null;
  revisions?: WorkspaceNoteRevisionView[];
  latestRevisions?: WorkspaceNoteRevisionView[];
  currentContent?: string;
  authorDisplayName?: string;
  updatedAt?: string;
}

export class TeamWorkspaceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors?: Record<string, string>,
    readonly details?: Record<string, unknown>,
    readonly conflict?: WorkspaceConflictDetails,
    message?: string
  ) {
    super(message || code);
    this.name = 'TeamWorkspaceApiError';
  }
}

export interface WorkspaceLinksDraftResult {
  ok: boolean;
  sanitized: Array<{ label: string; url: string }>;
  errors: Record<string, string>;
}

export function validateWorkspaceLinksDraft(
  links: Array<{ label: string; url: string }>
): WorkspaceLinksDraftResult {
  const errors: Record<string, string> = {};

  if (!Array.isArray(links)) {
    return {
      ok: false,
      sanitized: [],
      errors: { _form: 'Links must be provided as an array.' },
    };
  }

  if (links.length > WORKSPACE_MAX_LINKS) {
    errors._form = `You can specify at most ${WORKSPACE_MAX_LINKS} external links.`;
    return { ok: false, sanitized: [], errors };
  }

  const seen = new Set<string>();
  const sanitized: Array<{ label: string; url: string }> = [];

  for (let i = 0; i < links.length; i++) {
    const raw = links[i];
    if (!raw || typeof raw !== 'object') {
      errors[`link_${i}`] = `Link #${i + 1} is invalid.`;
      continue;
    }

    const trimmedLabel =
      typeof raw.label === 'string'
        ? raw.label.trim().replace(/\s+/g, ' ')
        : '';
    const trimmedUrl = typeof raw.url === 'string' ? raw.url.trim() : '';

    if (!trimmedLabel) {
      errors[`link_${i}_label`] = `Link #${i + 1} label is required.`;
    } else if (trimmedLabel.length > WORKSPACE_LINK_LABEL_MAX_LENGTH) {
      errors[`link_${i}_label`] = `Link #${i + 1} label cannot exceed ${WORKSPACE_LINK_LABEL_MAX_LENGTH} characters.`;
    }

    if (!trimmedUrl) {
      errors[`link_${i}_url`] = `Link #${i + 1} URL is required.`;
    } else if (trimmedUrl.length > WORKSPACE_LINK_URL_MAX_LENGTH) {
      errors[`link_${i}_url`] = `Link #${i + 1} URL cannot exceed ${WORKSPACE_LINK_URL_MAX_LENGTH} characters.`;
    } else if (!isValidHttpsPortfolioUrl(trimmedUrl)) {
      errors[`link_${i}_url`] = `Link #${i + 1} URL must be a valid HTTPS URL (e.g. https://github.com/team/repo).`;
    }

    const dedupeKey = `${trimmedLabel.toLowerCase()}|${trimmedUrl}`;
    if (seen.has(dedupeKey)) {
      errors[`link_${i}`] = `Link #${i + 1} is a duplicate of another link in this list.`;
    } else {
      seen.add(dedupeKey);
    }

    sanitized.push({ label: trimmedLabel, url: trimmedUrl });
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, sanitized, errors };
  }

  return { ok: true, sanitized, errors: {} };
}

export interface WorkspaceNoteDraftResult {
  ok: boolean;
  sanitized: { content: string; expectedVersion: number };
  errors: Record<string, string>;
}

export function validateWorkspaceNoteDraft(
  content: string,
  expectedVersion: number
): WorkspaceNoteDraftResult {
  const errors: Record<string, string> = {};

  let normalizedContent = '';
  if (typeof content !== 'string') {
    errors.content = 'Note content must be a string.';
  } else {
    normalizedContent = content.replace(/\r\n/g, '\n').trim();
    if (normalizedContent.length === 0) {
      errors.content = 'Note content cannot be empty.';
    } else if (normalizedContent.length > WORKSPACE_NOTE_MAX_LENGTH) {
      errors.content = `Note content cannot exceed ${WORKSPACE_NOTE_MAX_LENGTH} characters.`;
    }
  }

  if (
    typeof expectedVersion !== 'number' ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    errors.expectedVersion =
      'expectedVersion must be a non-negative integer (e.g. 0, 1, 2).';
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      sanitized: {
        content: typeof content === 'string' ? content : '',
        expectedVersion:
          typeof expectedVersion === 'number' ? expectedVersion : 0,
      },
      errors,
    };
  }

  return {
    ok: true,
    sanitized: { content: normalizedContent, expectedVersion },
    errors: {},
  };
}

async function parseWorkspaceResponseOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    return (await res.json()) as T;
  }

  let errBody: {
    error?: string;
    code?: string;
    errors?: Record<string, string>;
    details?: Record<string, unknown>;
  } = {};

  try {
    errBody = (await res.json()) as typeof errBody;
  } catch {
    // Non-JSON response
  }

  let conflict: WorkspaceConflictDetails | undefined;
  if (
    res.status === 409 &&
    (errBody.code === 'WORKSPACE_NOTE_CONFLICT' || errBody.details)
  ) {
    const d = (errBody.details ?? {}) as Record<string, unknown>;
    conflict = {
      expectedVersion:
        typeof d.expectedVersion === 'number' ? d.expectedVersion : 0,
      currentVersion:
        typeof d.currentVersion === 'number' ? d.currentVersion : 0,
      latestNote: (d.latestNote as WorkspaceNoteView) ?? null,
      revisions:
        (d.revisions as WorkspaceNoteRevisionView[]) ??
        (d.latestRevisions as WorkspaceNoteRevisionView[]) ??
        [],
      latestRevisions:
        (d.latestRevisions as WorkspaceNoteRevisionView[]) ??
        (d.revisions as WorkspaceNoteRevisionView[]) ??
        [],
      currentContent:
        typeof d.currentContent === 'string' ? d.currentContent : undefined,
      authorDisplayName:
        typeof d.authorDisplayName === 'string'
          ? d.authorDisplayName
          : undefined,
      updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : undefined,
    };
  }

  throw new TeamWorkspaceApiError(
    res.status,
    errBody.code || 'UNKNOWN_ERROR',
    errBody.errors,
    errBody.details,
    conflict,
    errBody.error || `Request failed with status ${res.status}`
  );
}

async function authWorkspaceCall<T>(call: () => Promise<Response>): Promise<T> {
  let res: Response;
  try {
    res = await call();
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    if (err instanceof TeamWorkspaceApiError) throw err;
    throw new TeamWorkspaceApiError(
      0,
      'NETWORK',
      { _form: 'Network error. Please check your connection and try again.' },
      undefined,
      undefined,
      'Network error. Please check your connection and try again.'
    );
  }
  return parseWorkspaceResponseOrThrow<T>(res);
}

/**
 * GET /api/teams/:teamId/workspace
 * Confirmed member workspace fetch (FR-068, US-023 AC 1 & AC 2).
 */
export async function fetchPrivateTeamWorkspace(
  teamId: string
): Promise<PrivateTeamWorkspaceView> {
  return authWorkspaceCall(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/workspace`, {
      method: 'GET',
    })
  );
}

/**
 * PUT /api/teams/:teamId/workspace/links
 * Owner-only external coordination links update (FR-069, US-023 AC 3).
 */
export async function updateWorkspaceExternalLinks(
  teamId: string,
  links: Array<{ label: string; url: string }>
): Promise<{
  teamId: string;
  links: WorkspaceExternalLink[];
  updatedAt: string;
}> {
  return authWorkspaceCall(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/workspace/links`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    })
  );
}

/**
 * PUT /api/teams/:teamId/workspace/note
 * Shared markdown concept note save with optimistic concurrency (FR-070, US-023 AC 4).
 */
export async function saveWorkspaceSharedNote(
  teamId: string,
  payload: { content: string; expectedVersion: number }
): Promise<{
  teamId: string;
  note: WorkspaceNoteView;
  revision: WorkspaceNoteRevisionView;
  revisions: WorkspaceNoteRevisionView[];
}> {
  return authWorkspaceCall(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/workspace/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
}

/**
 * GET /api/teams/:teamId/workspace/revisions
 * Inspect immutable note revisions (FR-070, US-023 AC 4).
 */
export async function fetchWorkspaceNoteRevisions(
  teamId: string
): Promise<{
  teamId: string;
  note: WorkspaceNoteView | null;
  revisions: WorkspaceNoteRevisionView[];
}> {
  return authWorkspaceCall(() =>
    authFetch(`/api/teams/${encodeURIComponent(teamId)}/workspace/revisions`, {
      method: 'GET',
    })
  );
}
