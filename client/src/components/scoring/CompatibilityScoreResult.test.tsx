import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompatibilityScoreResult } from './CompatibilityScoreResult';
import type { CompatibilityScoreSuccess } from './compatibilityTypes';

const success: CompatibilityScoreSuccess = {
  status: 'ok',
  score: 70,
  displayScore: '70.0',
  components: { skill: 0.6, goal: 1, hours: 0.5 },
  matchedSkills: ['react', 'typescript'],
  roleMatched: true,
  hadMissingInput: false,
  contributions: {
    skill: 'Matched 2 of 4 required skills with primary-role match (×1.2, capped at 1.0).',
    goal: 'Identical goals.',
    hours: 'Commitment 10h vs requested 20h.',
  },
  notice: 'Scores use self-declared skills, role, goal, and hours.',
};

describe('CompatibilityScoreResult', () => {
  it('renders success score and contribution explanations', () => {
    render(<CompatibilityScoreResult result={success} />);
    expect(screen.getByTestId('compatibility-score-success')).toHaveTextContent('70.0');
    expect(screen.getByText(/Matched 2 of 4/)).toBeInTheDocument();
    expect(screen.getByText(/Identical goals/)).toBeInTheDocument();
  });

  it('mentions missing-input scoring when flagged', () => {
    render(
      <CompatibilityScoreResult result={{ ...success, hadMissingInput: true, displayScore: '33.3' }} />
    );
    expect(screen.getByText(/scored as 0/)).toBeInTheDocument();
  });

  it('renders field errors without implying form values were cleared', () => {
    render(
      <CompatibilityScoreResult
        errors={{ role: 'Slot role must be one of: Frontend, Backend.' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/entries were kept/);
    expect(screen.getByText(/Slot role must be one of/)).toBeInTheDocument();
  });
});
