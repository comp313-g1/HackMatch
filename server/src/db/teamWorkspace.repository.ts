/**
 * US-023 / #US-023-T1: Team workspace database repository.
 *
 * Implements data access for private coordination workspaces, owner-managed external
 * tool links, shared markdown notes, and append-only revisions (FR-068, FR-069, FR-070).
 */

import { getSupabaseClient } from './client.js';
import type {
  SaveWorkspaceNoteInput,
  TeamWorkspaceLink,
  TeamWorkspaceNote,
  TeamWorkspaceNoteRevision,
  TeamWorkspaceRecord,
  UpsertWorkspaceLinkInput,
} from './types.js';

export interface ITeamWorkspaceRepository {
  findWorkspaceByTeamId(teamId: string): Promise<TeamWorkspaceRecord | null>;
  listLinksByTeamId(teamId: string): Promise<TeamWorkspaceLink[]>;
  replaceLinksForTeam(
    teamId: string,
    actorId: string,
    links: UpsertWorkspaceLinkInput[]
  ): Promise<TeamWorkspaceLink[]>;
  getNoteByTeamId(teamId: string): Promise<TeamWorkspaceNote | null>;
  listRevisionsByTeamId(
    teamId: string,
    limit?: number
  ): Promise<TeamWorkspaceNoteRevision[]>;
  saveNoteWithOptimisticLock(
    input: SaveWorkspaceNoteInput
  ): Promise<{ note: TeamWorkspaceNote; revision: TeamWorkspaceNoteRevision }>;
  pseudonymizeAuthorIdentity(
    participantId: string,
    pseudonym?: string
  ): Promise<{ notesUpdated: number; revisionsUpdated: number }>;
}

const DEFAULT_REVISION_LIMIT = 50;
const MAX_REVISION_LIMIT = 100;

export const teamWorkspaceRepository: ITeamWorkspaceRepository = {
  async findWorkspaceByTeamId(teamId: string): Promise<TeamWorkspaceRecord | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_workspaces')
      .select('*')
      .eq('team_id', teamId)
      .maybeSingle();

    if (error) throw error;
    return (data as TeamWorkspaceRecord | null) ?? null;
  },

  async listLinksByTeamId(teamId: string): Promise<TeamWorkspaceLink[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_workspace_links')
      .select('*')
      .eq('team_id', teamId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as TeamWorkspaceLink[];
  },

  async replaceLinksForTeam(
    teamId: string,
    actorId: string,
    links: UpsertWorkspaceLinkInput[]
  ): Promise<TeamWorkspaceLink[]> {
    const client = getSupabaseClient();
    const formattedLinks = links.map((link, index) => ({
      label: link.label,
      url: link.url,
      display_order: link.display_order ?? index,
    }));

    const { error } = await client.rpc('replace_team_workspace_links', {
      p_actor: actorId,
      p_team: teamId,
      p_links: formattedLinks,
    });

    if (error) throw error;
    return this.listLinksByTeamId(teamId);
  },

  async getNoteByTeamId(teamId: string): Promise<TeamWorkspaceNote | null> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('team_workspace_notes')
      .select('*')
      .eq('team_id', teamId)
      .maybeSingle();

    if (error) throw error;
    return (data as TeamWorkspaceNote | null) ?? null;
  },

  async listRevisionsByTeamId(
    teamId: string,
    limit = DEFAULT_REVISION_LIMIT
  ): Promise<TeamWorkspaceNoteRevision[]> {
    const client = getSupabaseClient();
    const safeLimit = Math.min(Math.max(1, limit), MAX_REVISION_LIMIT);
    const { data, error } = await client
      .from('team_workspace_note_revisions')
      .select('*')
      .eq('team_id', teamId)
      .order('version', { ascending: false })
      .limit(safeLimit);

    if (error) throw error;
    return (data || []) as TeamWorkspaceNoteRevision[];
  },

  async saveNoteWithOptimisticLock(
    input: SaveWorkspaceNoteInput
  ): Promise<{ note: TeamWorkspaceNote; revision: TeamWorkspaceNoteRevision }> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('save_team_workspace_note', {
      p_actor: input.actorId,
      p_team: input.teamId,
      p_content: input.content,
      p_expected_version: input.expectedVersion,
      p_author_display_name: input.authorDisplayName,
    });

    if (error) throw error;
    return data as {
      note: TeamWorkspaceNote;
      revision: TeamWorkspaceNoteRevision;
    };
  },

  async pseudonymizeAuthorIdentity(
    participantId: string,
    pseudonym = 'Former Member'
  ): Promise<{ notesUpdated: number; revisionsUpdated: number }> {
    const client = getSupabaseClient();
    const now = new Date().toISOString();

    const { data: updatedNotes, error: notesErr } = await client
      .from('team_workspace_notes')
      .update({
        author_display_name: pseudonym,
        author_pseudonymized_at: now,
        updated_by: null,
      })
      .eq('updated_by', participantId)
      .select('team_id');

    if (notesErr) throw notesErr;

    const { data: updatedRevisions, error: revsErr } = await client
      .from('team_workspace_note_revisions')
      .update({
        author_display_name: pseudonym,
        author_pseudonymized_at: now,
        author_id: null,
      })
      .eq('author_id', participantId)
      .select('id');

    if (revsErr) throw revsErr;

    return {
      notesUpdated: updatedNotes ? updatedNotes.length : 0,
      revisionsUpdated: updatedRevisions ? updatedRevisions.length : 0,
    };
  },
};
