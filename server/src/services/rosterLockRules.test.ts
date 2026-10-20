import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateLockMemberCount,
  summarizeLockLeaveConcurrency,
  TEAM_ADVISORY_LOCK_PREFIX,
  DEFAULT_LOCK_MIN_MEMBERS,
  DEFAULT_LOCK_MAX_MEMBERS,
  resolveLockMemberBounds,
} from './rosterLockRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lockSql = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/0036_lock_team.sql'),
  'utf-8'
);

describe('roster lock min/max/concurrency rules (US-022 / #212 / FR-066)', () => {
  describe('SQL contract', () => {
    it('lock_team and leave_team share the team advisory lock key (concurrency)', () => {
      expect(lockSql).toMatch(/pg_advisory_xact_lock/i);
      expect(lockSql).toContain(TEAM_ADVISORY_LOCK_PREFIX);

      const leaveIdx = lockSql.indexOf('CREATE OR REPLACE FUNCTION leave_team');
      const lockIdx = lockSql.indexOf('CREATE OR REPLACE FUNCTION lock_team');
      const leaveSql = lockSql.slice(leaveIdx, lockIdx);
      const lockBody = lockSql.slice(lockIdx);

      expect(leaveSql).toContain(TEAM_ADVISORY_LOCK_PREFIX);
      expect(lockBody).toContain(TEAM_ADVISORY_LOCK_PREFIX);
      expect(leaveSql).toMatch(/pg_advisory_xact_lock/i);
      expect(lockBody).toMatch(/pg_advisory_xact_lock/i);
    });

    it('raises BELOW_MIN_MEMBERS and ABOVE_MAX_MEMBERS with bound details', () => {
      expect(lockSql).toMatch(/BELOW_MIN_MEMBERS/);
      expect(lockSql).toMatch(/ABOVE_MAX_MEMBERS/);
      expect(lockSql).toMatch(/GREATEST\s*\(\s*2\s*,\s*COALESCE\s*\(\s*v_event\.min_team_size/i);
      expect(lockSql).toMatch(/COALESCE\s*\(\s*v_event\.max_team_size\s*,\s*4\s*\)/i);
      expect(lockSql).toMatch(/memberCount/i);
      expect(lockSql).toMatch(/minRequired/i);
      expect(lockSql).toMatch(/maxAllowed/i);
    });
  });

  describe('evaluateLockMemberCount (minimum / maximum)', () => {
    const defaultEvent = { min_team_size: 2, max_team_size: 4 };

    it('accepts exact minimum (happy path / boundary)', () => {
      const decision = evaluateLockMemberCount(2, defaultEvent);
      expect(decision).toEqual({
        ok: true,
        memberCount: 2,
        minRequired: 2,
        maxAllowed: 4,
      });
    });

    it('accepts exact maximum (happy path / boundary)', () => {
      const decision = evaluateLockMemberCount(4, defaultEvent);
      expect(decision.ok).toBe(true);
      if (decision.ok) {
        expect(decision.memberCount).toBe(4);
        expect(decision.maxAllowed).toBe(4);
      }
    });

    it('rejects one below minimum (invalid / US-022-T2)', () => {
      const decision = evaluateLockMemberCount(1, defaultEvent);
      expect(decision).toEqual({
        ok: false,
        code: 'BELOW_MIN_MEMBERS',
        memberCount: 1,
        minRequired: 2,
        maxAllowed: 4,
      });
    });

    it('rejects zero members (empty / boundary)', () => {
      const decision = evaluateLockMemberCount(0, defaultEvent);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.code).toBe('BELOW_MIN_MEMBERS');
    });

    it('rejects one above maximum (invalid / boundary)', () => {
      const decision = evaluateLockMemberCount(5, defaultEvent);
      expect(decision).toEqual({
        ok: false,
        code: 'ABOVE_MAX_MEMBERS',
        memberCount: 5,
        minRequired: 2,
        maxAllowed: 4,
      });
    });

    it('raises floor to platform minimum of 2 when event min is 1', () => {
      expect(resolveLockMemberBounds({ min_team_size: 1, max_team_size: 4 })).toEqual({
        minRequired: DEFAULT_LOCK_MIN_MEMBERS,
        maxAllowed: DEFAULT_LOCK_MAX_MEMBERS,
      });
      const decision = evaluateLockMemberCount(1, { min_team_size: 1, max_team_size: 4 });
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.code).toBe('BELOW_MIN_MEMBERS');
        expect(decision.minRequired).toBe(2);
      }
    });

    it('honors a higher official event minimum (boundary)', () => {
      const decision = evaluateLockMemberCount(2, { min_team_size: 3, max_team_size: 5 });
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.code).toBe('BELOW_MIN_MEMBERS');
        expect(decision.minRequired).toBe(3);
        expect(decision.maxAllowed).toBe(5);
      }
    });

    it('defaults null event sizes to 2–4', () => {
      const decision = evaluateLockMemberCount(2, { min_team_size: null, max_team_size: null });
      expect(decision).toMatchObject({
        ok: true,
        minRequired: 2,
        maxAllowed: 4,
      });
    });
  });

  describe('summarizeLockLeaveConcurrency (US-022-T3)', () => {
    it('accepts lock-wins: roster Locked, leave rejected, membership unchanged (happy path)', () => {
      const outcome = summarizeLockLeaveConcurrency({
        membersBefore: 2,
        lockSucceeded: true,
        leaveSucceeded: false,
        recruitmentStatusAfter: 'Locked',
        membersAfter: 2,
        leaveErrorCode: 'TEAM_NOT_MUTABLE',
      });
      expect(outcome.winner).toBe('lock');
      expect(outcome.consistent).toBe(true);
      expect(outcome.partialForbidden).toBe(false);
    });

    it('accepts leave-wins: roster Open underfilled, lock gets BELOW_MIN (happy path)', () => {
      const outcome = summarizeLockLeaveConcurrency({
        membersBefore: 2,
        lockSucceeded: false,
        leaveSucceeded: true,
        recruitmentStatusAfter: 'Open',
        membersAfter: 1,
        lockErrorCode: 'BELOW_MIN_MEMBERS',
      });
      expect(outcome.winner).toBe('leave');
      expect(outcome.consistent).toBe(true);
      expect(outcome.partialForbidden).toBe(false);
    });

    it('flags failure when both mutations succeed (integrity / partial)', () => {
      const outcome = summarizeLockLeaveConcurrency({
        membersBefore: 2,
        lockSucceeded: true,
        leaveSucceeded: true,
        recruitmentStatusAfter: 'Locked',
        membersAfter: 1,
      });
      expect(outcome.winner).toBe('neither');
      expect(outcome.consistent).toBe(false);
      expect(outcome.partialForbidden).toBe(true);
    });

    it('flags failure when Locked roster is underfilled after a successful lock', () => {
      const outcome = summarizeLockLeaveConcurrency({
        membersBefore: 2,
        lockSucceeded: true,
        leaveSucceeded: false,
        recruitmentStatusAfter: 'Locked',
        membersAfter: 1,
        leaveErrorCode: 'TEAM_NOT_MUTABLE',
      });
      expect(outcome.partialForbidden).toBe(true);
      expect(outcome.consistent).toBe(false);
    });
  });
});
