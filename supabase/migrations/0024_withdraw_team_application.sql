-- Migration: 0024_withdraw_team_application.sql
-- Description: US-018 / #175 / FR-055 — applicant withdraw of Pending applications with
--              idempotent repeats, quota release, and basic status alerts for both parties.

CREATE OR REPLACE FUNCTION withdraw_team_application(
  p_actor UUID,
  p_application UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req team_requests%ROWTYPE;
  v_team teams%ROWTYPE;
  v_role TEXT;
  v_applicant_msg TEXT;
  v_owner_msg TEXT;
  v_changed BOOLEAN := FALSE;
BEGIN
  IF p_application IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req
  FROM team_requests
  WHERE id = p_application
    AND request_type = 'Application'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_team
  FROM teams
  WHERE id = v_req.team_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_APPLICANT' USING ERRCODE = 'P0001';
  END IF;

  -- FR-055: repeated withdrawal is idempotent
  IF v_req.status = 'Withdrawn' THEN
    RETURN jsonb_build_object(
      'application', to_jsonb(v_req),
      'changed', FALSE,
      'idempotent', TRUE,
      'teamName', v_team.name,
      'notice', 'Application was already withdrawn.'
    );
  END IF;

  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'APPLICATION_NOT_WITHDRAWABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('status', v_req.status)::text;
  END IF;

  UPDATE team_requests
  SET status = 'Withdrawn',
      cancel_reason = 'APPLICANT_WITHDRAWN',
      resolved_at = now(),
      updated_at = now()
  WHERE id = p_application
  RETURNING * INTO v_req;

  v_changed := TRUE;

  SELECT role INTO v_role
  FROM team_vacancies
  WHERE id = v_req.vacancy_id;

  v_applicant_msg := 'You withdrew your application to "' || v_team.name || '"'
    || CASE WHEN v_role IS NOT NULL THEN ' for the ' || v_role || ' slot' ELSE '' END
    || '.';

  v_owner_msg := 'An applicant withdrew their Pending Review application'
    || CASE WHEN v_role IS NOT NULL THEN ' for the ' || v_role || ' slot' ELSE '' END
    || ' on "' || v_team.name || '".';

  -- Basic status alerts (FR-055 / FR-064) — both parties, without US-021 centre
  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    v_req.participant_id,
    v_req.team_id,
    v_req.event_id,
    'team_application_withdrawn',
    LEFT(v_applicant_msg, 500)
  );

  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    v_team.owner_participant_id,
    v_req.team_id,
    v_req.event_id,
    'team_application_withdrawn',
    LEFT(v_owner_msg, 500)
  );

  RETURN jsonb_build_object(
    'application', to_jsonb(v_req),
    'changed', v_changed,
    'idempotent', FALSE,
    'teamName', v_team.name,
    'vacancyRole', v_role,
    'alerts', jsonb_build_array(
      jsonb_build_object(
        'audience', 'applicant',
        'type', 'team_application_withdrawn',
        'message', LEFT(v_applicant_msg, 500)
      ),
      jsonb_build_object(
        'audience', 'owner',
        'type', 'team_application_withdrawn',
        'message', LEFT(v_owner_msg, 500)
      )
    ),
    'notice', 'Pending Review application withdrawn. Your pending quota for this event is released.'
  );
END;
$$;

REVOKE ALL ON FUNCTION withdraw_team_application(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION withdraw_team_application(UUID, UUID) TO service_role;

COMMENT ON FUNCTION withdraw_team_application(UUID, UUID) IS
  'US-018 / #175 / FR-055: applicant withdraws a Pending Review application; releases FR-054 quota; alerts both parties.';
