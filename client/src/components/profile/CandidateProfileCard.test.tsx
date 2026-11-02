import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CandidateProfileCard } from './CandidateProfileCard';

describe('CandidateProfileCard Privacy Boundaries (US-006 / #67 / FR-014)', () => {
  const sampleProfile = {
    displayName: 'Maya Lin',
    handle: 'maya_ml',
    primaryRole: 'AI/ML',
    institution: 'Centennial College',
    skills: ['PyTorch', 'TypeScript'],
    portfolioLinks: [
      {
        url: 'https://github.com/maya_ml',
        label: 'GitHub',
        isSelfDeclared: true,
      },
    ],
    sharedContactHandle: '@maya_private_discord',
  };

  it('VISITOR view hides member handle, display name, institution, portfolio links, and shared contact handle (US-006 AC 3 / T3)', () => {
    render(<CandidateProfileCard viewerCategory="VISITOR" profile={sampleProfile} />);

    expect(screen.getByText(/anonymous participant/i)).toBeInTheDocument();
    expect(screen.getByText('AI/ML')).toBeInTheDocument();
    expect(screen.queryByText('Maya Lin')).not.toBeInTheDocument();
    expect(screen.queryByText('@maya_ml')).not.toBeInTheDocument();
    expect(screen.queryByText('Centennial College')).not.toBeInTheDocument();
    expect(screen.queryByText('https://github.com/maya_ml')).not.toBeInTheDocument();
    expect(screen.queryByText('@maya_private_discord')).not.toBeInTheDocument();
  });

  it('PART view displays permitted profile fields and self-declared links while hiding sharedContactHandle (US-006 AC 3, AC 4 / T4)', () => {
    render(<CandidateProfileCard viewerCategory="PART" profile={sampleProfile} />);

    expect(screen.getByText('Maya Lin')).toBeInTheDocument();
    expect(screen.getByText('@maya_ml')).toBeInTheDocument();
    expect(screen.getByText('Centennial College')).toBeInTheDocument();
    expect(screen.getByText('PyTorch')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /github/i });
    expect(link).toHaveAttribute('href', 'https://github.com/maya_ml');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByText(/self-declared/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('@maya_private_discord')).not.toBeInTheDocument();
  });

  it('CONFIRMED_TEAMMATE view includes sharedContactHandle and audience notice (US-006 AC 4 / T5)', () => {
    render(
      <CandidateProfileCard viewerCategory="CONFIRMED_TEAMMATE" profile={sampleProfile} />
    );

    expect(screen.getByText('Maya Lin')).toBeInTheDocument();
    expect(screen.getByText('@maya_private_discord')).toBeInTheDocument();
    expect(screen.getByText(/visible only to confirmed teammates/i)).toBeInTheDocument();
  });

  it('renders loading, error/retry, and empty profile states cleanly (#66)', () => {
    const { rerender } = render(
      <CandidateProfileCard viewerCategory="PART" profile={{}} loading />
    );
    expect(screen.getByRole('status', { name: /loading candidate profile/i })).toHaveTextContent(
      /loading candidate profile/i
    );

    rerender(
      <CandidateProfileCard
        viewerCategory="PART"
        profile={{}}
        error="Failed to load candidate profile."
      />
    );
    expect(screen.getByRole('alert', { name: /candidate profile error/i })).toHaveTextContent(
      /failed to load candidate profile/i
    );

    rerender(
      <CandidateProfileCard
        viewerCategory="PART"
        profile={{ displayName: 'New Member', skills: [], portfolioLinks: [] }}
      />
    );
    expect(screen.getByText('New Member')).toBeInTheDocument();
    expect(screen.getByText(/role not specified/i)).toBeInTheDocument();
    expect(screen.getByText(/no skills listed yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no portfolio links listed/i)).toBeInTheDocument();
  });

  it('displays self-declared portfolio labels and experience disclaimer notice (US-006 AC 2 / #68)', () => {
    render(
      <CandidateProfileCard
        viewerCategory="PART"
        profile={{
          ...sampleProfile,
          selfDeclaredNotice:
            'Self-declared — HackMatch validates URL format only and does not certify skills, identity, or achievements.',
          portfolioLinks: [
            {
              url: 'https://github.com/maya_ml',
              label: 'Code Samples',
              isSelfDeclared: true,
            },
          ],
        }}
      />
    );

    expect(screen.getByRole('note', { name: /self-declared disclaimer/i })).toHaveTextContent(
      /validates url format only and does not certify skills/i
    );
    expect(screen.getByText(/code samples \(https:\/\/github\.com\/maya_ml\)/i)).toBeInTheDocument();
  });

  it('VISITOR view suppresses hackathon history and experience badges completely (US-007 AC 3)', () => {
    render(
      <CandidateProfileCard
        viewerCategory="VISITOR"
        profile={{
          ...sampleProfile,
          hackathonCount: 2,
          experienceBadge: 'Competitor',
          hackathonHistory: [
            {
              id: 'hist-1',
              participantId: 'part-1',
              eventName: 'Hack The North 2024',
              eventDate: '2024-09-15',
              teamRole: 'Frontend',
              projectTitle: 'EcoTrack AI',
              projectUrl: 'https://github.com/maya/ecotrack',
            },
          ],
        }}
      />
    );

    expect(screen.queryByTestId('experience-badge-pill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('experience-record-count')).not.toBeInTheDocument();
    expect(screen.queryByText(/hack the north 2024/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ecotrack ai/i)).not.toBeInTheDocument();
  });

  it('PART view displays self-reported experience badge, count, and past hackathon records (US-007 AC 1, AC 2)', () => {
    render(
      <CandidateProfileCard
        viewerCategory="PART"
        profile={{
          ...sampleProfile,
          hackathonCount: 1,
          experienceBadge: 'Competitor',
          hackathonHistory: [
            {
              id: 'hist-1',
              participantId: 'part-1',
              eventName: 'Hack The North 2024',
              eventDate: '2024-09-15',
              teamRole: 'Frontend',
              projectTitle: 'EcoTrack AI',
              projectUrl: 'https://github.com/maya/ecotrack',
            },
          ],
        }}
      />
    );

    const badgePill = screen.getByTestId('experience-badge-pill');
    expect(badgePill).toHaveTextContent('Competitor');
    expect(screen.getByTestId('experience-record-count')).toHaveTextContent(
      '1 self-reported hackathon'
    );
    expect(screen.getByText('Hack The North 2024')).toBeInTheDocument();
    expect(screen.getByText('(2024-09-15)')).toBeInTheDocument();
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('EcoTrack AI')).toBeInTheDocument();

    const projectLink = screen.getByRole('link', { name: 'https://github.com/maya/ecotrack' });
    expect(projectLink).toHaveAttribute('href', 'https://github.com/maya/ecotrack');
    expect(projectLink).toHaveAttribute('target', '_blank');
    expect(projectLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('PART view defaults to Beginner badge and indicates empty history when none recorded (US-007 AC 2)', () => {
    render(
      <CandidateProfileCard
        viewerCategory="PART"
        profile={{
          ...sampleProfile,
          hackathonHistory: [],
        }}
      />
    );

    const badgePill = screen.getByTestId('experience-badge-pill');
    expect(badgePill).toHaveTextContent('Beginner');
    expect(screen.getByTestId('experience-record-count')).toHaveTextContent(
      '0 self-reported hackathons'
    );
    expect(screen.getByText(/no past hackathons recorded/i)).toBeInTheDocument();
  });
});
