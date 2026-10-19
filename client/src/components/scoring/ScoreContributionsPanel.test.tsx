import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreContributionsPanel } from './ScoreContributionsPanel';

describe('ScoreContributionsPanel', () => {
  it('renders explainable skill/goal/hours contributions and notice', () => {
    render(
      <ScoreContributionsPanel
        displayScore="70.0"
        notice="Scores use self-declared skills."
        items={[
          {
            component: 'skill',
            label: 'Skills',
            value: 0.6,
            detail: 'Matched 2 of 4 required skills with primary-role match (×1.2, capped at 1.0).',
          },
          { component: 'goal', label: 'Goal', value: 1, detail: 'Identical goals.' },
          {
            component: 'hours',
            label: 'Hours',
            value: 0.5,
            detail: 'Commitment 10h vs requested 20h.',
          },
        ]}
      />
    );

    expect(screen.getByTestId('score-contributions-panel')).toHaveTextContent('70.0');
    expect(screen.getByText(/Matched 2 of 4/)).toBeInTheDocument();
    expect(screen.getByText(/Identical goals/)).toBeInTheDocument();
    expect(screen.getByTestId('score-contributions-notice')).toHaveTextContent(/self-declared/);
    expect(screen.queryByText(/internalId/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/[0-9a-f]{8}-[0-9a-f]{4}/i)).not.toBeInTheDocument();
  });

  it('shows empty state when no explanation is available', () => {
    render(<ScoreContributionsPanel />);
    expect(screen.getByTestId('score-contributions-empty')).toBeInTheDocument();
  });

  it('shows failure message without clearing caller form state', () => {
    render(
      <ScoreContributionsPanel errorMessage="Could not load score contributions." />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load/);
    expect(screen.getByRole('alert')).toHaveTextContent(/were kept/);
  });
});
