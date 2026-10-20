-- Migration: 0023_create_team_application_model.sql
-- Description: Completes the US-018 / #170 PostgreSQL application model on team_requests:
--   Pending Review status (status = 'Pending'), optional message <=250, slot binding,
--   duplicate pending-per-team unique, 3 pending-per-event quota index, and atomic
--   submit_team_application (FR-053, FR-054).
-- Builds on 0011 (team_requests + Application request_type) and invitation migrations
-- that leave expires_at NULL for Application rows.
--
-- Application row contract (request_type = 'Application'):
--   Keys: id, team_id, event_id, vacancy_id (slot), participant_id (applicant)
--   Status: Pending | Accepted | Declined | Withdrawn | Canceled (Expired unused)
--   Message: optional VARCHAR(250); Pending Review does not confirm membership
--   Quotas: one Pending Application per (team, applicant); <=3 Pending per (applicant, event)

-- 1. Optional applicant pitch / note (FR-053 / R-02)
ALTER TABLE team_requests
  ADD COLUMN IF NOT EXISTS message VARCHAR(250) NULL;

ALTER TABLE team_requests
  DROP CONSTRAINT IF EXISTS chk_team_requests_application_message_length,
  ADD CONSTRAINT chk_team_requests_application_message_length
    CHECK (
      message IS NULL
      OR char_length(message) <= 250
    );

-- 2. Pending applications must target an open slot (slot relation / FR-053).
--    Non-pending rows may keep vacancy_id NULL after slot removal (ON DELETE SET NULL).
ALTER TABLE team_requests
  DROP CONSTRAINT IF EXISTS chk_team_requests_pending_application_requires_vacancy,
  ADD CONSTRAINT chk_team_requests_pending_application_requires_vacancy
    CHECK (
      NOT (
        request_type = 'Application'
        AND status = 'Pending'
        AND vacancy_id IS NULL
      )
    );

-- 3. At most one Pending Application per team and applicant (FR-053 duplicate reject)
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_requests_pending_application
  ON team_requests(team_id, participant_id)
  WHERE request_type = 'Application'
    AND status = 'Pending';

-- Backstop for FR-054 COUNT … FOR UPDATE (3 Pending Applications per PART/event)
CREATE INDEX IF NOT EXISTS idx_team_requests_pending_application_per_event
  ON team_requests(participant_id, event_id)
  WHERE request_type = 'Application'
    AND status = 'Pending';

-- Applicant inbox / My Applications
CREATE INDEX IF NOT EXISTS idx_team_requests_applicant_application_status
  ON team_requests(participant_id, status, created_at DESC)
  WHERE request_type = 'Application';

-- Owner inbound application review lists (US-020)
CREATE INDEX IF NOT EXISTS idx_team_requests_team_application_status
  ON team_requests(team_id, status, created_at DESC)
  WHERE request_type = 'Application';

-- 4. Atomic applicant submission with eligibility, duplicate, and 3-pending checks
CREATE OR REPLACE FUNCTION submit_team_application(
  p_actor UUID,
  p_team UUID,
  p_vacancy UUID,
  p_message TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_event RECORD;
  v_vacancy team_vacancies%ROWTYPE;
  v_applicant participants%ROWTYPE;
  v_request team_requests%ROWTYPE;
  v_pending_count INTEGER;
  v_message TEXT;
  v_owner_alert TEXT;
BEGIN
  IF p_actor IS NULL OR p_team IS NULL OR p_vacancy IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('field', 'vacancyId')::text;
  END IF;

  -- Normalize optional message (FR-053 / R-02: <=250 characters)
  IF p_message IS NULL OR btrim(p_message) = '' THEN
    v_message := NULL;
  ELSE
    v_message := btrim(p_message);
    IF char_length(v_message) > 250 THEN
      RAISE EXCEPTION 'APPLICATION_MESSAGE_TOO_LONG'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'field', 'message',
                'maxLength', 250,
                'length', char_length(v_message)
              )::text;
    END IF;
  END IF;

  -- Lock applicant first (quota / eligibility)
  SELECT * INTO v_applicant
  FROM participants
  WHERE id = p_actor
  FOR UPDATE;

  IF NOT FOUND
     OR v_applicant.role <> 'PART'
     OR v_applicant.is_verified IS NOT TRUE
     OR v_applicant.is_suspended IS TRUE THEN
    RAISE EXCEPTION 'APPLICANT_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  -- Lock team (applicant is not owner — do not use lock_team_for_owner_mutation)
  SELECT * INTO v_team
  FROM teams
  WHERE id = p_team
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.owner_participant_id = p_actor THEN
    RAISE EXCEPTION 'CANNOT_APPLY_TO_OWN_TEAM' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.recruitment_status <> 'Open' THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', v_team.recruitment_status)::text;
  END IF;

  SELECT id, status, end_date
  INTO v_event
  FROM events
  WHERE id = v_team.event_id
  FOR SHARE;

  IF NOT FOUND OR v_event.status <> 'Published' OR v_event.end_date < now() THEN
    RAISE EXCEPTION 'EVENT_NOT_RECRUITING' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vacancy
  FROM team_vacancies
  WHERE id = p_vacancy
    AND team_id = p_team
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_vacancy.status <> 'Open' THEN
    RAISE EXCEPTION 'VACANCY_NOT_OPEN'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('vacancyStatus', v_vacancy.status)::text;
  END IF;

  -- One confirmed team per participant per hackathon
  IF EXISTS (
    SELECT 1
    FROM team_memberships
    WHERE event_id = v_team.event_id
      AND participant_id = p_actor
      AND status = 'Confirmed'
  ) THEN
    RAISE EXCEPTION 'APPLICANT_ALREADY_CONFIRMED' USING ERRCODE = 'P0001';
  END IF;

  -- FR-054: at most 3 Pending Applications per PART per event (atomic)
  SELECT COUNT(*)::INTEGER INTO v_pending_count
  FROM team_requests
  WHERE participant_id = p_actor
    AND event_id = v_team.event_id
    AND request_type = 'Application'
    AND status = 'Pending';

  IF v_pending_count >= 3 THEN
    RAISE EXCEPTION 'APPLICATION_PENDING_LIMIT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'limit', 3,
              'pendingCount', v_pending_count,
              'eventId', v_team.event_id
            )::text;
  END IF;

  BEGIN
    INSERT INTO team_requests (
      team_id,
      event_id,
      vacancy_id,
      participant_id,
      request_type,
      status,
      expires_at,
      message
    ) VALUES (
      p_team,
      v_team.event_id,
      p_vacancy,
      p_actor,
      'Application',
      'Pending',
      NULL,
      v_message
    )
    RETURNING * INTO v_request;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'DUPLICATE_PENDING_APPLICATION' USING ERRCODE = 'P0001';
    WHEN check_violation THEN
      RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END;

  -- Basic owner alert (FR-053 / FR-064); US-021 not required
  v_owner_alert := 'New application for the ' || v_vacancy.role
    || ' slot on "' || v_team.name || '".';

  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    v_team.owner_participant_id,
    p_team,
    v_team.event_id,
    'team_application_submitted',
    LEFT(v_owner_alert, 500)
  );

  RETURN jsonb_build_object(
    'application', to_jsonb(v_request),
    'vacancyRole', v_vacancy.role,
    'teamName', v_team.name,
    'pendingCountForEvent', v_pending_count + 1,
    'notice', 'Pending Review application created. The team owner has been notified.'
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_team_application(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_team_application(UUID, UUID, UUID, TEXT) TO service_role;

COMMENT ON COLUMN team_requests.message IS
  'Optional applicant pitch for Application rows (max 250 chars). Null for Invitation rows.';

COMMENT ON FUNCTION submit_team_application(UUID, UUID, UUID, TEXT) IS
  'US-018 / #170: atomically submit a Pending Review application to an open vacancy slot.';
