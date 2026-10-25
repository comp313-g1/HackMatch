-- Migration: 0042_add_participant_presence_status.sql
-- Description: US-030 / #343 / FR-086 — participant chat presence status field.
-- Verified active PART may set Online, Idle, Do Not Disturb, or Invisible via API.
-- Visitors never see presence; suspended/unverified accounts are denied at the API layer.
-- Default Invisible so new accounts do not appear Online until they opt in.

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS presence_status VARCHAR(32) NOT NULL DEFAULT 'Invisible';

ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS chk_participants_presence_status;

ALTER TABLE participants
  ADD CONSTRAINT chk_participants_presence_status CHECK (
    presence_status IN ('Online', 'Idle', 'Do Not Disturb', 'Invisible')
  );

CREATE INDEX IF NOT EXISTS idx_participants_presence_status
  ON participants(presence_status)
  WHERE presence_status <> 'Invisible';

COMMENT ON COLUMN participants.presence_status IS
  'US-030 / #343 / FR-086: Online | Idle | Do Not Disturb | Invisible. Visitors never see presence.';
