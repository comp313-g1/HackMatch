-- Migration: 0037_create_moderation_cases.sql
-- Description: Creates moderation_cases for US-026 / FR-075 safety queue.
-- ADMIN opens cases against team listings, participant profiles, or suspicious URLs.
-- Decision actions (dismiss/redact/warn/hide/URL-disable) and discovery exclusion ship in later tasks.

-- 1. Only ADMIN actors may open moderation cases (mirrors event_action_records)
CREATE OR REPLACE FUNCTION check_moderation_case_creator_role()
RETURNS TRIGGER AS $$
DECLARE
  v_role VARCHAR(10);
BEGIN
  SELECT role INTO v_role FROM participants WHERE id = NEW.created_by;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Creator not found in participants';
  ELSIF v_role != 'ADMIN' THEN
    RAISE EXCEPTION 'Creator must have ADMIN role to open a moderation case';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Moderation Cases Table (US-026 AC 1 / FR-075)
CREATE TABLE IF NOT EXISTS moderation_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('team', 'profile', 'url')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) > 0 AND LENGTH(reason) <= 2000),
  status VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Dismissed', 'Resolved')),
  created_by UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  flagged_url VARCHAR(2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_moderation_cases_url_requires_flagged_url CHECK (
    (target_type = 'url' AND flagged_url IS NOT NULL AND LENGTH(TRIM(flagged_url)) > 0)
    OR (target_type <> 'url' AND flagged_url IS NULL)
  ),
  CONSTRAINT chk_moderation_cases_flagged_url_https CHECK (
    flagged_url IS NULL
    OR (flagged_url LIKE 'https://%' AND LENGTH(flagged_url) > 8 AND LENGTH(flagged_url) <= 2048)
  )
);

-- 3. Row Level Security (zero public policies; service role via Express only)
ALTER TABLE moderation_cases ENABLE ROW LEVEL SECURITY;

-- 4. Indexes — newest-first queue (FR-075) and target lookup
CREATE INDEX IF NOT EXISTS idx_moderation_cases_created_at
  ON moderation_cases(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_status_created_at
  ON moderation_cases(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_target
  ON moderation_cases(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_created_by
  ON moderation_cases(created_by);

-- 5. Triggers
DROP TRIGGER IF EXISTS trigger_check_moderation_case_creator_role ON moderation_cases;
CREATE TRIGGER trigger_check_moderation_case_creator_role
  BEFORE INSERT ON moderation_cases
  FOR EACH ROW
  EXECUTE FUNCTION check_moderation_case_creator_role();

DROP TRIGGER IF EXISTS trigger_moderation_cases_updated_at ON moderation_cases;
CREATE TRIGGER trigger_moderation_cases_updated_at
  BEFORE UPDATE ON moderation_cases
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
