-- Migration: 0048_create_moderation_reports.sql
-- Description: Creates moderation_reports and target reference rules for US-025 (#231 / FR-073 / FR-074).
-- Allows signed-in PART users to report visible team listings, permitted profiles, Verified event listings, or suspicious external URLs.
-- Enforces at most 5 reports per account per rolling hour and links reports to US-026 moderation_cases.

-- 1. Extend moderation_cases target_type constraint to support Verified event listings ('event') in addition to 'team', 'profile', and 'url'
ALTER TABLE moderation_cases DROP CONSTRAINT IF EXISTS moderation_cases_target_type_check;
ALTER TABLE moderation_cases ADD CONSTRAINT moderation_cases_target_type_check
  CHECK (target_type IN ('team', 'profile', 'event', 'url'));

-- 2. Allow moderation_cases to be opened either directly by an ADMIN (report_count >= 0) or via a PART report submission (report_count >= 1)
CREATE OR REPLACE FUNCTION check_moderation_case_creator_role()
RETURNS TRIGGER AS $$
DECLARE
  v_role VARCHAR(20);
BEGIN
  SELECT role INTO v_role FROM participants WHERE id = NEW.created_by;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Creator not found in participants';
  ELSIF v_role != 'ADMIN' AND NOT (v_role = 'PART' AND NEW.report_count >= 1) THEN
    RAISE EXCEPTION 'Creator of a moderation case must have the ADMIN role or be a PART submitting a report';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Moderation Reports Table (US-025 AC 1-4 / FR-073 / FR-074)
CREATE TABLE IF NOT EXISTS moderation_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('team', 'profile', 'event', 'url')),
  target_id UUID NOT NULL,
  category VARCHAR(30) NOT NULL CHECK (category IN ('Harassment', 'Spam', 'Phishing Link', 'Fake Account')),
  explanation TEXT NULL CHECK (explanation IS NULL OR (LENGTH(TRIM(explanation)) > 0 AND LENGTH(explanation) <= 1000)),
  flagged_url VARCHAR(2048) NULL CHECK (
    flagged_url IS NULL
    OR (flagged_url LIKE 'https://%' AND LENGTH(flagged_url) > 8 AND LENGTH(flagged_url) <= 2048)
  ),
  case_id UUID NULL REFERENCES moderation_cases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_moderation_reports_url_requires_flagged_url CHECK (
    target_type <> 'url' OR (flagged_url IS NOT NULL AND LENGTH(TRIM(flagged_url)) > 8)
  )
);

-- 4. Row Level Security (NR-004 / US-025 AC 2: other participants cannot read reports; zero public policies)
ALTER TABLE moderation_reports ENABLE ROW LEVEL SECURITY;

-- 5. Indexes for rolling 1-hour rate limit (FR-074), target lookups, and case linkage
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter_created_at
  ON moderation_reports(reporter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_target
  ON moderation_reports(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_case_id
  ON moderation_reports(case_id);

-- 6. Target & Reporter Reference Validation Trigger
CREATE OR REPLACE FUNCTION validate_moderation_report_target()
RETURNS TRIGGER AS $$
DECLARE
  v_reporter_role VARCHAR(20);
  v_reporter_suspended BOOLEAN;
  v_reporter_deactivated BOOLEAN;
  v_target_exists BOOLEAN := FALSE;
BEGIN
  SELECT role, COALESCE(is_suspended, FALSE), COALESCE(is_deactivated, FALSE)
    INTO v_reporter_role, v_reporter_suspended, v_reporter_deactivated
    FROM participants
   WHERE id = NEW.reporter_id;

  IF v_reporter_role IS NULL OR v_reporter_role <> 'PART' THEN
    RAISE EXCEPTION 'Reporter must be a valid PART account';
  END IF;

  IF v_reporter_suspended OR v_reporter_deactivated THEN
    RAISE EXCEPTION 'Suspended or deactivated accounts cannot submit moderation reports';
  END IF;

  IF NEW.target_type = 'team' THEN
    SELECT EXISTS (
      SELECT 1 FROM teams
       WHERE id = NEW.target_id
         AND COALESCE(moderation_status, 'None') <> 'Hidden'
         AND recruitment_status <> 'Disbanded'
    ) INTO v_target_exists;
  ELSIF NEW.target_type = 'profile' THEN
    IF NEW.target_id = NEW.reporter_id THEN
      RAISE EXCEPTION 'SELF_REPORT_FORBIDDEN: Participants cannot report their own profile';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM participants p
       LEFT JOIN participant_profiles pp ON pp.participant_id = p.id
       WHERE p.id = NEW.target_id
         AND p.role = 'PART'
         AND COALESCE(p.is_suspended, FALSE) = FALSE
         AND COALESCE(p.is_deactivated, FALSE) = FALSE
         AND COALESCE(pp.moderation_status, 'None') <> 'Hidden'
    ) INTO v_target_exists;
  ELSIF NEW.target_type = 'event' THEN
    SELECT EXISTS (
      SELECT 1 FROM events
       WHERE id = NEW.target_id
         AND status = 'Published'
    ) INTO v_target_exists;
  ELSIF NEW.target_type = 'url' THEN
    SELECT (
      EXISTS (
        SELECT 1 FROM teams
         WHERE id = NEW.target_id
           AND COALESCE(moderation_status, 'None') <> 'Hidden'
           AND recruitment_status <> 'Disbanded'
      )
      OR EXISTS (
        SELECT 1 FROM participants p
         LEFT JOIN participant_profiles pp ON pp.participant_id = p.id
         WHERE p.id = NEW.target_id
           AND p.role = 'PART'
           AND COALESCE(p.is_suspended, FALSE) = FALSE
           AND COALESCE(p.is_deactivated, FALSE) = FALSE
           AND COALESCE(pp.moderation_status, 'None') <> 'Hidden'
      )
      OR EXISTS (
        SELECT 1 FROM events
         WHERE id = NEW.target_id
           AND status = 'Published'
      )
    ) INTO v_target_exists;
  END IF;

  IF NOT v_target_exists THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND: Moderation report target does not exist or is not eligible for reporting';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_moderation_reports_target_ref ON moderation_reports;
CREATE TRIGGER trg_moderation_reports_target_ref
  BEFORE INSERT ON moderation_reports
  FOR EACH ROW
  EXECUTE FUNCTION validate_moderation_report_target();

-- 7. Service-role-only atomic report submission function with rolling 1-hour limit and US-026 case linkage
CREATE OR REPLACE FUNCTION submit_moderation_report(
  p_reporter UUID,
  p_target_type VARCHAR,
  p_target_id UUID,
  p_category VARCHAR,
  p_explanation TEXT DEFAULT NULL,
  p_flagged_url VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  report_id UUID,
  case_id UUID,
  report_created_at TIMESTAMPTZ,
  reports_used_in_window INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count INTEGER;
  v_case_id UUID;
  v_report_id UUID;
  v_created_at TIMESTAMPTZ;
  v_clean_explanation TEXT;
  v_clean_url VARCHAR(2048);
  v_case_reason TEXT;
BEGIN
  -- Serialize report submissions per reporter account
  PERFORM pg_advisory_xact_lock(hashtextextended('hackmatch:report:actor:' || COALESCE(p_reporter::text, ''), 0));

  -- Rolling 60-minute rate limit check (at most 5 reports per account per rolling hour, FR-074)
  SELECT COUNT(*)::INTEGER
    INTO v_recent_count
    FROM moderation_reports
   WHERE reporter_id = p_reporter
     AND created_at > NOW() - INTERVAL '1 hour';

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMITED: Maximum of 5 moderation reports per rolling hour exceeded';
  END IF;

  v_clean_explanation := NULLIF(TRIM(COALESCE(p_explanation, '')), '');
  v_clean_url := NULLIF(TRIM(COALESCE(p_flagged_url, '')), '');
  v_case_reason := '[' || TRIM(COALESCE(p_category, '')) || '] ' || COALESCE(v_clean_explanation, 'Participant moderation report.');

  -- Find existing Open moderation case for the same target or open a new one (US-026 linkage)
  SELECT mc.id
    INTO v_case_id
    FROM moderation_cases mc
   WHERE mc.status = 'Open'
     AND mc.target_type = p_target_type
     AND mc.target_id = p_target_id
     AND (p_target_type <> 'url' OR mc.flagged_url = v_clean_url)
   ORDER BY mc.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_case_id IS NOT NULL THEN
    UPDATE moderation_cases
       SET report_count = report_count + 1,
           updated_at = NOW()
     WHERE id = v_case_id;
  ELSE
    INSERT INTO moderation_cases (
      target_type,
      target_id,
      reason,
      status,
      created_by,
      report_count,
      flagged_url
    ) VALUES (
      p_target_type,
      p_target_id,
      LEFT(v_case_reason, 2000),
      'Open',
      p_reporter,
      1,
      CASE WHEN p_target_type = 'url' THEN v_clean_url ELSE NULL END
    )
    RETURNING id INTO v_case_id;
  END IF;

  INSERT INTO moderation_reports (
    reporter_id,
    target_type,
    target_id,
    category,
    explanation,
    flagged_url,
    case_id
  ) VALUES (
    p_reporter,
    p_target_type,
    p_target_id,
    p_category,
    v_clean_explanation,
    v_clean_url,
    v_case_id
  )
  RETURNING id, created_at INTO v_report_id, v_created_at;

  RETURN QUERY SELECT v_report_id, v_case_id, v_created_at, (v_recent_count + 1);
END;
$$;

REVOKE ALL ON FUNCTION submit_moderation_report(UUID, VARCHAR, UUID, VARCHAR, TEXT, VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_moderation_report(UUID, VARCHAR, UUID, VARCHAR, TEXT, VARCHAR) TO service_role;
