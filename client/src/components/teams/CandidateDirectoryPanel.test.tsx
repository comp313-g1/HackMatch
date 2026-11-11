import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CandidateDirectoryPanel } from './CandidateDirectoryPanel';
import { DirectMessageLauncherProvider } from '../chat/directMessageLauncher';
import * as candidateDirectoryApi from './candidateDirectoryApi';
import * as invitationsApi from './invitationsApi';
import type { CandidateDirectoryResponse, DirectoryCandidate } from './candidateDirectoryApi';
import type { TeamVacancyView } from './teamTypes';

vi.mock('./candidateDirectoryApi', async () => {
  const actual = await vi.importActual<typeof import('./candidateDirectoryApi')>(
    './candidateDirectoryApi'
  );
  return {
    ...actual,
    fetchTeamCandidateDirectory: vi.fn(),
  };
});

vi.mock('./invitationsApi', async () => {
  const actual = await vi.importActual<typeof import('./invitationsApi')>('./invitationsApi');
  return {
    ...actual,
    issueTeamInvitation: vi.fn(),
  };
});

const fetchMock = vi.mocked(candidateDirectoryApi.fetchTeamCandidateDirectory);
const issueInviteMock = vi.mocked(invitationsApi.issueTeamInvitation);

const mockOpenVacancies: TeamVacancyView[] = [
  {
    id: 'vac-frontend',
    role: 'Frontend',
    skills: ['React', 'TypeScript'],
    status: 'Open',
  },
  {
    id: 'vac-backend',
    role: 'Backend',
    skills: ['Node.js'],
    status: 'Open',
  },
];

const mockCandidate: DirectoryCandidate = {
  participantId: 'p-1',
  displayName: 'Alice Coder',
  handle: 'alice_c',
  institution: 'Centennial College',
  primaryRole: 'Frontend',
  desiredRole: 'Frontend',
  commitmentHours: 20,
  goal: 'Project Completion',
  skills: ['React', 'TypeScript', 'Tailwind'],
  matchedSkills: ['React', 'TypeScript'],
  skillsSelfDeclared: true,
  portfolioLinks: [{ url: 'https://alice.dev', label: 'Portfolio', isSelfDeclared: true }],
  selfDeclaredNotice: 'Skills and portfolios are self-declared by participants.',
  hackathonCount: 2,
  experienceBadge: 'Competitor',
  experienceBadgeSelfReported: true,
  selfReportedNotice: 'Hackathon experience history is self-reported.',
  hackathonHistory: [],
  updatedAt: '2026-10-18T12:00:00Z',
};

const mockResponse: CandidateDirectoryResponse = {
  teamId: 't-1',
  eventId: 'e-1',
  filters: {
    skills: ['React', 'TypeScript'],
    skillMatchMode: 'AND',
    role: null,
    desiredRole: null,
    minHours: null,
    maxHours: null,
    badge: null,
    goal: null,
    search: null,
  },
  candidates: [mockCandidate],
  totalEligible: 1,
  totalMatched: 1,
  empty: false,
  message: null,
  exclusions: {
    inactive: 0,
    unavailable: 0,
    confirmed: 0,
    owner: 0,
    totalExcluded: 0,
  },
};

describe('CandidateDirectoryPanel (US-014-T4 / #139)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders filter controls and idle hint initially without making network calls', () => {
    render(<CandidateDirectoryPanel teamId="t-1" />);

    expect(screen.getByTestId('candidate-directory-panel')).toBeInTheDocument();
    expect(screen.getByLabelText(/skills/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/skill match mode/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary role/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/experience badge/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/min hours/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max hours/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search handle or name/i)).toBeInTheDocument();
    expect(screen.getByTestId('directory-idle-hint')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates filter draft client-side and shows inline field error on minHours > maxHours (NR-010)', async () => {
    render(<CandidateDirectoryPanel teamId="t-1" />);

    fireEvent.change(screen.getByTestId('directory-min-hours'), { target: { value: '40' } });
    fireEvent.change(screen.getByTestId('directory-max-hours'), { target: { value: '20' } });

    fireEvent.click(screen.getByTestId('directory-search-submit'));

    await waitFor(() => {
      const error = screen.getByTestId('hours-error');
      expect(error).toHaveTextContent(/minimum commitment hours cannot exceed maximum/i);
    });

    expect(screen.getByTestId('directory-min-hours')).toHaveValue(40);
    expect(screen.getByTestId('directory-max-hours')).toHaveValue(20);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('executes candidate search and renders candidate card with non-color matched skill chips (FR-042)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse);

    render(<CandidateDirectoryPanel teamId="t-1" />);

    fireEvent.change(screen.getByTestId('directory-skills-input'), { target: { value: 'React, TypeScript' } });
    fireEvent.click(screen.getByTestId('directory-search-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('directory-results-container')).toBeInTheDocument();
    });

    expect(screen.getByTestId('candidate-display-name')).toHaveTextContent('Alice Coder');
    expect(screen.getByText('@alice_c')).toBeInTheDocument();
    expect(screen.getByText('Centennial College')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-badge')).toHaveTextContent('Competitor (Self-reported)');

    // Non-color matched skill chips (FR-042)
    const matchedChips = screen.getAllByTestId('matched-skill-chip');
    expect(matchedChips).toHaveLength(2);
    expect(matchedChips[0]).toHaveTextContent('✓ React (Matched)');
    expect(matchedChips[1]).toHaveTextContent('✓ TypeScript (Matched)');

    // Unmatched skill
    const unmatchedChip = screen.getByTestId('skill-chip');
    expect(unmatchedChip).toHaveTextContent('Tailwind');
  });

  it('renders contextual empty state when search returns zero matches', async () => {
    fetchMock.mockResolvedValueOnce({
      ...mockResponse,
      candidates: [],
      totalMatched: 0,
      empty: true,
      message: 'No eligible candidates match the selected filters. Try broadening your skills, role, hours, or experience badge criteria.',
    });

    render(<CandidateDirectoryPanel teamId="t-1" />);

    fireEvent.click(screen.getByTestId('directory-search-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('directory-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByTestId('directory-empty-state')).toHaveTextContent(/no eligible candidates match/i);
  });

  it('preserves user input and previously loaded results on server error (NR-010, NR-017)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse);

    render(<CandidateDirectoryPanel teamId="t-1" />);

    fireEvent.change(screen.getByTestId('directory-skills-input'), { target: { value: 'React' } });
    fireEvent.click(screen.getByTestId('directory-search-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('candidate-display-name')).toHaveTextContent('Alice Coder');
    });

    fetchMock.mockRejectedValueOnce(
      new candidateDirectoryApi.CandidateDirectoryApiError(500, 'SERVER_ERROR', undefined, undefined, 'Database timeout')
    );

    fireEvent.change(screen.getByTestId('directory-skills-input'), { target: { value: 'React, Node' } });
    fireEvent.click(screen.getByTestId('directory-search-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('directory-error-banner')).toBeInTheDocument();
    });

    // Error banner visible
    expect(screen.getByTestId('directory-error-banner')).toHaveTextContent('Database timeout');
    // Input preserved
    expect(screen.getByTestId('directory-skills-input')).toHaveValue('React, Node');
    // Previously loaded card preserved
    expect(screen.getByTestId('candidate-display-name')).toHaveTextContent('Alice Coder');
  });

  it('resets filter inputs when reset button is clicked', async () => {
    render(<CandidateDirectoryPanel teamId="t-1" />);

    fireEvent.change(screen.getByTestId('directory-skills-input'), { target: { value: 'React' } });
    fireEvent.change(screen.getByTestId('directory-min-hours'), { target: { value: '10' } });

    fireEvent.click(screen.getByTestId('directory-reset-filters'));

    expect(screen.getByTestId('directory-skills-input')).toHaveValue('');
    expect(screen.getByTestId('directory-min-hours')).toHaveValue(null);
  });

  it('renders self-reported experience summary, portfolio links, and toggles profile inspection (US-014 AC 4 / US-006 / US-007)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse);

    render(<CandidateDirectoryPanel teamId="t-1" />);

    fireEvent.click(screen.getByTestId('directory-search-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('directory-results-container')).toBeInTheDocument();
    });

    // Experience summary
    expect(screen.getByTestId('candidate-experience-summary')).toHaveTextContent(
      'Competitor · 2 self-reported hackathons'
    );

    // Self-declared portfolio link
    const portfolioLinks = screen.getByTestId('candidate-portfolio-links');
    expect(portfolioLinks).toBeInTheDocument();
    const portfolioAnchor = screen.getByRole('link', { name: /portfolio/i });
    expect(portfolioAnchor).toHaveAttribute('href', 'https://alice.dev');
    expect(portfolioAnchor).toHaveAttribute('rel', 'noopener noreferrer');

    // Inspect Profile toggle button
    const inspectBtn = screen.getByTestId('inspect-candidate-p-1');
    expect(inspectBtn).toHaveTextContent('Inspect Profile');
    expect(inspectBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('inspected-profile-p-1')).not.toBeInTheDocument();

    // Expand profile
    fireEvent.click(inspectBtn);

    expect(inspectBtn).toHaveTextContent('Hide Profile');
    expect(inspectBtn).toHaveAttribute('aria-expanded', 'true');
    const inspectedRegion = screen.getByTestId('inspected-profile-p-1');
    expect(inspectedRegion).toBeInTheDocument();

    // Inside CandidateProfileCard under PART viewer category:
    // Display name, handle, role, institution rendered
    expect(screen.getAllByText('Alice Coder').length).toBeGreaterThanOrEqual(2);
    // Private contact is strictly NOT rendered
    expect(screen.queryByText(/@alice_private_discord/i)).not.toBeInTheDocument();

    // Collapse profile
    fireEvent.click(inspectBtn);
    expect(inspectBtn).toHaveTextContent('Inspect Profile');
    expect(inspectBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('inspected-profile-p-1')).not.toBeInTheDocument();
  });

  describe('US-017 Invitation Flow from Directory Cards (US-014-T6 / FR-049)', () => {
    it('disables Invite button and shows helper text when openVacancies is empty', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse);

      render(<CandidateDirectoryPanel teamId="t-1" openVacancies={[]} />);

      fireEvent.click(screen.getByTestId('directory-search-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('directory-open-invite-p-1')).toBeInTheDocument();
      });

      const inviteBtn = screen.getByTestId('directory-open-invite-p-1');
      expect(inviteBtn).toBeDisabled();
      expect(
        screen.getByText('Add an open vacancy slot on your team to invite candidates.')
      ).toBeInTheDocument();
    });

    it('opens inline invitation composer auto-defaulting to candidate matching role slot', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse);

      render(
        <CandidateDirectoryPanel
          teamId="t-1"
          openVacancies={mockOpenVacancies}
        />
      );

      fireEvent.click(screen.getByTestId('directory-search-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('directory-open-invite-p-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('directory-open-invite-p-1'));

      expect(screen.getByTestId('directory-invite-form')).toBeInTheDocument();
      const select = screen.getByTestId('directory-invite-slot-select') as HTMLSelectElement;
      // Candidate primary/desired role is 'Frontend', so should auto-default to 'vac-frontend'
      expect(select.value).toBe('vac-frontend');
    });

    it('submits invitation successfully, shows confirmation banner, updates button state, and notifies parent', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse);
      const onInvited = vi.fn();
      issueInviteMock.mockResolvedValueOnce({
        id: 'inv-1',
        teamId: 't-1',
        vacancyId: 'vac-frontend',
        inviteeParticipantId: 'p-1',
        status: 'Pending',
        requestType: 'Invitation',
        expiresAt: '2026-10-25T12:00:00Z',
        createdAt: '2026-10-18T12:00:00Z',
        teamName: 'HackMatch Innovators',
        vacancyRole: 'Frontend',
        source: 'direct',
        notice: 'Invitation sent',
      });

      render(
        <CandidateDirectoryPanel
          teamId="t-1"
          openVacancies={mockOpenVacancies}
          onInvitationIssued={onInvited}
        />
      );

      fireEvent.click(screen.getByTestId('directory-search-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('directory-open-invite-p-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('directory-open-invite-p-1'));
      fireEvent.click(screen.getByTestId('directory-confirm-invite'));

      await waitFor(() => {
        expect(screen.getByTestId('directory-invite-success')).toBeInTheDocument();
      });

      expect(issueInviteMock).toHaveBeenCalledWith('t-1', {
        vacancyId: 'vac-frontend',
        inviteeParticipantId: 'p-1',
        source: 'direct',
      });

      expect(onInvited).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('directory-invite-success')).toHaveTextContent(
        /invitation sent for the frontend slot/i
      );

      // Button now disabled with "Invitation sent"
      const inviteBtn = screen.getByTestId('directory-open-invite-p-1');
      expect(inviteBtn).toBeDisabled();
      expect(inviteBtn).toHaveTextContent('Invitation sent');
    });

    it('preserves draft and results when invitation issuance fails with conflict or network error (NR-010, NR-017)', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse);
      issueInviteMock.mockRejectedValueOnce(
        new invitationsApi.InvitationsApiError(
          409,
          'CONFLICT_ALREADY_INVITED',
          undefined,
          undefined,
          'Candidate already has a pending invitation for this team.'
        )
      );

      render(
        <CandidateDirectoryPanel
          teamId="t-1"
          openVacancies={mockOpenVacancies}
        />
      );

      fireEvent.click(screen.getByTestId('directory-search-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('directory-open-invite-p-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('directory-open-invite-p-1'));
      fireEvent.click(screen.getByTestId('directory-confirm-invite'));

      await waitFor(() => {
        expect(screen.getByTestId('directory-invite-error')).toBeInTheDocument();
      });

      expect(screen.getByTestId('directory-invite-error')).toHaveTextContent(
        'Candidate already has a pending invitation for this team.'
      );
      // Composer and directory results kept intact
      expect(screen.getByTestId('directory-invite-form')).toBeInTheDocument();
      expect(screen.getByTestId('candidate-display-name')).toHaveTextContent('Alice Coder');

      // Cancel button dismisses composer
      fireEvent.click(screen.getByTestId('directory-cancel-invite'));
      expect(screen.queryByTestId('directory-invite-form')).not.toBeInTheDocument();
    });
  });

  describe('Message button (#432)', () => {
    it('lets a Team Lead message an inspected candidate', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse);
      const open = vi.fn();
      render(
        <DirectMessageLauncherProvider value={{ openDirectMessage: open }}>
          <CandidateDirectoryPanel teamId="t-1" />
        </DirectMessageLauncherProvider>
      );

      fireEvent.click(screen.getByTestId('directory-search-submit'));
      await waitFor(() => expect(screen.getByTestId('directory-results-container')).toBeInTheDocument());
      expect(screen.queryByTestId('message-profile-btn')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('inspect-candidate-p-1'));
      fireEvent.click(screen.getByTestId('message-profile-btn'));

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith('p-1');
    });

    it('shows no Message button where messaging is not available', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse);
      render(<CandidateDirectoryPanel teamId="t-1" />);
      fireEvent.click(screen.getByTestId('directory-search-submit'));
      await waitFor(() => expect(screen.getByTestId('directory-results-container')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('inspect-candidate-p-1'));
      expect(screen.queryByTestId('message-profile-btn')).not.toBeInTheDocument();
    });
  });
});
