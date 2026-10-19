import { describe, it, expect } from 'vitest';
import { computeCompatibilityScore } from './compatibilityScoring.js';
import {
  SELF_DECLARED_SCORE_NOTICE,
  assertPublicExplanationSafe,
  buildPublicScoreExplanation,
  omitInternalIdentifierFields,
  publicPayloadHasInternalIdKey,
  sanitizeExplanationText,
} from './scoreExplanation.js';

describe('scoreExplanation (FR-047)', () => {
  it('builds skill/goal/hours explanation items without internal ids', () => {
    const scored = computeCompatibilityScore(
      {
        role: 'Frontend',
        requiredSkills: ['React', 'TypeScript', 'CSS', 'Testing'],
        requestedHours: 20,
        goal: 'Project Completion',
      },
      {
        primaryRole: 'Frontend',
        skills: ['React', 'TypeScript'],
        commitmentHours: 10,
        goal: 'Project Completion',
        displayHandle: 'alice',
        internalId: '11111111-1111-4111-8111-111111111111',
      }
    );

    const explanation = buildPublicScoreExplanation(scored);
    assertPublicExplanationSafe(explanation);

    expect(explanation.displayScore).toBe('70.0');
    expect(explanation.notice).toBe(SELF_DECLARED_SCORE_NOTICE);
    expect(explanation.items).toHaveLength(3);
    expect(explanation.items.map((i) => i.component)).toEqual(['skill', 'goal', 'hours']);
    expect(explanation.items[0].label).toBe('Skills');
    expect(explanation.contributions.skill).toMatch(/Matched 2 of 4/);
    expect(JSON.stringify(explanation)).not.toMatch(/internalId/i);
    expect(JSON.stringify(explanation)).not.toMatch(
      /11111111-1111-4111-8111-111111111111/
    );
  });

  it('redacts UUIDs that slip into contribution text', () => {
    expect(
      sanitizeExplanationText(
        'Matched skills for aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.'
      )
    ).toBe('Matched skills for [redacted].');
  });

  it('omits internalId keys from nested payloads while keeping participantId', () => {
    const scrubbed = omitInternalIdentifierFields({
      participantId: '22222222-2222-4222-8222-222222222222',
      internalId: 'should-not-leak',
      nested: { internal_id: 'nope', handle: 'amy' },
      candidates: [{ internalIdentifier: 'x', displayName: 'Amy' }],
    });

    expect(scrubbed).toEqual({
      participantId: '22222222-2222-4222-8222-222222222222',
      nested: { handle: 'amy' },
      candidates: [{ displayName: 'Amy' }],
    });
    expect(publicPayloadHasInternalIdKey(scrubbed)).toBe(false);
  });

  it('assertPublicExplanationSafe rejects UUID detail text', () => {
    expect(() =>
      assertPublicExplanationSafe({
        displayScore: '10.0',
        score: 10,
        notice: SELF_DECLARED_SCORE_NOTICE,
        roleMatched: false,
        matchedSkills: [],
        hadMissingInput: false,
        items: [
          {
            component: 'skill',
            label: 'Skills',
            value: 0,
            detail: 'See 33333333-3333-4333-8333-333333333333',
          },
        ],
        contributions: { skill: 'x', goal: 'y', hours: 'z' },
      })
    ).toThrow(/internal identifiers/);
  });
});
