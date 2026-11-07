/**
 * US-023 / #US-023-T1: Team private coordination workspace models and validation helpers.
 *
 * Source of truth: migration 0046_create_team_workspace_models.sql.
 * Supports locked-team external links, shared markdown notes, and revision history (FR-068, FR-069, FR-070).
 */

export const WORKSPACE_LINK_LABEL_MAX_LENGTH = 80;
export const WORKSPACE_LINK_URL_MAX_LENGTH = 2048;
export const WORKSPACE_MAX_LINKS = 10;
export const WORKSPACE_NOTE_MAX_LENGTH = 10000;
export const WORKSPACE_AUTHOR_DISPLAY_MAX_LENGTH = 120;

export interface WorkspaceLinkModelFields {
  id: string;
  teamId: string;
  label: string;
  url: string;
  displayOrder: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNoteModelFields {
  teamId: string;
  content: string;
  version: number;
  updatedBy: string | null;
  authorDisplayName: string | null;
  authorPseudonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNoteRevisionModelFields {
  id: string;
  teamId: string;
  version: number;
  content: string;
  authorId: string | null;
  authorDisplayName: string;
  authorPseudonymizedAt: string | null;
  createdAt: string;
}

/**
 * Trim; empty / whitespace-only -> null.
 */
export function normalizeWorkspaceLinkLabel(
  label: string | null | undefined
): string | null {
  if (label == null) return null;
  const trimmed = label.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Validates and normalizes an external tool URL.
 * Strictly requires https:// scheme, length > 8 and <= 2048, and valid URL syntax.
 * Rejects http://, javascript:, mailto:, ftp:, data:, etc. (FR-069, US-023 AC 3).
 */
export function normalizeWorkspaceLinkUrl(
  url: string | null | undefined
): string | null {
  if (url == null) return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return null;
  if (trimmed.length <= 8 || trimmed.length > WORKSPACE_LINK_URL_MAX_LENGTH) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Trim author display name; empty / whitespace-only -> null.
 */
export function normalizeWorkspaceAuthorDisplayName(
  name: string | null | undefined
): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Normalizes note content.
 * Empty or whitespace-only -> null.
 * Preserves intentional internal markdown formatting/newlines.
 */
export function normalizeWorkspaceNoteContent(
  content: string | null | undefined
): string | null {
  if (content == null) return null;
  const trimmed = content.trim();
  return trimmed.length === 0 ? null : content;
}

export function isWorkspaceLinkLabelTooLong(
  label: string | null | undefined
): boolean {
  const normalized = normalizeWorkspaceLinkLabel(label);
  return normalized != null && normalized.length > WORKSPACE_LINK_LABEL_MAX_LENGTH;
}

export function isWorkspaceLinkUrlTooLong(
  url: string | null | undefined
): boolean {
  if (url == null) return false;
  return url.trim().length > WORKSPACE_LINK_URL_MAX_LENGTH;
}

export function isWorkspaceNoteTooLong(
  content: string | null | undefined
): boolean {
  if (content == null) return false;
  return content.length > WORKSPACE_NOTE_MAX_LENGTH;
}

export function isValidExpectedVersion(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= 0;
}

export function isValidWorkspaceLinkCount(links: unknown): boolean {
  return Array.isArray(links) && links.length <= WORKSPACE_MAX_LINKS;
}
