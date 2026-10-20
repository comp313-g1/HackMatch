import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModerationQueueView } from './ModerationQueueView';
import type { ModerationCaseView } from './moderationTypes';

const older: ModerationCaseView = {
  id: '11111111-1111-4111-8111-111111111111',
  targetType: 'team',
  targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reason: 'Older spam',
  status: 'Open',
  reportCount: 0,
  flaggedUrl: null,
  createdAt: '2026-10-18T10:00:00.000Z',
  createdBy: 'admin',
};

const newer: ModerationCaseView = {
  id: '22222222-2222-4222-8222-222222222222',
  targetType: 'profile',
  targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  reason: 'Newer phishing',
  status: 'Open',
  reportCount: 2,
  flaggedUrl: null,
  createdAt: '2026-10-18T12:00:00.000Z',
  createdBy: 'admin',
};

describe('ModerationQueueView (US-026 / #241)', () => {
  it('shows loading state', () => {
    render(
      <ModerationQueueView
        cases={[]}
        listState="loading"
        listError={null}
        selectedCaseId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-queue-loading')).toHaveTextContent(/Loading/i);
  });

  it('shows empty state on success with no cases', () => {
    render(
      <ModerationQueueView
        cases={[]}
        listState="success"
        listError={null}
        selectedCaseId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-queue-empty')).toHaveTextContent(/No moderation cases/i);
  });

  it('shows error with retry', () => {
    const onRetry = vi.fn();
    render(
      <ModerationQueueView
        cases={[]}
        listState="error"
        listError="Network failed"
        selectedCaseId={null}
        onSelect={vi.fn()}
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId('moderation-queue-error')).toHaveTextContent(/Network failed/);
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('lists cases newest-first order as provided and shows reason, time, reports', () => {
    render(
      <ModerationQueueView
        cases={[newer, older]}
        listState="success"
        listError={null}
        selectedCaseId={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId(/moderation-case-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', `moderation-case-row-${newer.id}`);
    expect(rows[1]).toHaveAttribute('data-testid', `moderation-case-row-${older.id}`);
    expect(screen.getByText('Newer phishing')).toBeInTheDocument();
    expect(screen.getByTestId(`moderation-report-count-${newer.id}`)).toHaveTextContent('2 reports');
  });

  it('calls onSelect when a case row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ModerationQueueView
        cases={[newer]}
        listState="success"
        listError={null}
        selectedCaseId={null}
        onSelect={onSelect}
        onRetry={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId(`moderation-case-row-${newer.id}`));
    expect(onSelect).toHaveBeenCalledWith(newer.id);
  });
});
