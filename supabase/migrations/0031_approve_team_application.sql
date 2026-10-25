-- Migration: 0031_approve_team_application.sql
-- Description: US-020 / #190 / FR-061 / FR-083 — owner-only atomic application
-- approval with current account, event, team, vacancy, capacity, and membership checks.

CREATE OR REPLACE FUNCTION approve_team_application(
  p_actor UUID,
  p_application UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_probe team_requests%ROWTYPE;
  v_req team_requests%ROWTYPE;
  v_team teams%ROWTYPE;
  v_vacancy team_vacancies%ROWTYPE;
  v_applicant participants%ROWTYPE;
  v_event RECORD;
  v_membership team_memberships%ROWTYPE;
  v_member_count INTEGER;
  v_max_team_size INTEGER;
  v_availability_count INTEGER := 0;
BEGIN
  IF p_actor IS NULL OR p_application IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('field', 'applicationId')::text;
  END IF;

  -- Probe before locking so every placement route reaches the shared advisory
  -- lock boundary without holding a request row needed by another transaction.
  SELECT * INTO v_probe
  FROM team_requests
  WHERE id = p_application
    AND request_type = 'Application';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = v_probe.team_id
      AND owner_participant_id = p_actor
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_TEAM_OWNER' USING ERRCODE = 'P0001';
  END IF;

  -- Same canonical locks as accept_team_invitation (#184), so an invitation
  -- and an application cannot both confirm the same participant/event or slot.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hackmatch:accept:participant-event:' || v_probe.participant_id::text
        || ':' || v_probe.event_id::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:accept:team:' || v_probe.team_id::text, 0)
  );

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
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.owner_participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_TEAM_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'APPLICATION_NOT_APPROVABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'applicationId', v_req.id,
              'status', v_req.status,
              'reason', v_req.cancel_reason
            )::text;
  END IF;

  IF v_team.recruitment_status <> 'Open' THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', v_team.recruitment_status)::text;
  END IF;

  SELECT id, status, end_date, max_team_size
  INTO v_event
  FROM events
  WHERE id = v_team.event_id
  FOR SHARE;

  IF NOT FOUND
     OR v_event.status <> 'Published'
     OR v_event.end_date IS NULL
     OR v_event.end_date < now() THEN
    RAISE EXCEPTION 'EVENT_NOT_RECRUITING' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.event_id <> v_team.event_id THEN
    RAISE EXCEPTION 'APPLICATION_NOT_APPROVABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', 'EVENT_MISMATCH')::text;
  END IF;

  IF v_req.vacancy_id IS NULL THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vacancy
  FROM team_vacancies
  WHERE id = v_req.vacancy_id
    AND team_id = v_req.team_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_vacancy.status <> 'Open' THEN
    RAISE EXCEPTION 'VACANCY_NOT_OPEN'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('vacancyStatus', v_vacancy.status)::text;
  END IF;

  SELECT * INTO v_applicant
  FROM participants
  WHERE id = v_req.participant_id
  FOR SHARE;

  IF NOT FOUND
     OR v_applicant.role <> 'PART'
     OR v_applicant.is_verified IS NOT TRUE
     OR v_applicant.is_suspended IS TRUE THEN
    RAISE EXCEPTION 'APPLICATION_APPLICANT_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM team_memberships
    WHERE event_id = v_team.event_id
      AND participant_id = v_req.participant_id
      AND status = 'Confirmed'
  ) THEN
    RAISE EXCEPTION 'APPLICATION_APPLICANT_ALREADY_CONFIRMED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('eventId', v_team.event_id)::text;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_member_count
  FROM team_memberships
  WHERE team_id = v_team.id
    AND status = 'Confirmed';

  v_max_team_size := COALESCE(v_event.max_team_size, 4);
  IF v_member_count >= v_max_team_size THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'current', v_member_count,
              'max', v_max_team_size,
              'teamId', v_team.id
            )::text;
  END IF;

  -- All state changes below share this transaction. Any failure rolls back
  -- availability, membership, vacancy, application, and notification together.
  UPDATE event_availability
  SET is_looking = FALSE,
      updated_at = now()
  WHERE participant_id = v_req.participant_id
    AND (event_id = v_team.event_id OR is_looking IS TRUE)
    AND is_looking IS TRUE;
  GET DIAGNOSTICS v_availability_count = ROW_COUNT;

  BEGIN
    INSERT INTO team_memberships (
      team_id,
      event_id,
      participant_id,
      role,
      status
    ) VALUES (
      v_team.id,
      v_team.event_id,
      v_req.participant_id,
      'Member',
      'Confirmed'
    )
    RETURNING * INTO v_membership;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'APPLICATION_APPROVAL_CONFLICT'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'applicationId', v_req.id,
                'reason', 'EVENT_MEMBERSHIP_CONFIRMED',
                'retryable', FALSE
              )::text;
  END;

  UPDATE team_vacancies
  SET status = 'Filled',
      updated_at = now()
  WHERE id = v_vacancy.id
  RETURNING * INTO v_vacancy;

  UPDATE team_requests
  SET status = 'Accepted',
      cancel_reason = NULL,
      resolved_at = now(),
      updated_at = now()
  WHERE id = v_req.id
  RETURNING * INTO v_req;

  SELECT COUNT(*)::INTEGER INTO v_member_count
  FROM team_memberships
  WHERE team_id = v_team.id
    AND status = 'Confirmed';

  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    v_req.participant_id,
    v_team.id,
    v_team.event_id,
    'team_application_approved',
    LEFT(
      'Your application for the ' || v_vacancy.role || ' slot on "'
        || v_team.name || '" was approved. Your membership is confirmed.',
      500
    )
  );

  RETURN jsonb_build_object(
    'approved', TRUE,
    'application', to_jsonb(v_req),
    'membership', to_jsonb(v_membership),
    'vacancy', to_jsonb(v_vacancy),
    'teamName', v_team.name,
    'vacancyRole', v_vacancy.role,
    'memberCount', v_member_count,
    'maxTeamSize', v_max_team_size,
    'availabilityCleared', v_availability_count > 0,
    'membershipCommitted', TRUE,
    'notice',
      'Application approved. Membership is confirmed and the vacancy is filled.'
  );
EXCEPTION
  WHEN deadlock_detected OR serialization_failure OR lock_not_available THEN
    RAISE EXCEPTION 'APPLICATION_APPROVAL_CONFLICT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'applicationId', p_application,
              'reason', 'DATABASE_CONCURRENCY_RETRY',
              'retryable', TRUE
            )::text;
END;
$$;

REVOKE ALL ON FUNCTION approve_team_application(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_team_application(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION approve_team_application(UUID, UUID) IS
  'US-020 / #190: owner-only atomic application approval with current eligibility, capacity, vacancy, and one-team-per-event checks.';
