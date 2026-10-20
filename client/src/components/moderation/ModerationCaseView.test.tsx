import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModerationCaseView } from './ModerationCaseView';
import type { ModerationCaseDetail } from './moderationTypes';

const detail: ModerationCaseDetail = {
  case: {
    id: '11111111-1111-4111-8111-111111111111',
    targetType: 'team',
    targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reason: 'Suspicious link',
    status: 'Open',
    reportCount: 1,
    flaggedUrl: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    createdBy: 'admin',
  },
  target: {
    type: 'team',
    team: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'Phishy Team',
      pitch: 'Join via this link',
      goal: 'Learning',
      commitmentHours: 10,
      communicationLink: 'https://evil.example/phish',
      recruitmentStatus: 'Open',
      eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ownerHandle: 'ada',
      ownerDisplayName: 'Ada Lovelace',
    },
  },
};

describe('ModerationCaseView (US-026 / #241)', () => {
  it('shows idle prompt before a case is selected', () => {
    render(
      <ModerationCaseView
        detail={null}
        detailState="idle"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-case-idle')).toHaveTextContent(/Select a case/i);
  });

  it('shows loading state', () => {
    render(
      <ModerationCaseView
        detail={null}
        detailState="loading"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-case-loading')).toBeInTheDocument();
  });

  it('shows error state with message', () => {
    render(
      <ModerationCaseView
        detail={null}
        detailState="error"
        detailError="Case not found"
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-case-error')).toHaveTextContent(/Case not found/);
  });

  it('renders case reason, time, reports, and sanitized team target on success', () => {
    render(
      <ModerationCaseView
        detail={detail}
        detailState="success"
        detailError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-case-detail')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-case-reason')).toHaveTextContent('Suspicious link');
    expect(screen.getByTestId('moderation-case-report-count')).toHaveTextContent('1');
    expect(screen.getByTestId('moderation-target-team')).toHaveTextContent('Phishy Team');
    expect(screen.getByText('https://evil.example/phish')).toBeInTheDocument();
    expect(screen.queryByText(/@|firebase|secret/i)).not.toBeInTheDocument();
  });
});
