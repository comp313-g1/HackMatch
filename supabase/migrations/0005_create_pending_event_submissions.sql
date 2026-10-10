-- Migration: 0005_create_pending_event_submissions.sql
-- Description: Creates pending_event_submissions table, constraints, partial unique index, and RLS

CREATE TABLE IF NOT EXISTS pending_event_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submitter_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
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
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Merged')),
  admin_feedback TEXT,
  canonical_event_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pending_event_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_pending_event_min_team_size CHECK (min_team_size IS NULL OR min_team_size > 0),
  CONSTRAINT chk_pending_event_max_team_size CHECK (max_team_size IS NULL OR max_team_size > 0),
  CONSTRAINT chk_pending_event_team_limits CHECK (min_team_size IS NULL OR max_team_size IS NULL OR max_team_size >= min_team_size)
);

-- Enable Row Level Security (zero public policies to deny PostgREST anon access)
ALTER TABLE pending_event_submissions ENABLE ROW LEVEL SECURITY;

-- Indexes
-- Partial unique index on active pending submissions to block simultaneous duplicates while allowing resubmission (US-009 AC 5)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_event_submissions_dedup_pending
  ON pending_event_submissions(normalized_url, start_date)
  WHERE status = 'Pending';

-- Submitter lookup index
CREATE INDEX IF NOT EXISTS idx_pending_event_submissions_submitter_id
  ON pending_event_submissions(submitter_id);

-- Admin queue and status filtering index
CREATE INDEX IF NOT EXISTS idx_pending_event_submissions_status
  ON pending_event_submissions(status);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_pending_event_submissions_updated_at ON pending_event_submissions;
CREATE TRIGGER trigger_pending_event_submissions_updated_at
  BEFORE UPDATE ON pending_event_submissions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
