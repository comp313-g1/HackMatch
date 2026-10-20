-- Migration: 0033_decline_team_application.sql
-- Description: US-020 / #192 / FR-062 / FR-064 — owner decline of a Pending
-- Review application with basic alerts for both parties. Roster, slot,
-- capacity, and availability state are intentionally unchanged.

CREATE OR REPLACE FUNCTION decline_team_application(
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
  v_applicant_notification_id UUID;
  v_applicant_notification_created_at TIMESTAMPTZ;
  v_owner_notification_id UUID;
  v_owner_notification_created_at TIMESTAMPTZ;
BEGIN
  IF p_actor IS NULL OR p_application IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'actorRequired', p_actor IS NULL,
              'applicationRequired', p_application IS NULL
            )::text;
  END IF;

  -- Serialize owner decisions for this application. #193 can add an
  -- idempotent repeat response while this task returns an explicit conflict.
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

  IF v_team.owner_participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_TEAM_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'APPLICATION_NOT_DECLINABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'applicationId', v_req.id,
              'status', v_req.status,
              'reason', v_req.cancel_reason
            )::text;
  END IF;

  UPDATE team_requests
  SET status = 'Declined',
      cancel_reason = 'OWNER_DECLINED',
      resolved_at = now(),
      updated_at = now()
  WHERE id = p_application
  RETURNING * INTO v_req;

  SELECT role INTO v_role
  FROM team_vacancies
  WHERE id = v_req.vacancy_id;

  v_applicant_msg := 'Your application to "' || v_team.name || '"'
    || CASE WHEN v_role IS NOT NULL THEN ' for the ' || v_role || ' slot' ELSE '' END
    || ' was declined.';

  v_owner_msg := 'You declined a Pending Review application'
    || CASE WHEN v_role IS NOT NULL THEN ' for the ' || v_role || ' slot' ELSE '' END
    || ' on "' || v_team.name || '".';

  -- Basic lifecycle alerts (FR-062 / FR-064). These inserts share the decline
  -- transaction, so alert persistence failure rolls back the decision.
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
    'team_application_declined',
    LEFT(v_applicant_msg, 500)
  )
  RETURNING id, created_at
  INTO v_applicant_notification_id, v_applicant_notification_created_at;

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
    'team_application_declined',
    LEFT(v_owner_msg, 500)
  )
  RETURNING id, created_at
  INTO v_owner_notification_id, v_owner_notification_created_at;

  RETURN jsonb_build_object(
    'application', to_jsonb(v_req),
    'changed', TRUE,
    'idempotent', FALSE,
    'teamName', v_team.name,
    'vacancyRole', v_role,
    'alerts', jsonb_build_array(
      jsonb_build_object(
        'audience', 'applicant',
        'type', 'team_application_declined',
        'message', LEFT(v_applicant_msg, 500),
        'notificationId', v_applicant_notification_id,
        'createdAt', v_applicant_notification_created_at
      ),
      jsonb_build_object(
        'audience', 'owner',
        'type', 'team_application_declined',
        'message', LEFT(v_owner_msg, 500),
        'notificationId', v_owner_notification_id,
        'createdAt', v_owner_notification_created_at
      )
    ),
    'effects', jsonb_build_object(
      'applicationChanged', TRUE,
      'applicantAlertCreated', TRUE,
      'ownerAlertCreated', TRUE,
      'pendingQuotaReleased', TRUE,
      'availabilityChanged', FALSE,
      'membershipChanged', FALSE,
      'vacancyChanged', FALSE,
      'capacityChanged', FALSE
    ),
    'notice',
      'Application declined. The applicant was notified; membership, vacancy, capacity, and availability are unchanged.'
  );
END;
$$;

REVOKE ALL ON FUNCTION decline_team_application(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION decline_team_application(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION decline_team_application(UUID, UUID) IS
  'US-020 / #192 / FR-062: owner declines a Pending Review application, alerts both parties, releases pending quota, and leaves roster/slot state unchanged.';
