import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompatibilityRankList } from './CompatibilityRankList';

describe('CompatibilityRankList', () => {
  it('renders ranked scores and tie-break notice on success', () => {
    render(
      <CompatibilityRankList
        candidates={[
          {
            participantId: '1',
            rank: 1,
            displayScore: '100.0',
            handle: 'amy',
            displayName: 'Amy',
          },
          {
            participantId: '2',
            rank: 2,
            displayScore: '100.0',
            handle: 'zoe',
            displayName: 'Zoe',
          },
        ]}
      />
    );

    expect(screen.getByTestId('tie-break-notice')).toBeInTheDocument();
    expect(screen.getByText('#1 amy — 100.0')).toBeInTheDocument();
    expect(screen.getByText('#2 zoe — 100.0')).toBeInTheDocument();
  });

  it('renders empty state without inventing candidates', () => {
    render(<CompatibilityRankList candidates={[]} emptyMessage="No eligible candidates found." />);
    expect(screen.getByTestId('compatibility-rank-empty')).toHaveTextContent(
      'No eligible candidates found.'
    );
  });

  it('renders unranked degraded list without score labels', () => {
    render(
      <CompatibilityRankList
        unranked
        candidates={[
          { participantId: '1', handle: 'amy', displayName: 'Amy' },
        ]}
      />
    );
    expect(screen.getByText(/without ranking/i)).toBeInTheDocument();
    expect(screen.getByText('amy')).toBeInTheDocument();
    expect(screen.queryByTestId('tie-break-notice')).not.toBeInTheDocument();
  });
});
