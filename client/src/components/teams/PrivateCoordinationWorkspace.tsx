import React, { useState, useEffect, useCallback } from 'react';
import type { TeamMembershipRole } from './teamTypes';
import {
  fetchPrivateTeamWorkspace,
  updateWorkspaceExternalLinks,
  saveWorkspaceSharedNote,
  validateWorkspaceLinksDraft,
  validateWorkspaceNoteDraft,
  TeamWorkspaceApiError,
  type PrivateTeamWorkspaceView,
  type WorkspaceExternalLink,
  type WorkspaceConflictDetails,
  WORKSPACE_MAX_LINKS,
  WORKSPACE_NOTE_MAX_LENGTH,
} from './teamWorkspaceApi';
import { renderSafeMarkdown } from './workspaceMarkdown';
import { isValidHttpsPortfolioUrl } from '../profile/profileValidation';

export interface PrivateCoordinationWorkspaceProps {
  teamId: string;
  viewerRole?: TeamMembershipRole | null;
  autoLoad?: boolean;
}

export const SHARED_CONTACT_NOTICE =
  'Shared contact handle is visible only to confirmed teammates in your locked team workspace.';

export const EXTERNAL_LINKS_NOTICE =
  'External coordination links are self-managed by the team owner. HackMatch does not provision external tools or provide live chat/video in this workspace.';

export function PrivateCoordinationWorkspace({
  teamId,
  viewerRole,
  autoLoad = true,
}: PrivateCoordinationWorkspaceProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(autoLoad);
  const [workspace, setWorkspace] = useState<PrivateTeamWorkspaceView | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // External Links state
  const [isEditingLinks, setIsEditingLinks] = useState(false);
  const [linksDraft, setLinksDraft] = useState<
    Array<{ label: string; url: string }>
  >([]);
  const [linksErrors, setLinksErrors] = useState<Record<string, string>>({});
  const [linksStatus, setLinksStatus] = useState<string | null>(null);
  const [isSavingLinks, setIsSavingLinks] = useState(false);

  // Shared Note state
  const [noteContent, setNoteContent] = useState('');
  const [noteExpectedVersion, setNoteExpectedVersion] = useState(0);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteConflict, setNoteConflict] =
    useState<WorkspaceConflictDetails | null>(null);
  const [inspectedRevisionVersion, setInspectedRevisionVersion] = useState<
    number | null
  >(null);

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const data = await fetchPrivateTeamWorkspace(teamId);
      setWorkspace(data);
      setLinksDraft(
        data.links.map((l) => ({ label: l.label, url: l.url }))
      );
      if (data.note) {
        setNoteContent(data.note.content);
        setNoteExpectedVersion(data.note.version);
      } else {
        setNoteContent('');
        setNoteExpectedVersion(0);
      }
      setNoteConflict(null);
    } catch (err) {
      if (err instanceof TeamWorkspaceApiError) {
        setFetchError(err.message);
      } else if (err instanceof Error) {
        setFetchError(err.message);
      } else {
        setFetchError('Failed to load team workspace.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (isOpen && !workspace && !isLoading && !fetchError) {
      loadWorkspace();
    }
  }, [isOpen, workspace, isLoading, fetchError, loadWorkspace]);

  const effectiveIsOwner =
    viewerRole === 'Owner' || (workspace ? workspace.isOwner : false);

  const handleOpenWorkspace = () => {
    setIsOpen(true);
    if (!workspace) {
      loadWorkspace();
    }
  };

  // -------------------------------------------------------------------------
  // External Links Handlers
  // -------------------------------------------------------------------------
  const handleAddLinkRow = () => {
    if (linksDraft.length >= WORKSPACE_MAX_LINKS) return;
    setLinksDraft((prev) => [...prev, { label: '', url: '' }]);
    setLinksStatus(null);
  };

  const handleRemoveLinkRow = (index: number) => {
    setLinksDraft((prev) => prev.filter((_, i) => i !== index));
    setLinksErrors({});
    setLinksStatus(null);
  };

  const handleLinkChange = (
    index: number,
    field: 'label' | 'url',
    value: string
  ) => {
    setLinksDraft((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
    setLinksStatus(null);
  };

  const handleSaveLinks = async () => {
    setLinksErrors({});
    setLinksStatus(null);

    const validation = validateWorkspaceLinksDraft(linksDraft);
    if (!validation.ok) {
      setLinksErrors(validation.errors);
      return;
    }

    setIsSavingLinks(true);
    try {
      const updated = await updateWorkspaceExternalLinks(
        teamId,
        validation.sanitized
      );
      setLinksDraft(
        updated.links.map((l: WorkspaceExternalLink) => ({
          label: l.label,
          url: l.url,
        }))
      );
      if (workspace) {
        setWorkspace({ ...workspace, links: updated.links });
      }
      setIsEditingLinks(false);
      setLinksStatus('External links updated successfully.');
    } catch (err) {
      if (err instanceof TeamWorkspaceApiError) {
        if (err.errors) {
          setLinksErrors(err.errors);
        } else {
          setLinksErrors({ _form: err.message });
        }
      } else if (err instanceof Error) {
        setLinksErrors({ _form: err.message });
      } else {
        setLinksErrors({ _form: 'Failed to update external links.' });
      }
    } finally {
      setIsSavingLinks(false);
    }
  };

  // -------------------------------------------------------------------------
  // Shared Note Handlers
  // -------------------------------------------------------------------------
  const handleSaveNote = async () => {
    setNoteError(null);
    setNoteStatus(null);
    setNoteConflict(null);

    const validation = validateWorkspaceNoteDraft(
      noteContent,
      noteExpectedVersion
    );
    if (!validation.ok) {
      setNoteError(
        validation.errors.content ||
          validation.errors.expectedVersion ||
          'Validation failed.'
      );
      return;
    }

    setIsSavingNote(true);
    try {
      const result = await saveWorkspaceSharedNote(teamId, {
        content: validation.sanitized.content,
        expectedVersion: validation.sanitized.expectedVersion,
      });

      setNoteContent(result.note.content);
      setNoteExpectedVersion(result.note.version);
      if (workspace) {
        setWorkspace({
          ...workspace,
          note: result.note,
          revisions: result.revisions,
        });
      }
      setNoteStatus(
        `Note saved successfully as Revision v${result.note.version}.`
      );
    } catch (err) {
      if (err instanceof TeamWorkspaceApiError) {
        if (err.status === 409 && err.conflict) {
          setNoteConflict(err.conflict);
          setNoteError(
            err.message ||
              'This note was updated by another teammate. Review the latest revision before saving.'
          );
        } else {
          setNoteError(err.message);
        }
      } else if (err instanceof Error) {
        setNoteError(err.message);
      } else {
        setNoteError('Failed to save shared note.');
      }
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleLoadLatestRevision = () => {
    if (!noteConflict) return;
    if (noteConflict.latestNote) {
      setNoteContent(noteConflict.latestNote.content);
      setNoteExpectedVersion(noteConflict.latestNote.version);
    } else {
      setNoteExpectedVersion(noteConflict.currentVersion);
    }
    setNoteConflict(null);
    setNoteError(null);
    setNoteStatus(
      `Loaded latest Revision v${noteConflict.currentVersion}. You may now re-apply or edit your note.`
    );
  };

  // -------------------------------------------------------------------------
  // Unopened / Compact Callout State
  // -------------------------------------------------------------------------
  if (!isOpen) {
    return (
      <div
        className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        data-testid="private-coordination-workspace-card"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <h3 className="font-semibold text-emerald-950 text-base">
              Private Team Coordination Workspace
            </h3>
          </div>
          <p className="text-sm text-emerald-800 leading-relaxed">
            Coordinate with confirmed teammates, share external communication/design
            links, and collaborate on project concept notes before the hackathon begins.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenWorkspace}
          data-testid="open-private-workspace-btn"
          className="shrink-0 px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-medium rounded-md shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-1"
        >
          Open Private Coordination Workspace
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Loading & Error States
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-white rounded-lg border border-cream-200 p-8 shadow-sm text-center space-y-3"
      >
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-forest-700" />
        <p className="text-sm text-ink-600 font-medium">
          Loading private team workspace...
        </p>
      </div>
    );
  }

  if (fetchError || !workspace) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="bg-red-50 border border-red-200 rounded-lg p-6 space-y-4"
      >
        <div className="space-y-1">
          <h3 className="font-semibold text-red-900 text-base">
            Workspace Unavailable
          </h3>
          <p className="text-sm text-red-800">
            {fetchError || 'Unable to load workspace data.'}
          </p>
        </div>
        <button
          type="button"
          onClick={loadWorkspace}
          className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-medium rounded-md shadow-sm transition-colors"
        >
          Reload Workspace
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main Workspace Presentation
  // -------------------------------------------------------------------------
  return (
    <div
      className="bg-white rounded-lg border border-cream-200 p-6 shadow-sm space-y-8"
      data-testid="private-coordination-workspace"
    >
      {/* Header */}
      <div className="border-b border-cream-200 pb-4 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-emerald-600" />
            <h2 className="text-xl font-bold text-ink-950">
              Private Coordination Workspace
            </h2>
          </div>
          <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-900 rounded-full border border-emerald-300">
            Locked Team Roster
          </span>
        </div>
        <p className="text-sm text-ink-600">
          Private space for confirmed members of{' '}
          <strong className="text-ink-900">{workspace.teamName}</strong>.
          Coordinate external communication tools, teammate contact handles, and
          collaborative concept notes.
        </p>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 1. Teammate Contacts & Permitted Handles (FR-068, US-023 AC 2)     */}
      {/* ------------------------------------------------------------------- */}
      <section
        className="space-y-4"
        data-testid="workspace-contacts-section"
        aria-labelledby="teammates-heading"
      >
        <div className="space-y-1">
          <h3
            id="teammates-heading"
            className="text-base font-semibold text-ink-900 flex items-center gap-2"
          >
            <span>Confirmed Teammates & Contact Handles</span>
            <span className="text-xs text-ink-500 font-normal">
              ({workspace.teammates.length} confirmed)
            </span>
          </h3>
          <p className="text-xs text-ink-600 bg-cream-50 p-2.5 rounded border border-cream-200">
            {SHARED_CONTACT_NOTICE}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workspace.teammates.map((member) => (
            <div
              key={member.participantId}
              className="p-4 rounded-lg border border-cream-200 bg-cream-50/40 space-y-2.5"
              data-testid={`teammate-card-${member.participantId}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-ink-900 text-sm">
                    {member.displayName}
                  </h4>
                  {member.handle && (
                    <span className="text-xs text-ink-600 font-mono">
                      @{member.handle}
                    </span>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    member.teamRole === 'Owner'
                      ? 'bg-amber-100 text-amber-900 border border-amber-200'
                      : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                  }`}
                >
                  {member.teamRole}
                </span>
              </div>

              <div className="text-xs space-y-1 text-ink-700">
                {member.primaryRole && (
                  <div>
                    <span className="font-medium text-ink-900">Role:</span>{' '}
                    {member.primaryRole}
                  </div>
                )}
                {member.institution && (
                  <div>
                    <span className="font-medium text-ink-900">Institution:</span>{' '}
                    {member.institution}
                  </div>
                )}
                <div>
                  <span className="font-medium text-ink-900">Shared Contact:</span>{' '}
                  {member.sharedContactHandle ? (
                    <span className="font-mono text-emerald-900 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      {member.sharedContactHandle}
                    </span>
                  ) : (
                    <span className="text-ink-400 italic">
                      No shared contact handle provided
                    </span>
                  )}
                </div>
              </div>

              {/* Portfolio Links */}
              {member.portfolioLinks && member.portfolioLinks.length > 0 && (
                <div className="pt-2 border-t border-cream-200/70 text-xs space-y-1">
                  <span className="font-medium text-ink-800">Portfolio & Profiles:</span>
                  <div className="flex flex-wrap gap-2">
                    {member.portfolioLinks
                      .filter((link) => isValidHttpsPortfolioUrl(link.url))
                      .map((link, idx) => (
                        <a
                          key={`portfolio-${idx}`}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-forest-700 underline hover:text-forest-900 font-medium"
                        >
                          {link.label || link.url}
                        </a>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------- */}
      {/* 2. Shared External Tool Links (FR-069, US-023 AC 3)                 */}
      {/* ------------------------------------------------------------------- */}
      <section
        className="space-y-4 pt-4 border-t border-cream-200"
        data-testid="workspace-links-section"
        aria-labelledby="external-links-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3
              id="external-links-heading"
              className="text-base font-semibold text-ink-900"
            >
              Shared External Tool Links
            </h3>
            <p className="text-xs text-ink-600">{EXTERNAL_LINKS_NOTICE}</p>
          </div>
          {effectiveIsOwner && !isEditingLinks && (
            <button
              type="button"
              onClick={() => {
                setIsEditingLinks(true);
                setLinksStatus(null);
                setLinksErrors({});
              }}
              data-testid="edit-links-btn"
              className="px-3 py-1.5 text-xs font-medium text-forest-800 bg-forest-50 hover:bg-forest-100 rounded-md border border-forest-200 transition-colors"
            >
              Edit External Links
            </button>
          )}
        </div>

        {linksStatus && (
          <div
            role="status"
            aria-live="polite"
            className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-md"
          >
            {linksStatus}
          </div>
        )}

        {linksErrors._form && (
          <div
            role="alert"
            aria-live="assertive"
            className="p-3 bg-red-50 border border-red-200 text-red-900 text-xs rounded-md"
          >
            {linksErrors._form}
          </div>
        )}

        {/* Links Display (when not editing) */}
        {!isEditingLinks && (
          <div className="space-y-2">
            {workspace.links.length === 0 ? (
              <p className="text-sm text-ink-500 italic bg-cream-50/50 p-4 rounded-md border border-dashed border-cream-300">
                No external coordination links have been added by the team owner yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {workspace.links.map((link) => (
                  <a
                    key={link.id || link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-md border border-cream-200 hover:border-forest-300 bg-white hover:bg-forest-50/20 transition-all flex items-center justify-between group"
                  >
                    <span className="text-sm font-semibold text-ink-900 group-hover:text-forest-900">
                      {link.label}
                    </span>
                    <span className="text-xs text-forest-700 underline truncate max-w-[50%]">
                      {link.url}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Owner Links Editor (FR-069, US-023 AC 3) */}
        {isEditingLinks && effectiveIsOwner && (
          <div className="space-y-4 bg-cream-50/50 p-4 rounded-lg border border-cream-300">
            <div className="space-y-3">
              {linksDraft.map((link, idx) => (
                <div
                  key={`link-row-${idx}`}
                  className="p-3 bg-white rounded-md border border-cream-200 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink-800">
                      Link #{idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveLinkRow(idx)}
                      data-testid={`delete-link-btn-${idx}`}
                      className="text-xs text-red-700 hover:text-red-900 font-medium"
                    >
                      Delete Link
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor={`workspace-link-label-${idx}`}
                        className="block text-xs font-medium text-ink-800 mb-1"
                      >
                        Link #{idx + 1} Label
                      </label>
                      <input
                        id={`workspace-link-label-${idx}`}
                        type="text"
                        value={link.label}
                        onChange={(e) =>
                          handleLinkChange(idx, 'label', e.target.value)
                        }
                        placeholder="e.g. GitHub Repo, Figma Board, Discord"
                        className="w-full text-xs px-3 py-1.5 border border-cream-300 rounded focus:ring-1 focus:ring-forest-600 focus:outline-none"
                      />
                      {linksErrors[`link_${idx}_label`] && (
                        <p
                          role="alert"
                          className="text-xs text-red-700 mt-0.5"
                        >
                          {linksErrors[`link_${idx}_label`]}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor={`workspace-link-url-${idx}`}
                        className="block text-xs font-medium text-ink-800 mb-1"
                      >
                        Link #{idx + 1} URL
                      </label>
                      <input
                        id={`workspace-link-url-${idx}`}
                        type="url"
                        value={link.url}
                        onChange={(e) =>
                          handleLinkChange(idx, 'url', e.target.value)
                        }
                        placeholder="https://..."
                        className="w-full text-xs px-3 py-1.5 border border-cream-300 rounded focus:ring-1 focus:ring-forest-600 focus:outline-none"
                      />
                      {linksErrors[`link_${idx}_url`] && (
                        <p
                          role="alert"
                          className="text-xs text-red-700 mt-0.5"
                        >
                          {linksErrors[`link_${idx}_url`]}
                        </p>
                      )}
                    </div>
                  </div>

                  {linksErrors[`link_${idx}`] && (
                    <p role="alert" className="text-xs text-red-700">
                      {linksErrors[`link_${idx}`]}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={handleAddLinkRow}
                disabled={linksDraft.length >= WORKSPACE_MAX_LINKS}
                data-testid="add-link-row-btn"
                className="px-3 py-1.5 text-xs font-medium text-ink-800 bg-white hover:bg-cream-100 rounded border border-cream-300 transition-colors disabled:opacity-50"
              >
                Add Link Row ({linksDraft.length}/{WORKSPACE_MAX_LINKS})
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingLinks(false);
                    setLinksDraft(
                      workspace.links.map((l) => ({
                        label: l.label,
                        url: l.url,
                      }))
                    );
                    setLinksErrors({});
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-ink-700 hover:text-ink-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveLinks}
                  disabled={isSavingLinks}
                  data-testid="save-external-links-btn"
                  className="px-4 py-1.5 text-xs font-medium bg-forest-800 hover:bg-forest-900 text-white rounded shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSavingLinks ? 'Saving...' : 'Save External Links'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------- */}
      {/* 3. Shared Concept Note & Revision History (FR-070, US-023 AC 4)     */}
      {/* ------------------------------------------------------------------- */}
      <section
        className="space-y-5 pt-4 border-t border-cream-200"
        data-testid="workspace-note-section"
        aria-labelledby="shared-note-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3
              id="shared-note-heading"
              className="text-base font-semibold text-ink-900"
            >
              Shared Project Concept Note
            </h3>
            <p className="text-xs text-ink-600">
              Any confirmed teammate can read and edit this concept note. Changes
              create immutable revisions with author and timestamp.
            </p>
          </div>
          {workspace.note && (
            <span
              data-testid="workspace-note-version"
              className="px-2.5 py-1 text-xs font-semibold bg-forest-100 text-forest-900 rounded-full border border-forest-300"
            >
              Revision v{workspace.note.version}
            </span>
          )}
        </div>

        {/* Note Status / Alert Banners */}
        {noteStatus && (
          <div
            role="status"
            aria-live="polite"
            className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-md"
          >
            {noteStatus}
          </div>
        )}

        {/* 409 Stale-Save Conflict Banner (US-023 AC 4 / NR-010) */}
        {noteConflict && (
          <div
            role="alert"
            aria-live="assertive"
            data-testid="workspace-note-conflict-alert"
            className="p-4 bg-amber-50 border-2 border-amber-300 rounded-lg space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <span className="text-amber-800 font-bold text-base">⚠️</span>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-amber-950">
                  Stale-Save Conflict Detected
                </h4>
                <p className="text-xs text-amber-900 leading-relaxed">
                  Another teammate saved an updated note (Revision v
                  {noteConflict.currentVersion}) while you were editing (your loaded
                  version was v{noteConflict.expectedVersion}). Your unsaved edits
                  have been preserved below so you do not lose any work.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleLoadLatestRevision}
                data-testid="workspace-conflict-load-latest-btn"
                className="px-3 py-1.5 bg-amber-800 hover:bg-amber-900 text-white text-xs font-medium rounded shadow-sm transition-colors"
              >
                Load Latest Server Revision (v{noteConflict.currentVersion})
              </button>
            </div>
          </div>
        )}

        {noteError && !noteConflict && (
          <div
            role="alert"
            aria-live="assertive"
            className="p-3 bg-red-50 border border-red-200 text-red-900 text-xs rounded-md"
          >
            {noteError}
          </div>
        )}

        {/* Live Note Preview */}
        {workspace.note && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-600">
              <span className="font-semibold uppercase tracking-wider text-[11px] text-ink-500">
                Current Published Note
              </span>
              <span>
                Last updated by{' '}
                <strong className="text-ink-800">
                  {workspace.note.author_display_name}
                </strong>{' '}
                on {new Date(workspace.note.updated_at).toLocaleString()}
              </span>
            </div>
            <div
              className="p-4 rounded-lg border border-cream-200 bg-cream-50/40"
              data-testid="workspace-note-preview"
            >
              {renderSafeMarkdown(workspace.note.content)}
            </div>
          </div>
        )}

        {/* Note Editor */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="workspace-note-content"
              className="block text-xs font-semibold text-ink-900 uppercase tracking-wider"
            >
              Edit Shared Note (Markdown)
            </label>
            <span className="text-xs text-ink-500">
              {noteContent.length}/{WORKSPACE_NOTE_MAX_LENGTH} chars
            </span>
          </div>

          <textarea
            id="workspace-note-content"
            data-testid="workspace-note-textarea"
            rows={8}
            value={noteContent}
            onChange={(e) => {
              setNoteContent(e.target.value);
              setNoteStatus(null);
            }}
            placeholder="# Project Concept Notes&#10;&#10;Write architecture notes, task ideas, and tool links in Markdown..."
            className="w-full text-xs font-mono p-3 border border-cream-300 rounded-md focus:ring-1 focus:ring-forest-600 focus:outline-none bg-white leading-relaxed"
          />

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleSaveNote}
              disabled={isSavingNote}
              data-testid="workspace-note-save-btn"
              className="px-4 py-2 bg-forest-800 hover:bg-forest-900 text-white text-xs font-medium rounded-md shadow-sm transition-colors disabled:opacity-50"
            >
              {isSavingNote ? 'Saving Note...' : 'Save Shared Note'}
            </button>
          </div>
        </div>

        {/* Revision History Log */}
        {workspace.revisions && workspace.revisions.length > 0 && (
          <div
            className="space-y-3 pt-4 border-t border-cream-200"
            data-testid="workspace-revision-list"
          >
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-700">
              Revision History ({workspace.revisions.length})
            </h4>

            <div className="space-y-2">
              {workspace.revisions.map((rev) => (
                <div
                  key={rev.id || `rev-${rev.version}`}
                  className="p-3 rounded-md border border-cream-200 bg-cream-50/20 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-900">
                        Revision v{rev.version}
                      </span>
                      <span className="text-ink-600">
                        by{' '}
                        <strong className="text-ink-800">
                          {rev.author_display_name}
                        </strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-ink-500">
                        {new Date(rev.created_at).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setInspectedRevisionVersion((cur) =>
                            cur === rev.version ? null : rev.version
                          )
                        }
                        data-testid={`inspect-revision-${rev.version}`}
                        className="text-xs font-medium text-forest-700 hover:text-forest-900 underline"
                      >
                        {inspectedRevisionVersion === rev.version
                          ? 'Hide Revision'
                          : 'Inspect Revision'}
                      </button>
                    </div>
                  </div>

                  {inspectedRevisionVersion === rev.version && (
                    <div
                      className="p-3 mt-2 rounded bg-white border border-cream-200"
                      data-testid={`inspected-revision-content-${rev.version}`}
                    >
                      {renderSafeMarkdown(rev.content)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
