import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import {
  PrivateCoordinationWorkspace,
  SHARED_CONTACT_NOTICE,
  EXTERNAL_LINKS_NOTICE,
} from './PrivateCoordinationWorkspace';
import * as teamWorkspaceApi from './teamWorkspaceApi';
import type {
  PrivateTeamWorkspaceView,
  WorkspaceTeammateContact,
  WorkspaceExternalLink,
  WorkspaceNoteView,
  WorkspaceNoteRevisionView,
} from './teamWorkspaceApi';

describe('PrivateCoordinationWorkspace component (US-023 / #US-023-T6)', () => {
  const sampleTeamId = 'team-uuid-1';

  const mockOwnerContact: WorkspaceTeammateContact = {
    participantId: 'owner-part-1',
    displayName: 'Alice Owner',
    handle: 'aliceowner',
    institution: 'Centennial College',
    primaryRole: 'Frontend',
    teamRole: 'Owner',
    joinedAt: '2026-10-25T12:00:00Z',
    skills: ['TypeScript', 'React'],
    skillsSelfDeclared: true,
    portfolioLinks: [
      {
        url: 'https://github.com/alice',
        label: 'GitHub',
        isSelfDeclared: true,
      },
    ],
    selfDeclaredNotice: 'Skills and links are self-declared.',
    sharedContactHandle: 'alice#1234',
    sharedContactAudienceNotice: SHARED_CONTACT_NOTICE,
    experienceBadge: 'Competitor',
  };

  const mockMemberContact: WorkspaceTeammateContact = {
    participantId: 'member-part-2',
    displayName: 'Bob Member',
    handle: 'bobmember',
    institution: 'University of Toronto',
    primaryRole: 'Backend',
    teamRole: 'Member',
    joinedAt: '2026-10-25T13:00:00Z',
    skills: ['Node.js', 'PostgreSQL'],
    skillsSelfDeclared: true,
    portfolioLinks: [],
    selfDeclaredNotice: 'Skills and links are self-declared.',
    sharedContactHandle: null,
    sharedContactAudienceNotice: SHARED_CONTACT_NOTICE,
    experienceBadge: 'Beginner',
  };

  const mockLinks: WorkspaceExternalLink[] = [
    {
      id: 'link-1',
      label: 'Team GitHub',
      url: 'https://github.com/myteam/hackmatch',
    },
    {
      id: 'link-2',
      label: 'Figma Canvas',
      url: 'https://figma.com/file/xyz',
    },
  ];

  const mockNote: WorkspaceNoteView = {
    team_id: sampleTeamId,
    content: '# Architecture Plan\n\n- React Vite\n- Express Node',
    version: 1,
    updated_by: 'owner-part-1',
    author_display_name: 'aliceowner',
    author_pseudonymized_at: null,
    created_at: '2026-10-25T14:00:00Z',
    updated_at: '2026-10-25T14:00:00Z',
  };

  const mockRevisions: WorkspaceNoteRevisionView[] = [
    {
      id: 'rev-1',
      team_id: sampleTeamId,
      version: 1,
      content: '# Architecture Plan\n\n- React Vite\n- Express Node',
      author_id: 'owner-part-1',
      author_display_name: 'aliceowner',
      author_pseudonymized_at: null,
      created_at: '2026-10-25T14:00:00Z',
    },
  ];

  const createMockWorkspace = (
    overrides?: Partial<PrivateTeamWorkspaceView>
  ): PrivateTeamWorkspaceView => ({
    teamId: sampleTeamId,
    teamName: 'HackMatch Champions',
    recruitmentStatus: 'Locked',
    lockedAt: '2026-10-25T12:00:00Z',
    viewerRole: 'Owner',
    isOwner: true,
    teammates: [mockOwnerContact, mockMemberContact],
    links: mockLinks,
    note: mockNote,
    revisions: mockRevisions,
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Compact Callout State (autoLoad=false)', () => {
    it('renders callout card with button when autoLoad is false and opens on click', async () => {
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        createMockWorkspace()
      );

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={false}
        />
      );

      const openBtn = screen.getByRole('button', {
        name: /open private coordination workspace/i,
      });
      expect(openBtn).toBeInTheDocument();
      expect(
        screen.queryByTestId('private-coordination-workspace')
      ).not.toBeInTheDocument();

      fireEvent.click(openBtn);

      await waitFor(() => {
        expect(
          screen.getByTestId('private-coordination-workspace')
        ).toBeInTheDocument();
      });
      expect(teamWorkspaceApi.fetchPrivateTeamWorkspace).toHaveBeenCalledWith(
        sampleTeamId
      );
    });
  });

  describe('Teammate Contacts Section (FR-068 / US-023 AC 2)', () => {
    it('displays confirmed teammates with permitted handles and privacy notice', async () => {
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        createMockWorkspace()
      );

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByTestId('workspace-contacts-section')
        ).toBeInTheDocument();
      });

      expect(screen.getByText(SHARED_CONTACT_NOTICE)).toBeInTheDocument();
      expect(screen.getByText('Alice Owner')).toBeInTheDocument();
      expect(screen.getByText('@aliceowner')).toBeInTheDocument();
      expect(screen.getByText('alice#1234')).toBeInTheDocument();

      expect(screen.getByText('Bob Member')).toBeInTheDocument();
      expect(screen.getByText('@bobmember')).toBeInTheDocument();
      expect(
        screen.getByText('No shared contact handle provided')
      ).toBeInTheDocument();
    });
  });

  describe('Shared External Tool Links Section (FR-069 / US-023 AC 3)', () => {
    it('displays external tool links and hides edit button for non-owner member', async () => {
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        createMockWorkspace({ viewerRole: 'Member', isOwner: false })
      );

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Member"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByTestId('workspace-links-section')
        ).toBeInTheDocument();
      });

      expect(screen.getByText(EXTERNAL_LINKS_NOTICE)).toBeInTheDocument();
      expect(screen.getByText('Team GitHub')).toBeInTheDocument();
      expect(screen.getByText('Figma Canvas')).toBeInTheDocument();
      expect(screen.queryByTestId('edit-links-btn')).not.toBeInTheDocument();
    });

    it('allows owner to add, edit, and save external links', async () => {
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        createMockWorkspace({ viewerRole: 'Owner', isOwner: true })
      );
      const updateSpy = vi
        .spyOn(teamWorkspaceApi, 'updateWorkspaceExternalLinks')
        .mockResolvedValue({
          teamId: sampleTeamId,
          links: [
            ...mockLinks,
            { label: 'Discord Invite', url: 'https://discord.gg/team' },
          ],
          updatedAt: '2026-10-25T15:00:00Z',
        });

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('edit-links-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('edit-links-btn'));

      const addBtn = screen.getByTestId('add-link-row-btn');
      fireEvent.click(addBtn);

      const newLabelInput = screen.getByLabelText(/link #3 label/i);
      const newUrlInput = screen.getByLabelText(/link #3 url/i);

      fireEvent.change(newLabelInput, { target: { value: 'Discord Invite' } });
      fireEvent.change(newUrlInput, {
        target: { value: 'https://discord.gg/team' },
      });

      const saveBtn = screen.getByRole('button', {
        name: /save external links/i,
      });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          sampleTeamId,
          expect.arrayContaining([
            { label: 'Discord Invite', url: 'https://discord.gg/team' },
          ])
        );
      });

      expect(
        screen.getByText('External links updated successfully.')
      ).toBeInTheDocument();
    });

    it('shows validation error and preserves draft rows when owner enters invalid link', async () => {
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        createMockWorkspace({ viewerRole: 'Owner', isOwner: true })
      );

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('edit-links-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('edit-links-btn'));

      const addBtn = screen.getByTestId('add-link-row-btn');
      fireEvent.click(addBtn);

      const newLabelInput = screen.getByLabelText(/link #3 label/i);
      const newUrlInput = screen.getByLabelText(/link #3 url/i);

      fireEvent.change(newLabelInput, { target: { value: 'Insecure Link' } });
      fireEvent.change(newUrlInput, {
        target: { value: 'http://insecure.example.com' },
      });

      const saveBtn = screen.getByRole('button', {
        name: /save external links/i,
      });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(
        screen.getByText(/must be a valid https url/i)
      ).toBeInTheDocument();
      expect(newLabelInput).toHaveValue('Insecure Link');
      expect(newUrlInput).toHaveValue('http://insecure.example.com');
    });
  });

  describe('Shared Concept Note & Stale-Save Conflict (FR-070 / US-023 AC 4)', () => {
    it('renders live markdown preview and allows saving note', async () => {
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        createMockWorkspace()
      );
      const saveSpy = vi
        .spyOn(teamWorkspaceApi, 'saveWorkspaceSharedNote')
        .mockResolvedValue({
          teamId: sampleTeamId,
          note: {
            ...mockNote,
            content: '# Architecture Plan\n\n- React Vite\n- Express Node\n- Vitest',
            version: 2,
          },
          revision: {
            id: 'rev-2',
            team_id: sampleTeamId,
            version: 2,
            content: '# Architecture Plan\n\n- React Vite\n- Express Node\n- Vitest',
            author_id: 'owner-part-1',
            author_display_name: 'aliceowner',
            author_pseudonymized_at: null,
            created_at: '2026-10-25T15:00:00Z',
          },
          revisions: [
            {
              id: 'rev-2',
              team_id: sampleTeamId,
              version: 2,
              content: '# Architecture Plan\n\n- React Vite\n- Express Node\n- Vitest',
              author_id: 'owner-part-1',
              author_display_name: 'aliceowner',
              author_pseudonymized_at: null,
              created_at: '2026-10-25T15:00:00Z',
            },
            mockRevisions[0],
          ],
        });

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('workspace-note-section')).toBeInTheDocument();
      });

      expect(screen.getByTestId('workspace-note-version')).toHaveTextContent(
        'Revision v1'
      );
      expect(screen.getByTestId('workspace-note-preview')).toHaveTextContent(
        'Architecture Plan'
      );

      const textarea = screen.getByTestId('workspace-note-textarea');
      fireEvent.change(textarea, {
        target: {
          value: '# Architecture Plan\n\n- React Vite\n- Express Node\n- Vitest',
        },
      });

      const saveNoteBtn = screen.getByTestId('workspace-note-save-btn');
      fireEvent.click(saveNoteBtn);

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(sampleTeamId, {
          content: '# Architecture Plan\n\n- React Vite\n- Express Node\n- Vitest',
          expectedVersion: 1,
        });
      });

      expect(
        screen.getByText('Note saved successfully as Revision v2.')
      ).toBeInTheDocument();
      expect(screen.getByTestId('workspace-note-version')).toHaveTextContent(
        'Revision v2'
      );
    });

    it('handles 409 stale-save conflict by preserving user text and offering load latest revision', async () => {
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        createMockWorkspace()
      );

      const conflictDetails = {
        expectedVersion: 1,
        currentVersion: 2,
        latestNote: {
          ...mockNote,
          content: '# Server Updated Note by Teammate',
          version: 2,
        },
        revisions: [],
      };

      vi.spyOn(teamWorkspaceApi, 'saveWorkspaceSharedNote').mockRejectedValue(
        new teamWorkspaceApi.TeamWorkspaceApiError(
          409,
          'WORKSPACE_NOTE_CONFLICT',
          undefined,
          conflictDetails,
          conflictDetails,
          'This note was updated by another teammate since you loaded it.'
        )
      );

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Member"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('workspace-note-section')).toBeInTheDocument();
      });

      const textarea = screen.getByTestId('workspace-note-textarea');
      fireEvent.change(textarea, {
        target: { value: '# My Conflicting Draft' },
      });

      const saveNoteBtn = screen.getByTestId('workspace-note-save-btn');
      fireEvent.click(saveNoteBtn);

      await waitFor(() => {
        expect(
          screen.getByTestId('workspace-note-conflict-alert')
        ).toBeInTheDocument();
      });

      // User's unsaved draft is preserved in textarea (NR-010)
      expect(textarea).toHaveValue('# My Conflicting Draft');

      const loadLatestBtn = screen.getByTestId(
        'workspace-conflict-load-latest-btn'
      );
      expect(loadLatestBtn).toHaveTextContent(
        'Load Latest Server Revision (v2)'
      );

      fireEvent.click(loadLatestBtn);

      // Now textarea has latest server revision
      expect(textarea).toHaveValue('# Server Updated Note by Teammate');
      expect(
        screen.queryByTestId('workspace-note-conflict-alert')
      ).not.toBeInTheDocument();
    });
  });

  describe('Revision History Inspection (FR-070 / US-023 AC 4)', () => {
    it('inspects historical revisions with safe markdown rendering', async () => {
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        createMockWorkspace()
      );

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByTestId('workspace-revision-list')
        ).toBeInTheDocument();
      });

      const revList = screen.getByTestId('workspace-revision-list');
      expect(revList).toBeInTheDocument();
      expect(within(revList).getByText('Revision v1')).toBeInTheDocument();
      expect(within(revList).getByText(/by/i)).toBeInTheDocument();

      const inspectBtn = screen.getByTestId('inspect-revision-1');
      fireEvent.click(inspectBtn);

      expect(
        screen.getByTestId('inspected-revision-content-1')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('inspected-revision-content-1')
      ).toHaveTextContent('Architecture Plan');

      fireEvent.click(inspectBtn);
      expect(
        screen.queryByTestId('inspected-revision-content-1')
      ).not.toBeInTheDocument();
    });
  });

  describe('Loading and Error Recovery States (NR-010)', () => {
    it('displays loading indicator while fetching private workspace', async () => {
      let resolvePromise: (value: PrivateTeamWorkspaceView) => void;
      const delayedPromise = new Promise<PrivateTeamWorkspaceView>((resolve) => {
        resolvePromise = resolve;
      });
      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockReturnValue(
        delayedPromise
      );

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={true}
        />
      );

      expect(
        screen.getByText('Loading private team workspace...')
      ).toBeInTheDocument();

      resolvePromise!(createMockWorkspace());
      await waitFor(() => {
        expect(
          screen.queryByText('Loading private team workspace...')
        ).not.toBeInTheDocument();
      });
      expect(
        screen.getByTestId('private-coordination-workspace')
      ).toBeInTheDocument();
    });

    it('renders error alert when workspace fetch fails and retries on Reload Workspace', async () => {
      const fetchSpy = vi
        .spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace')
        .mockRejectedValueOnce(new Error('Network error loading workspace'))
        .mockResolvedValueOnce(createMockWorkspace());

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByText('Workspace Unavailable')).toBeInTheDocument();
      expect(
        screen.getByText('Network error loading workspace')
      ).toBeInTheDocument();

      const reloadBtn = screen.getByRole('button', {
        name: /reload workspace/i,
      });
      fireEvent.click(reloadBtn);

      await waitFor(() => {
        expect(
          screen.getByTestId('private-coordination-workspace')
        ).toBeInTheDocument();
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Markdown XSS Sanitization in UI (NR-009)', () => {
    it('neutralizes dangerous scripts and unsafe link schemes in live note preview and inspected revisions', async () => {
      const xssWorkspace = createMockWorkspace({
        note: {
          ...mockNote,
          content:
            '# Concept\n<script>alert("xss")</script><img src="x" onerror="steal()" />[Safe Link](https://safe.example.com) and [Malicious](javascript:alert(1))',
        },
        revisions: [
          {
            ...mockRevisions[0],
            content:
              '# Initial Revision\n<iframe src="evil.com"></iframe>[Insecure Link](http://insecure.example.com)',
          },
        ],
      });

      vi.spyOn(teamWorkspaceApi, 'fetchPrivateTeamWorkspace').mockResolvedValue(
        xssWorkspace
      );

      render(
        <PrivateCoordinationWorkspace
          teamId={sampleTeamId}
          viewerRole="Owner"
          autoLoad={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('workspace-note-preview')).toBeInTheDocument();
      });

      const preview = screen.getByTestId('workspace-note-preview');
      expect(preview.querySelector('script')).toBeNull();
      expect(preview.querySelector('img')).toBeNull();
      expect(preview).toHaveTextContent('Concept');
      expect(preview).toHaveTextContent('[unsafe link removed]');

      const safeLink = within(preview).getByRole('link', { name: 'Safe Link' });
      expect(safeLink).toHaveAttribute('href', 'https://safe.example.com');
      expect(within(preview).queryByRole('link', { name: 'Malicious' })).toBeNull();

      // Inspect revision
      const inspectBtn = screen.getByTestId('inspect-revision-1');
      fireEvent.click(inspectBtn);

      const inspectedContent = screen.getByTestId(
        'inspected-revision-content-1'
      );
      expect(inspectedContent.querySelector('iframe')).toBeNull();
      expect(inspectedContent).toHaveTextContent('Initial Revision');
      expect(inspectedContent).toHaveTextContent('[unsafe link removed]');
      expect(
        within(inspectedContent).queryByRole('link', { name: 'Insecure Link' })
      ).toBeNull();
    });
  });
});
