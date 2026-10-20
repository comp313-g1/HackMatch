-- Migration: 0027_accept_team_invitation.sql
-- Description: US-019 / #180 / FR-056 / FR-083 — atomically revalidate a
-- Pending invitation, confirm membership, fill its vacancy, and clear the
-- invitee's Looking-for-Team state without partial writes.

CREATE OR REPLACE FUNCTION accept_team_invitation(
  p_actor UUID,
  p_invitation UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req team_requests%ROWTYPE;
  v_team teams%ROWTYPE;
  v_vacancy team_vacancies%ROWTYPE;
  v_invitee participants%ROWTYPE;
  v_event RECORD;
  v_membership team_memberships%ROWTYPE;
  v_member_count INTEGER;
  v_max_team_size INTEGER;
  v_availability_count INTEGER := 0;
BEGIN
  IF p_actor IS NULL OR p_invitation IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('field', 'invitationId')::text;
  END IF;

  -- Serialize every decision for this invitation. This also matches the
  -- existing cancellation RPC's first lock, so accept/cancel cannot both win.
  SELECT * INTO v_req
  FROM team_requests
  WHERE id = p_invitation
    AND request_type = 'Invitation'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_INVITEE' USING ERRCODE = 'P0001';
  END IF;

  -- Persisting expiry and then raising would roll the status update back.
  -- Return a domain failure payload so the adapter can emit HTTP 409 while the
  -- Expired transition commits and releases Pending invitation quotas.
  IF v_req.status = 'Pending'
     AND (v_req.expires_at IS NULL OR v_req.expires_at <= now()) THEN
    UPDATE team_requests
    SET status = 'Expired',
        resolved_at = now(),
        updated_at = now()
    WHERE id = p_invitation
    RETURNING * INTO v_req;

    RETURN jsonb_build_object(
      'error', 'INVITATION_EXPIRED',
      'details', jsonb_build_object(
        'status', v_req.status,
        'expiresAt', v_req.expires_at
      )
    );
  END IF;

  IF v_req.status = 'Expired' THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'status', v_req.status,
              'expiresAt', v_req.expires_at
            )::text;
  END IF;

  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'INVITATION_NOT_ACCEPTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('status', v_req.status)::text;
  END IF;

  SELECT * INTO v_team
  FROM teams
  WHERE id = v_req.team_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'INVITATION_NOT_ACCEPTABLE'
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

  -- Keep the account stable until the membership write commits. Express auth
  -- performs the same checks, while this is the authoritative race-safe guard.
  SELECT * INTO v_invitee
  FROM participants
  WHERE id = p_actor
  FOR SHARE;

  IF NOT FOUND
     OR v_invitee.role <> 'PART'
     OR v_invitee.is_verified IS NOT TRUE
     OR v_invitee.is_suspended IS TRUE THEN
    RAISE EXCEPTION 'INVITEE_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM team_memberships
    WHERE event_id = v_team.event_id
      AND participant_id = p_actor
      AND status = 'Confirmed'
  ) THEN
    RAISE EXCEPTION 'INVITEE_ALREADY_CONFIRMED'
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

  -- All writes below are in this RPC transaction. Any failure rolls back the
  -- availability, membership, vacancy, and invitation changes together.
  UPDATE event_availability
  SET is_looking = FALSE,
      updated_at = now()
  WHERE participant_id = p_actor
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
      p_actor,
      'Member',
      'Confirmed'
    )
    RETURNING * INTO v_membership;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'INVITEE_ALREADY_CONFIRMED'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object('eventId', v_team.event_id)::text;
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

  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    v_team.owner_participant_id,
    v_team.id,
    v_team.event_id,
    'team_invitation_accepted',
    LEFT(
      'An invited participant accepted the ' || v_vacancy.role
        || ' slot on "' || v_team.name || '".',
      500
    )
  );

  RETURN jsonb_build_object(
    'accepted', TRUE,
    'invitation', to_jsonb(v_req),
    'membership', to_jsonb(v_membership),
    'vacancy', to_jsonb(v_vacancy),
    'teamName', v_team.name,
    'vacancyRole', v_vacancy.role,
    'memberCount', v_member_count + 1,
    'maxTeamSize', v_max_team_size,
    'availabilityCleared', v_availability_count > 0,
    'notice', 'Invitation accepted. Team membership is confirmed and the vacancy is filled.'
  );
END;
$$;

REVOKE ALL ON FUNCTION accept_team_invitation(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_team_invitation(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION accept_team_invitation(UUID, UUID) IS
  'US-019 / #180: atomically revalidate invitation acceptance, confirm membership, fill the vacancy, and clear availability.';
