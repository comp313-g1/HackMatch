import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CandidateDirectoryPanel } from './CandidateDirectoryPanel';
import * as candidateDirectoryApi from './candidateDirectoryApi';
import type { CandidateDirectoryResponse, DirectoryCandidate } from './candidateDirectoryApi';

vi.mock('./candidateDirectoryApi', async () => {
  const actual = await vi.importActual<typeof import('./candidateDirectoryApi')>(
    './candidateDirectoryApi'
  );
  return {
    ...actual,
    fetchTeamCandidateDirectory: vi.fn(),
  };
});

const fetchMock = vi.mocked(candidateDirectoryApi.fetchTeamCandidateDirectory);

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
});
