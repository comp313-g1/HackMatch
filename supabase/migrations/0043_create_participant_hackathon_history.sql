-- Migration: 0043_create_participant_hackathon_history.sql
-- Description: Creates participant_hackathon_history table for US-007,
-- attaches set_updated_at and check_participant_profile_role triggers,
-- enforces HTTPS URL, non-future calendar dates, team role taxonomy,
-- adds participant + date indexing and duplicate prevention unique index,
-- and enables Row Level Security with zero public policies.

CREATE TABLE IF NOT EXISTS participant_hackathon_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL CHECK (
    LENGTH(TRIM(event_name)) >= 2
    AND LENGTH(TRIM(event_name)) <= 120
  ),
  event_date DATE NOT NULL CHECK (
    event_date >= DATE '2000-01-01'
    AND event_date <= CURRENT_DATE
  ),
  team_role TEXT NOT NULL CHECK (
    team_role IN ('Frontend', 'Backend', 'Mobile', 'AI/ML', 'UI/UX', 'Pitch')
  ),
  project_title TEXT NOT NULL CHECK (
    LENGTH(TRIM(project_title)) >= 2
    AND LENGTH(TRIM(project_title)) <= 120
  ),
  project_url TEXT NOT NULL CHECK (
    project_url LIKE 'https://%'
    AND LENGTH(project_url) > 8
    AND LENGTH(project_url) <= 500
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for ordering by recency per participant
CREATE INDEX IF NOT EXISTS idx_participant_hackathon_history_participant_date
  ON participant_hackathon_history (participant_id, event_date DESC, created_at DESC);

-- Unique index to prevent duplicate submissions per participant
CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_hackathon_history_unique_entry
  ON participant_hackathon_history (
    participant_id,
    LOWER(TRIM(event_name)),
    event_date,
    LOWER(TRIM(project_title))
  );

-- Trigger to maintain updated_at
DROP TRIGGER IF EXISTS trg_participant_hackathon_history_updated_at ON participant_hackathon_history;
CREATE TRIGGER trg_participant_hackathon_history_updated_at
BEFORE UPDATE ON participant_hackathon_history
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Trigger to prevent ADMIN accounts from creating hackathon history records
DROP TRIGGER IF EXISTS trg_participant_hackathon_history_role_check ON participant_hackathon_history;
CREATE TRIGGER trg_participant_hackathon_history_role_check
BEFORE INSERT OR UPDATE ON participant_hackathon_history
FOR EACH ROW
EXECUTE FUNCTION check_participant_profile_role();

-- Row Level Security (Explicitly enabled with zero public policies)
ALTER TABLE participant_hackathon_history ENABLE ROW LEVEL SECURITY;
