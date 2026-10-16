-- Migration: 0010_add_participant_suspension.sql
-- Description: Adds suspension columns so US-003 can block sign-in and session
-- renewal for suspended accounts (US-003 AC 2 / FR-005 / US-003-T4).
-- Full admin suspend workflow is US-027; this migration only stores the flag.

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ NULL;

-- Fast lookup of active vs suspended accounts during auth checks.
CREATE INDEX IF NOT EXISTS idx_participants_is_suspended
  ON participants(is_suspended)
  WHERE is_suspended = TRUE;
