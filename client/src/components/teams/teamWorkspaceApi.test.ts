import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateWorkspaceLinksDraft,
  validateWorkspaceNoteDraft,
  fetchPrivateTeamWorkspace,
  updateWorkspaceExternalLinks,
  saveWorkspaceSharedNote,
  fetchWorkspaceNoteRevisions,
  TeamWorkspaceApiError,
  WORKSPACE_LINK_LABEL_MAX_LENGTH,
  WORKSPACE_LINK_URL_MAX_LENGTH,
  WORKSPACE_MAX_LINKS,
  WORKSPACE_NOTE_MAX_LENGTH,
} from './teamWorkspaceApi';
import * as authFetchModule from '../../config/authFetch';

describe('teamWorkspaceApi client module (US-023 / #US-023-T5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateWorkspaceLinksDraft', () => {
    it('validates and sanitizes valid links', () => {
      const res = validateWorkspaceLinksDraft([
        { label: '  GitHub Repo  ', url: 'https://github.com/org/repo  ' },
        { label: 'Figma Board', url: 'https://figma.com/file/123' },
      ]);

      expect(res.ok).toBe(true);
      expect(res.errors).toEqual({});
      expect(res.sanitized).toEqual([
        { label: 'GitHub Repo', url: 'https://github.com/org/repo' },
        { label: 'Figma Board', url: 'https://figma.com/file/123' },
      ]);
    });

    it('rejects more than 10 links', () => {
      const links = Array.from({ length: 11 }, (_, i) => ({
        label: `Link ${i}`,
        url: `https://example.com/${i}`,
      }));
      const res = validateWorkspaceLinksDraft(links);
      expect(res.ok).toBe(false);
      expect(res.errors._form).toBe(
        `You can specify at most ${WORKSPACE_MAX_LINKS} external links.`
      );
    });

    it('rejects missing or oversized label', () => {
      const emptyLabel = validateWorkspaceLinksDraft([
        { label: '   ', url: 'https://github.com/repo' },
      ]);
      expect(emptyLabel.ok).toBe(false);
      expect(emptyLabel.errors.link_0_label).toBe('Link #1 label is required.');

      const longLabel = validateWorkspaceLinksDraft([
        {
          label: 'a'.repeat(WORKSPACE_LINK_LABEL_MAX_LENGTH + 1),
          url: 'https://github.com/repo',
        },
      ]);
      expect(longLabel.ok).toBe(false);
      expect(longLabel.errors.link_0_label).toBe(
        `Link #1 label cannot exceed ${WORKSPACE_LINK_LABEL_MAX_LENGTH} characters.`
      );
    });

    it('rejects missing, non-HTTPS, or oversized URL', () => {
      const emptyUrl = validateWorkspaceLinksDraft([
        { label: 'Repo', url: '   ' },
      ]);
      expect(emptyUrl.ok).toBe(false);
      expect(emptyUrl.errors.link_0_url).toBe('Link #1 URL is required.');

      const httpUrl = validateWorkspaceLinksDraft([
        { label: 'Repo', url: 'http://github.com/repo' },
      ]);
      expect(httpUrl.ok).toBe(false);
      expect(httpUrl.errors.link_0_url).toBe(
        'Link #1 URL must be a valid HTTPS URL (e.g. https://github.com/team/repo).'
      );

      const longUrl = validateWorkspaceLinksDraft([
        {
          label: 'Repo',
          url: `https://example.com/${'a'.repeat(WORKSPACE_LINK_URL_MAX_LENGTH)}`,
        },
      ]);
      expect(longUrl.ok).toBe(false);
      expect(longUrl.errors.link_0_url).toBe(
        `Link #1 URL cannot exceed ${WORKSPACE_LINK_URL_MAX_LENGTH} characters.`
      );
    });

    it('rejects duplicate links by case-insensitive label and url', () => {
      const res = validateWorkspaceLinksDraft([
        { label: 'GitHub', url: 'https://github.com/org/repo' },
        { label: 'github', url: 'https://github.com/org/repo' },
      ]);
      expect(res.ok).toBe(false);
      expect(res.errors.link_1).toBe(
        'Link #2 is a duplicate of another link in this list.'
      );
    });
  });

  describe('validateWorkspaceNoteDraft', () => {
    it('validates and sanitizes valid note content and expectedVersion', () => {
      const res = validateWorkspaceNoteDraft(
        '# Shared Note\r\n\r\n- Idea 1\r\n- Idea 2  ',
        2
      );
      expect(res.ok).toBe(true);
      expect(res.errors).toEqual({});
      expect(res.sanitized).toEqual({
        content: '# Shared Note\n\n- Idea 1\n- Idea 2',
        expectedVersion: 2,
      });
    });

    it('rejects empty or whitespace-only note content', () => {
      const res = validateWorkspaceNoteDraft('   \r\n  ', 0);
      expect(res.ok).toBe(false);
      expect(res.errors.content).toBe('Note content cannot be empty.');
    });

    it('rejects note content exceeding 10,000 characters', () => {
      const longContent = 'x'.repeat(WORKSPACE_NOTE_MAX_LENGTH + 1);
      const res = validateWorkspaceNoteDraft(longContent, 1);
      expect(res.ok).toBe(false);
      expect(res.errors.content).toBe(
        `Note content cannot exceed ${WORKSPACE_NOTE_MAX_LENGTH} characters.`
      );
    });

    it('rejects invalid or negative expectedVersion', () => {
      const negativeRes = validateWorkspaceNoteDraft('# Note', -1);
      expect(negativeRes.ok).toBe(false);
      expect(negativeRes.errors.expectedVersion).toBe(
        'expectedVersion must be a non-negative integer (e.g. 0, 1, 2).'
      );

      const floatRes = validateWorkspaceNoteDraft('# Note', 1.5 as number);
      expect(floatRes.ok).toBe(false);
      expect(floatRes.errors.expectedVersion).toBe(
        'expectedVersion must be a non-negative integer (e.g. 0, 1, 2).'
      );
    });
  });

  describe('fetchPrivateTeamWorkspace', () => {
    it('fetches workspace data for confirmed members', async () => {
      const mockWorkspace = {
        teamId: 'team-1',
        teamName: 'Alpha Team',
        recruitmentStatus: 'Locked',
        lockedAt: '2026-10-25T12:00:00Z',
        viewerRole: 'Member',
        isOwner: false,
        teammates: [],
        links: [],
        note: null,
        revisions: [],
      };

      vi.spyOn(authFetchModule, 'authFetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockWorkspace), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await fetchPrivateTeamWorkspace('team-1');
      expect(res.teamName).toBe('Alpha Team');
      expect(res.viewerRole).toBe('Member');
    });

    it('throws TeamWorkspaceApiError on network failure', async () => {
      vi.spyOn(authFetchModule, 'authFetch').mockRejectedValueOnce(
        new Error('Failed to fetch')
      );

      await expect(fetchPrivateTeamWorkspace('team-1')).rejects.toThrow(
        TeamWorkspaceApiError
      );
    });
  });

  describe('updateWorkspaceExternalLinks', () => {
    it('sends PUT to links endpoint and returns updated links', async () => {
      const updatedLinks = [
        { label: 'Discord', url: 'https://discord.gg/example' },
      ];

      vi.spyOn(authFetchModule, 'authFetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            teamId: 'team-1',
            links: updatedLinks,
            updatedAt: '2026-10-25T12:00:00Z',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      const res = await updateWorkspaceExternalLinks('team-1', updatedLinks);
      expect(res.links).toHaveLength(1);
      expect(res.links[0].label).toBe('Discord');
    });
  });

  describe('saveWorkspaceSharedNote & Stale-Save Conflict Handling (US-023 AC 4 / FR-070)', () => {
    it('successfully saves shared note when versions match', async () => {
      const mockResult = {
        teamId: 'team-1',
        note: {
          team_id: 'team-1',
          content: '# New Concept',
          version: 1,
          updated_by: 'user-1',
          author_display_name: 'Teammate',
          author_pseudonymized_at: null,
          created_at: '2026-10-25T12:00:00Z',
          updated_at: '2026-10-25T12:00:00Z',
        },
        revision: {
          id: 'rev-1',
          team_id: 'team-1',
          version: 1,
          content: '# New Concept',
          author_id: 'user-1',
          author_display_name: 'Teammate',
          author_pseudonymized_at: null,
          created_at: '2026-10-25T12:00:00Z',
        },
        revisions: [],
      };

      vi.spyOn(authFetchModule, 'authFetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await saveWorkspaceSharedNote('team-1', {
        content: '# New Concept',
        expectedVersion: 0,
      });

      expect(res.note.version).toBe(1);
      expect(res.note.content).toBe('# New Concept');
    });

    it('populates conflict details when server returns 409 WORKSPACE_NOTE_CONFLICT', async () => {
      const conflictPayload = {
        code: 'WORKSPACE_NOTE_CONFLICT',
        error:
          'This note was updated by another teammate since you loaded it. Review the latest revision before saving.',
        details: {
          expectedVersion: 1,
          currentVersion: 2,
          latestNote: {
            team_id: 'team-1',
            content: '# Teammate Updated Concept',
            version: 2,
            updated_by: 'teammate-2',
            author_display_name: 'Teammate B',
            author_pseudonymized_at: null,
            created_at: '2026-10-25T12:00:00Z',
            updated_at: '2026-10-25T12:10:00Z',
          },
          revisions: [
            {
              id: 'rev-2',
              team_id: 'team-1',
              version: 2,
              content: '# Teammate Updated Concept',
              author_id: 'teammate-2',
              author_display_name: 'Teammate B',
              author_pseudonymized_at: null,
              created_at: '2026-10-25T12:10:00Z',
            },
          ],
        },
      };

      vi.spyOn(authFetchModule, 'authFetch').mockResolvedValueOnce(
        new Response(JSON.stringify(conflictPayload), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      let thrownError: TeamWorkspaceApiError | null = null;
      try {
        await saveWorkspaceSharedNote('team-1', {
          content: '# My Stale Save',
          expectedVersion: 1,
        });
      } catch (err) {
        if (err instanceof TeamWorkspaceApiError) {
          thrownError = err;
        }
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError?.status).toBe(409);
      expect(thrownError?.code).toBe('WORKSPACE_NOTE_CONFLICT');
      expect(thrownError?.conflict).toBeDefined();
      expect(thrownError?.conflict?.expectedVersion).toBe(1);
      expect(thrownError?.conflict?.currentVersion).toBe(2);
      expect(thrownError?.conflict?.latestNote?.content).toBe(
        '# Teammate Updated Concept'
      );
      expect(thrownError?.conflict?.revisions).toHaveLength(1);
    });
  });

  describe('fetchWorkspaceNoteRevisions', () => {
    it('fetches revision list and latest note', async () => {
      const mockResult = {
        teamId: 'team-1',
        note: null,
        revisions: [],
      };

      vi.spyOn(authFetchModule, 'authFetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await fetchWorkspaceNoteRevisions('team-1');
      expect(res.teamId).toBe('team-1');
      expect(res.revisions).toEqual([]);
    });
  });
});
