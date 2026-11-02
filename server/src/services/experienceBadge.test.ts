import { describe, it, expect } from 'vitest';
import {
  computeExperienceBadge,
  buildExperienceSummary,
  SELF_REPORTED_HISTORY_NOTICE,
} from './experienceBadge.js';
import type { ParticipantHackathonHistory } from '../db/types.js';

describe('experienceBadge service (US-007 / #US-007-T4 / FR-016)', () => {
  describe('computeExperienceBadge', () => {
    it('returns Beginner for 0 records', () => {
      expect(computeExperienceBadge(0)).toBe('Beginner');
      expect(computeExperienceBadge(-1)).toBe('Beginner');
      expect(computeExperienceBadge(NaN)).toBe('Beginner');
    });

    it('returns Competitor for 1 to 3 records', () => {
      expect(computeExperienceBadge(1)).toBe('Competitor');
      expect(computeExperienceBadge(2)).toBe('Competitor');
      expect(computeExperienceBadge(3)).toBe('Competitor');
    });

    it('returns Veteran for 4 or more records', () => {
      expect(computeExperienceBadge(4)).toBe('Veteran');
      expect(computeExperienceBadge(5)).toBe('Veteran');
      expect(computeExperienceBadge(20)).toBe('Veteran');
    });

    it('handles non-integer inputs gracefully by flooring', () => {
      expect(computeExperienceBadge(3.9)).toBe('Competitor');
      expect(computeExperienceBadge(4.1)).toBe('Veteran');
    });
  });

  describe('buildExperienceSummary', () => {
    it('builds summary from record count', () => {
      const summary = buildExperienceSummary(2);
      expect(summary).toEqual({
        hackathonCount: 2,
        experienceBadge: 'Competitor',
        experienceBadgeSelfReported: true,
        selfReportedNotice: SELF_REPORTED_HISTORY_NOTICE,
      });
    });

    it('builds summary from record array', () => {
      const records = [
        { id: '1' },
        { id: '2' },
        { id: '3' },
        { id: '4' },
      ] as ParticipantHackathonHistory[];

      const summary = buildExperienceSummary(records);
      expect(summary).toEqual({
        hackathonCount: 4,
        experienceBadge: 'Veteran',
        experienceBadgeSelfReported: true,
        selfReportedNotice: SELF_REPORTED_HISTORY_NOTICE,
      });
    });

    it('always marks badge as self-reported', () => {
      const summary = buildExperienceSummary(0);
      expect(summary.experienceBadgeSelfReported).toBe(true);
      expect(summary.experienceBadge).toBe('Beginner');
    });
  });
});
