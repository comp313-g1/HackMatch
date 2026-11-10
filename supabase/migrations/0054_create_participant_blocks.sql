-- Migration: 0054_create_participant_blocks.sql
-- Description: US-032 / #388 / FR-091 — who has blocked whom, so direct messages can be denied
-- between a blocker and the person they blocked. A block is directional (A blocks B) but the
-- API treats it as stopping messages in BOTH directions. Block/unblock endpoints and UI are
-- not part of this migration.
--
-- Rules enforced here:
--   * A participant cannot block themselves.
--   * One row per (blocker, blocked) pair.
--   * Participants with block rows cannot be deleted (RESTRICT), so history stays intact.
-- Access: RLS enabled with zero public policies (Express service role only).
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS participant_blocks (
  blocker_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  blocked_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT chk_participant_blocks_not_self CHECK (blocker_id <> blocked_id)
);

ALTER TABLE participant_blocks ENABLE ROW LEVEL SECURITY;

-- The primary key serves "who did X block"; this serves "who blocked X".
CREATE INDEX IF NOT EXISTS idx_participant_blocks_blocked
  ON participant_blocks(blocked_id);

COMMENT ON TABLE participant_blocks IS
  'US-032 / #388 / FR-091: directional block list; a block in either direction stops direct messages between the two participants.';
