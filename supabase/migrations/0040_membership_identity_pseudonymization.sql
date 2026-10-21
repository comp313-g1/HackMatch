-- Migration: 0040_membership_identity_pseudonymization.sql
-- Description: US-027 / #253 / FR-078 — historical membership identity snapshots
-- for deletion-time pseudonymization while preserving locked roster membership rows.
-- Locked team memberships are never deleted by account deletion; identifying
-- snapshot fields are replaced with non-identifying labels.

-- ---------------------------------------------------------------------------
-- 1. Snapshot / pseudonym columns on team_memberships
-- ---------------------------------------------------------------------------

ALTER TABLE team_memberships
  ADD COLUMN IF NOT EXISTS identity_display_name VARCHAR(120) NULL;

ALTER TABLE team_memberships
  ADD COLUMN IF NOT EXISTS identity_handle VARCHAR(50) NULL;

ALTER TABLE team_memberships
  ADD COLUMN IF NOT EXISTS identity_email VARCHAR(255) NULL;

ALTER TABLE team_memberships
  ADD COLUMN IF NOT EXISTS identity_pseudonymized_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN team_memberships.identity_display_name IS
  'US-027 / #253: roster display label. After deletion this holds a non-identifying pseudonym.';
COMMENT ON COLUMN team_memberships.identity_handle IS
  'US-027 / #253: optional historical handle snapshot; cleared when pseudonymized.';
COMMENT ON COLUMN team_memberships.identity_email IS
  'US-027 / #253: optional historical email snapshot; cleared when pseudonymized.';
COMMENT ON COLUMN team_memberships.identity_pseudonymized_at IS
  'US-027 / #253: set when identifying snapshot fields were replaced with a pseudonym.';

-- When pseudonymized, a non-empty display label is required and email/handle must be cleared.
ALTER TABLE team_memberships
  DROP CONSTRAINT IF EXISTS chk_team_memberships_identity_pseudonymized;

ALTER TABLE team_memberships
  ADD CONSTRAINT chk_team_memberships_identity_pseudonymized CHECK (
    identity_pseudonymized_at IS NULL
    OR (
      identity_display_name IS NOT NULL
      AND LENGTH(TRIM(identity_display_name)) > 0
      AND LENGTH(identity_display_name) <= 120
      AND identity_handle IS NULL
      AND identity_email IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_team_memberships_identity_pseudonymized_at
  ON team_memberships(identity_pseudonymized_at)
  WHERE identity_pseudonymized_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_memberships_participant_pseudonymized
  ON team_memberships(participant_id)
  WHERE identity_pseudonymized_at IS NOT NULL;
