-- Migration: 0025_prioritize_application_submission_errors.sql
-- US-018 / #176: return the specific duplicate-team error before the broader
-- per-event pending limit, including under concurrent submissions.

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
  v_duplicate_application_id UUID;
  v_pending_count INTEGER;
  v_message TEXT;
  v_owner_alert TEXT;
BEGIN
  IF p_actor IS NULL OR p_team IS NULL OR p_vacancy IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('field', 'vacancyId')::text;
  END IF;

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

  -- Serializes every submission by this applicant so duplicate and quota
  -- decisions remain stable until the transaction commits.
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

  IF EXISTS (
    SELECT 1
    FROM team_memberships
    WHERE event_id = v_team.event_id
      AND participant_id = p_actor
      AND status = 'Confirmed'
  ) THEN
    RAISE EXCEPTION 'APPLICANT_ALREADY_CONFIRMED' USING ERRCODE = 'P0001';
  END IF;

  -- A same-team conflict is more specific than the broader event quota.
  SELECT id INTO v_duplicate_application_id
  FROM team_requests
  WHERE team_id = p_team
    AND participant_id = p_actor
    AND request_type = 'Application'
    AND status = 'Pending'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'DUPLICATE_PENDING_APPLICATION'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'teamId', p_team,
              'existingApplicationId', v_duplicate_application_id
            )::text;
  END IF;

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
      SELECT id INTO v_duplicate_application_id
      FROM team_requests
      WHERE team_id = p_team
        AND participant_id = p_actor
        AND request_type = 'Application'
        AND status = 'Pending'
      LIMIT 1;

      RAISE EXCEPTION 'DUPLICATE_PENDING_APPLICATION'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'teamId', p_team,
                'existingApplicationId', v_duplicate_application_id
              )::text;
    WHEN check_violation THEN
      RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END;

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

REVOKE ALL ON FUNCTION submit_team_application(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_team_application(UUID, UUID, UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION submit_team_application(UUID, UUID, UUID, TEXT) IS
  'US-018 / #176: atomically submit with duplicate-team errors prioritized before the per-event pending limit.';
