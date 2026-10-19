import { describe, it, expect } from 'vitest';
import {
  formatCompatibilityDisplayScore,
  validateCompatibilityScoreForms,
} from './compatibilityValidation';
import type {
  CandidateScoringFormState,
  SlotScoringFormState,
} from './compatibilityTypes';

const validSlot: SlotScoringFormState = {
  role: 'Frontend',
  requiredSkillsInput: 'React, TypeScript, CSS, Testing',
  requestedHours: '20',
  goal: 'Project Completion',
};

const validCandidate: CandidateScoringFormState = {
  primaryRole: 'Frontend',
  skillsInput: 'React, TypeScript',
  commitmentHours: '10',
  goal: 'Project Completion',
  displayHandle: 'alice',
};

describe('validateCompatibilityScoreForms', () => {
  it('builds a payload for valid inputs', () => {
    const result = validateCompatibilityScoreForms(validSlot, validCandidate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.slot.requiredSkills).toEqual([
      'React',
      'TypeScript',
      'CSS',
      'Testing',
    ]);
    expect(result.payload.candidate.commitmentHours).toBe(10);
  });

  it('returns field errors without inventing corrected values', () => {
    const result = validateCompatibilityScoreForms(
      { ...validSlot, role: 'Wizard', requestedHours: '999' },
      { ...validCandidate, goal: 'Chaos' }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.role).toMatch(/Frontend/);
    expect(result.errors.requestedHours).toMatch(/168/);
    expect(result.errors.candidateGoal).toMatch(/Learning/);
  });

  it('allows blank optionals (server scores missing as 0)', () => {
    const result = validateCompatibilityScoreForms(
      { role: '', requiredSkillsInput: '', requestedHours: '', goal: '' },
      {
        primaryRole: '',
        skillsInput: '',
        commitmentHours: '',
        goal: '',
        displayHandle: '',
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.slot.requestedHours).toBeNull();
    expect(result.payload.candidate.goal).toBeNull();
  });
});

describe('formatCompatibilityDisplayScore', () => {
  it('formats to one decimal place', () => {
    expect(formatCompatibilityDisplayScore(70)).toBe('70.0');
    expect(formatCompatibilityDisplayScore(33.333)).toBe('33.3');
  });
});
