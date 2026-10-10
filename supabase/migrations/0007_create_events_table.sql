-- Migration: 0007_create_events_table.sql
-- Description: Creates events table, constraints, indexes, updated_at trigger, RLS, and links pending_event_submissions foreign key

CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title VARCHAR(150) NOT NULL CHECK (LENGTH(TRIM(title)) > 0),
  official_url VARCHAR(2048) NOT NULL CHECK (official_url LIKE 'https://%' AND LENGTH(official_url) > 8),
  normalized_url VARCHAR(2048) NOT NULL CHECK (LENGTH(TRIM(normalized_url)) > 0),
  event_edition VARCHAR(50),
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  format VARCHAR(50) NOT NULL CHECK (LENGTH(TRIM(format)) > 0),
  location VARCHAR(200),
  min_team_size INTEGER,
  max_team_size INTEGER,
  is_link_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'Published' CHECK (status IN ('Published', 'Archived', 'Disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_events_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_events_min_team_size CHECK (min_team_size IS NULL OR min_team_size > 0),
  CONSTRAINT chk_events_max_team_size CHECK (max_team_size IS NULL OR max_team_size > 0),
  CONSTRAINT chk_events_team_limits CHECK (min_team_size IS NULL OR max_team_size IS NULL OR max_team_size >= min_team_size)
);

-- Enable Row Level Security (zero public policies to deny PostgREST anon access)
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Indexes
-- Deduplication index on canonical verified events
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_normalized_url_start_date
  ON events(normalized_url, start_date);

-- Status filtering index (US-008 AC 1, AC 4)
CREATE INDEX IF NOT EXISTS idx_events_status
  ON events(status);

-- Time-state filtering indexes (US-008 AC 2)
CREATE INDEX IF NOT EXISTS idx_events_start_date
  ON events(start_date);

CREATE INDEX IF NOT EXISTS idx_events_end_date
  ON events(end_date);

-- Format filtering index (US-008 AC 2)
CREATE INDEX IF NOT EXISTS idx_events_format
  ON events(format);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_events_updated_at ON events;
CREATE TRIGGER trigger_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Referential integrity link from pending submissions to canonical event (S1-P0-08 / US-010 AC 4)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_canonical_event'
  ) THEN
    ALTER TABLE pending_event_submissions
      ADD CONSTRAINT fk_canonical_event
      FOREIGN KEY (canonical_event_id)
      REFERENCES events(id)
      ON DELETE SET NULL;
  END IF;
END $$;
