import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POST_LOCK_FROZEN_MUTATIONS,
  POST_LOCK_REJECT_MESSAGE,
  TEAM_NOT_MUTABLE_DEFAULT_MESSAGE,
  isPostLockFrozenMutation,
  teamNotMutablePublicMessage,
  summarizePostLockGuardOutcome,
} from './postLockGuards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('post-lock mutation guards (US-022 / #210 / FR-067)', () => {
  const leaveLockSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0036_lock_team.sql'),
    'utf-8'
  );
  const ownerGuardSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/0013_create_team_listing_functions.sql'),
    'utf-8'
  );

  it('SQL leave_team and owner mutation guard reject non-Open (Locked) recruitment (happy path contract)', () => {
    const leaveIdx = leaveLockSql.indexOf('CREATE OR REPLACE FUNCTION leave_team');
    const lockIdx = leaveLockSql.indexOf('CREATE OR REPLACE FUNCTION lock_team');
    expect(leaveIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(leaveIdx);
    const leaveSql = leaveLockSql.slice(leaveIdx, lockIdx);
    expect(leaveSql).toMatch(/recruitment_status\s*<>\s*'Open'/i);
    expect(leaveSql).toMatch(/TEAM_NOT_MUTABLE/);

    expect(ownerGuardSql).toMatch(/FUNCTION\s+lock_team_for_owner_mutation/i);
    expect(ownerGuardSql).toMatch(/recruitment_status\s*<>\s*'Open'/i);
    expect(ownerGuardSql).toMatch(/TEAM_NOT_MUTABLE/);
    expect(ownerGuardSql).toMatch(/reason',\s*v_team\.recruitment_status/i);
  });

  it('enumerates frozen mutations: leave, remove, slot edits, disband', () => {
    expect(POST_LOCK_FROZEN_MUTATIONS).toEqual([
      'leave',
      'removeMember',
      'addVacancy',
      'updateVacancy',
      'removeVacancy',
      'disband',
    ]);
    expect(isPostLockFrozenMutation('leave')).toBe(true);
    expect(isPostLockFrozenMutation('invite')).toBe(false);
  });

  it('maps Locked reason to explicit freeze message (happy path)', () => {
    expect(teamNotMutablePublicMessage({ reason: 'Locked' })).toBe(POST_LOCK_REJECT_MESSAGE);
    expect(POST_LOCK_REJECT_MESSAGE).toMatch(/leaving/i);
    expect(POST_LOCK_REJECT_MESSAGE).toMatch(/removals/i);
    expect(POST_LOCK_REJECT_MESSAGE).toMatch(/slot edits/i);
    expect(POST_LOCK_REJECT_MESSAGE).toMatch(/disbanding/i);
  });

  it('keeps catalog message for Disbanded / EventNotRecruiting (boundary)', () => {
    expect(teamNotMutablePublicMessage({ reason: 'Disbanded' })).toBe(
      TEAM_NOT_MUTABLE_DEFAULT_MESSAGE
    );
    expect(teamNotMutablePublicMessage({ reason: 'EventNotRecruiting' })).toBe(
      TEAM_NOT_MUTABLE_DEFAULT_MESSAGE
    );
    expect(teamNotMutablePublicMessage(null)).toBe(TEAM_NOT_MUTABLE_DEFAULT_MESSAGE);
    expect(teamNotMutablePublicMessage(undefined)).toBe(TEAM_NOT_MUTABLE_DEFAULT_MESSAGE);
  });

  it('summarizes successful freeze with untouched roster and vacancies (happy path)', () => {
    const outcome = summarizePostLockGuardOutcome({
      recruitmentStatus: 'Locked',
      leaveRejected: true,
      removeRejected: true,
      slotEditRejected: true,
      disbandRejected: true,
      membershipCountBefore: 3,
      membershipCountAfter: 3,
      vacancyCountBefore: 1,
      vacancyCountAfter: 1,
    });
    expect(outcome.frozen).toBe(true);
    expect(outcome.allMutationsRejected).toBe(true);
    expect(outcome.rosterUntouched).toBe(true);
    expect(outcome.vacanciesUntouched).toBe(true);
  });

  it('flags failure when a mutation would change membership or vacancies', () => {
    const outcome = summarizePostLockGuardOutcome({
      recruitmentStatus: 'Locked',
      leaveRejected: true,
      removeRejected: false,
      slotEditRejected: true,
      disbandRejected: true,
      membershipCountBefore: 3,
      membershipCountAfter: 2,
      vacancyCountBefore: 1,
      vacancyCountAfter: 2,
    });
    expect(outcome.allMutationsRejected).toBe(false);
    expect(outcome.rosterUntouched).toBe(false);
    expect(outcome.vacanciesUntouched).toBe(false);
  });

  it('treats Open recruitment as not frozen (boundary / unlocked still mutable)', () => {
    const outcome = summarizePostLockGuardOutcome({
      recruitmentStatus: 'Open',
      leaveRejected: false,
      removeRejected: false,
      slotEditRejected: false,
      disbandRejected: false,
      membershipCountBefore: 2,
      membershipCountAfter: 1,
      vacancyCountBefore: 0,
      vacancyCountAfter: 0,
    });
    expect(outcome.frozen).toBe(false);
  });
});
