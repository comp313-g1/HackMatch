import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModerationActionRecordPanel } from './ModerationActionRecordPanel';
import type { ModerationActionRecordView } from './moderationTypes';

const record: ModerationActionRecordView = {
  id: 'rec-1',
  actionType: 'moderation_hide',
  reason: 'Phishing listing',
  outcome: 'listing_hidden',
  createdAt: '2026-10-18T12:00:00.000Z',
  targetType: 'moderation_team',
  targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  safeStateSummary: {
    credentialsIncluded: false,
    privateContactsIncluded: false,
  },
};

describe('ModerationActionRecordPanel (US-026 / #243)', () => {
  it('shows idle prompt before a case is selected', () => {
    render(
      <ModerationActionRecordPanel
        records={[]}
        recordsState="idle"
        recordsError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-records-idle')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(
      <ModerationActionRecordPanel
        records={[]}
        recordsState="loading"
        recordsError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-records-loading')).toBeInTheDocument();
  });

  it('shows empty state when no decisions exist yet', () => {
    render(
      <ModerationActionRecordPanel
        records={[]}
        recordsState="success"
        recordsError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-records-empty')).toHaveTextContent(/No action records/i);
  });

  it('shows error with retry', () => {
    const onRetry = vi.fn();
    render(
      <ModerationActionRecordPanel
        records={[]}
        recordsState="error"
        recordsError="Failed to load"
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId('moderation-records-error')).toHaveTextContent(/Failed to load/);
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('lists safe action records with reason and outcome', () => {
    render(
      <ModerationActionRecordPanel
        records={[record]}
        recordsState="success"
        recordsError={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-record-reason-rec-1')).toHaveTextContent(
      'Phishing listing'
    );
    expect(screen.getByTestId('moderation-record-outcome-rec-1')).toHaveTextContent(
      'listing_hidden'
    );
    expect(screen.getByTestId('moderation-record-safe-rec-1')).toHaveTextContent(
      /credentials excluded/i
    );
    expect(screen.queryByText(/@|password|firebase/i)).not.toBeInTheDocument();
  });
});
