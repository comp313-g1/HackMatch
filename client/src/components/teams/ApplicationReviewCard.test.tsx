import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApplicationReviewCard } from './ApplicationReviewCard';
import type { OwnerApplicationReviewItem } from './applicationsApi';

const application: OwnerApplicationReviewItem = {
  id: 'app-189',
  teamId: 'team-1',
  eventId: 'event-1',
  vacancyId: 'vacancy-1',
  applicantParticipantId: 'participant-1',
  applicantDisplayName: 'Maya Lin',
  applicantHandle: 'maya_ml',
  primaryRole: 'AI/ML',
  institution: 'Centennial College',
  skills: ['PyTorch', 'TypeScript'],
  portfolios: [{ url: 'https://github.com/maya_ml', label: 'Code Samples' }],
  status: 'Pending',
  statusLabel: 'Pending Review',
  requestType: 'Application',
  message: 'I can build the recommendation model.\nAvailable all weekend.',
  createdAt: '2026-10-20T16:00:00.000Z',
  teamName: 'HackMatch Innovators',
  vacancyRole: 'AI/ML',
};

describe('ApplicationReviewCard (US-020 / #189 / FR-060)', () => {
  it('displays permitted profile fields, self-declared links, and the application note', () => {
    render(<ApplicationReviewCard application={application} />);

    expect(screen.getByText('Maya Lin')).toBeInTheDocument();
    expect(screen.getByText('@maya_ml')).toBeInTheDocument();
    expect(screen.getAllByText('AI/ML').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Centennial College')).toBeInTheDocument();
    expect(screen.getByText('PyTorch')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText(/I can build the recommendation model/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Code Samples/i })).toHaveAttribute(
      'href',
      'https://github.com/maya_ml'
    );
    expect(screen.getByRole('note', { name: /self-declared disclaimer/i })).toBeInTheDocument();
  });

  it('shows explicit empty field and note states without inventing applicant data', () => {
    render(
      <ApplicationReviewCard
        application={{
          ...application,
          applicantDisplayName: 'Participant',
          applicantHandle: null,
          primaryRole: null,
          institution: null,
          skills: [],
          portfolios: [],
          message: null,
          vacancyRole: null,
        }}
      />
    );

    expect(screen.getByText('Role not specified')).toBeInTheDocument();
    expect(screen.getByText('No skills listed yet.')).toBeInTheDocument();
    expect(screen.getByText('No portfolio links listed.')).toBeInTheDocument();
    expect(screen.getByText('No application note provided.')).toBeInTheDocument();
    expect(screen.getByText('Unspecified vacancy')).toBeInTheDocument();
  });

  it('does not render invalid or non-HTTPS portfolio links', () => {
    render(
      <ApplicationReviewCard
        application={{
          ...application,
          portfolios: [
            { url: 'http://example.com/insecure', label: 'Insecure' },
            { url: 'javascript:alert(1)', label: 'Unsafe' },
          ],
        }}
      />
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('No portfolio links listed.')).toBeInTheDocument();
  });

  it('uses ordinary PART visibility so private teammate contact data has no render path', () => {
    render(<ApplicationReviewCard application={application} />);

    expect(screen.queryByText(/shared teammate contact/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/account email/i)).not.toBeInTheDocument();
  });
});

