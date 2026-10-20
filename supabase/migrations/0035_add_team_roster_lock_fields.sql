-- Migration: 0035_add_team_roster_lock_fields.sql
-- Description: US-022 / #206 / FR-066 — add server-side roster lock timestamp (locked_at)
--              and integrity rules tying Locked recruitment_status to that timestamp.
--              The atomic lock RPC that writes these fields ships in a later US-022 task.

-- 1. Server lock timestamp (NULL while Open or Disbanded; set when Locked)
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

COMMENT ON COLUMN teams.locked_at IS
  'US-022 / FR-066: server-recorded roster lock time. Set only when recruitment_status = Locked.';

-- 2. Integrity: Locked requires locked_at; non-Locked forbids locked_at
ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS chk_teams_locked_at_matches_status;

ALTER TABLE teams
  ADD CONSTRAINT chk_teams_locked_at_matches_status
  CHECK (
    (recruitment_status = 'Locked' AND locked_at IS NOT NULL)
    OR
    (recruitment_status <> 'Locked' AND locked_at IS NULL)
  );

-- 3. Lookup aid for locked rosters
CREATE INDEX IF NOT EXISTS idx_teams_locked_at
  ON teams (locked_at)
  WHERE locked_at IS NOT NULL;
