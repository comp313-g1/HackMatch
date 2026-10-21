-- Migration: 0038_moderation_enforcement_fields.sql
-- Description: Team/profile moderation enforcement fields for US-026 / #242
-- (hide listing, warn, URL disable with removal notice). Discovery exclusion uses
-- moderation_hidden_at; historical memberships are never deleted by these actions.

-- 1. Team listing moderation fields (FR-075 / FR-076)
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS moderation_hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(30) NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS link_removal_notice VARCHAR(500);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_teams_moderation_status'
  ) THEN
    ALTER TABLE teams
      ADD CONSTRAINT chk_teams_moderation_status
      CHECK (moderation_status IN ('None', 'Warned', 'Hidden'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_teams_moderation_hidden_matches_status'
  ) THEN
    ALTER TABLE teams
      ADD CONSTRAINT chk_teams_moderation_hidden_matches_status
      CHECK (
        (moderation_status = 'Hidden' AND moderation_hidden_at IS NOT NULL)
        OR (moderation_status <> 'Hidden' AND moderation_hidden_at IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_teams_moderation_hidden_at
  ON teams(moderation_hidden_at)
  WHERE moderation_hidden_at IS NOT NULL;

-- 2. Profile moderation warning / hide marker (hide from ordinary discovery later)
ALTER TABLE participant_profiles
  ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(30) NOT NULL DEFAULT 'None';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_participant_profiles_moderation_status'
  ) THEN
    ALTER TABLE participant_profiles
      ADD CONSTRAINT chk_participant_profiles_moderation_status
      CHECK (moderation_status IN ('None', 'Warned', 'Hidden'));
  END IF;
END $$;

-- 3. Case resolution metadata for decide actions
ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_action_type VARCHAR(40);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_moderation_cases_last_action_type'
  ) THEN
    ALTER TABLE moderation_cases
      ADD CONSTRAINT chk_moderation_cases_last_action_type
      CHECK (
        last_action_type IS NULL
        OR last_action_type IN ('dismiss', 'redact', 'warn', 'hide', 'disable_url')
      );
  END IF;
END $$;
