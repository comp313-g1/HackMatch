-- Migration: 0026_cancel_competing_requests_on_placement.sql
-- Description: US-019 / #181 / FR-056 / FR-057 — cancel competing invitations,
--              withdraw competing applications for the placed PART/event, cancel
--              remaining Pending requests for the filled slot, and when the team
--              is full cancel every remaining Pending request to that team.
--              Shared by invitation acceptance (and later application approval).

-- 1. Shared placement cascade (FR-056 + FR-057)
CREATE OR REPLACE FUNCTION cancel_competing_requests_on_placement(
  p_winning_request_id UUID,
  p_participant_id UUID,
  p_event_id UUID,
  p_team_id UUID,
  p_vacancy_id UUID,
  p_team_now_full BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_name TEXT;
  v_event_invites_canceled INTEGER := 0;
  v_event_apps_withdrawn INTEGER := 0;
  v_slot_canceled INTEGER := 0;
  v_team_canceled INTEGER := 0;
BEGIN
  IF p_winning_request_id IS NULL
     OR p_participant_id IS NULL
     OR p_event_id IS NULL
     OR p_team_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_team_name FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- FR-056: other incoming invitations for this PART / event (not the winner)
  WITH canceled AS (
    UPDATE team_requests
    SET status = 'Canceled',
        cancel_reason = 'EVENT_MEMBERSHIP_CONFIRMED',
        resolved_at = now(),
        updated_at = now()
    WHERE participant_id = p_participant_id
      AND event_id = p_event_id
      AND request_type = 'Invitation'
      AND status = 'Pending'
      AND id <> p_winning_request_id
    RETURNING id, participant_id, team_id, event_id, request_type
  ),
  notified AS (
    INSERT INTO participant_notifications (
      participant_id, team_id, event_id, type, message
    )
    SELECT
      c.participant_id,
      c.team_id,
      c.event_id,
      'team_request_canceled_membership',
      LEFT(
        'Your pending invitation was canceled because you confirmed membership on another team for this event.',
        500
      )
    FROM canceled c
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO v_event_invites_canceled FROM canceled;

  -- FR-056: other applications for this PART / event → Withdrawn
  WITH withdrawn AS (
    UPDATE team_requests
    SET status = 'Withdrawn',
        cancel_reason = 'EVENT_MEMBERSHIP_CONFIRMED',
        resolved_at = now(),
        updated_at = now()
    WHERE participant_id = p_participant_id
      AND event_id = p_event_id
      AND request_type = 'Application'
      AND status = 'Pending'
      AND id <> p_winning_request_id
    RETURNING id, participant_id, team_id, event_id
  ),
  notified AS (
    INSERT INTO participant_notifications (
      participant_id, team_id, event_id, type, message
    )
    SELECT
      w.participant_id,
      w.team_id,
      w.event_id,
      'team_application_withdrawn_membership',
      LEFT(
        'Your Pending Review application was withdrawn because you confirmed membership on a team for this event.',
        500
      )
    FROM withdrawn w
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO v_event_apps_withdrawn FROM withdrawn;

  -- FR-057: remaining Pending requests for the filled slot (other people)
  IF p_vacancy_id IS NOT NULL THEN
    WITH canceled AS (
      UPDATE team_requests
      SET status = 'Canceled',
          cancel_reason = 'SLOT_FILLED',
          resolved_at = now(),
          updated_at = now()
      WHERE vacancy_id = p_vacancy_id
        AND status = 'Pending'
        AND id <> p_winning_request_id
      RETURNING id, participant_id, team_id, event_id, request_type
    ),
    notified AS (
      INSERT INTO participant_notifications (
        participant_id, team_id, event_id, type, message
      )
      SELECT
        c.participant_id,
        c.team_id,
        c.event_id,
        'REQUEST_CANCELED_SLOT_FILLED',
        LEFT(
          'Your '
            || CASE WHEN c.request_type = 'Invitation' THEN 'invitation' ELSE 'application' END
            || ' for a slot on "' || v_team_name
            || '" was canceled because the slot was filled.',
          500
        )
      FROM canceled c
      RETURNING id
    )
    SELECT count(*)::INTEGER INTO v_slot_canceled FROM canceled;
  END IF;

  -- FR-057: when roster is full, cancel every remaining Pending request to the team
  IF p_team_now_full THEN
    WITH canceled AS (
      UPDATE team_requests
      SET status = 'Canceled',
          cancel_reason = 'TEAM_FULL',
          resolved_at = now(),
          updated_at = now()
      WHERE team_id = p_team_id
        AND status = 'Pending'
        AND id <> p_winning_request_id
      RETURNING id, participant_id, team_id, event_id, request_type
    ),
    notified AS (
      INSERT INTO participant_notifications (
        participant_id, team_id, event_id, type, message
      )
      SELECT
        c.participant_id,
        c.team_id,
        c.event_id,
        'REQUEST_CANCELED_TEAM_FULL',
        LEFT(
          'Your '
            || CASE WHEN c.request_type = 'Invitation' THEN 'invitation' ELSE 'application' END
            || ' to "' || v_team_name
            || '" was canceled because the team roster is full.',
          500
        )
      FROM canceled c
      RETURNING id
    )
    SELECT count(*)::INTEGER INTO v_team_canceled FROM canceled;
  END IF;

  RETURN jsonb_build_object(
    'winningRequestId', p_winning_request_id,
    'eventInvitationsCanceled', v_event_invites_canceled,
    'eventApplicationsWithdrawn', v_event_apps_withdrawn,
    'slotRequestsCanceled', v_slot_canceled,
    'teamRequestsCanceled', v_team_canceled,
    'teamNowFull', COALESCE(p_team_now_full, FALSE)
  );
END;
$$;

REVOKE ALL ON FUNCTION cancel_competing_requests_on_placement(UUID, UUID, UUID, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_competing_requests_on_placement(UUID, UUID, UUID, UUID, UUID, BOOLEAN)
  TO service_role;

COMMENT ON FUNCTION cancel_competing_requests_on_placement(UUID, UUID, UUID, UUID, UUID, BOOLEAN) IS
  'US-019 / #181 / FR-056 / FR-057: after placement, cancel/withdraw competing Pending requests for the PART/event, filled slot, and full team.';

-- 2. Accept invitation with membership commit + cascade (FR-056 / FR-051 / FR-057)
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
  v_event RECORD;
  v_invitee participants%ROWTYPE;
  v_membership team_memberships%ROWTYPE;
  v_confirmed_count INTEGER;
  v_max_size INTEGER;
  v_team_now_full BOOLEAN := FALSE;
  v_cascade JSONB;
  v_invitee_msg TEXT;
  v_owner_msg TEXT;
BEGIN
  IF p_invitation IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

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

  -- Idempotent: already accepted by this invitee
  IF v_req.status = 'Accepted' THEN
    SELECT * INTO v_team FROM teams WHERE id = v_req.team_id;
    RETURN jsonb_build_object(
      'invitation', to_jsonb(v_req),
      'changed', FALSE,
      'idempotent', TRUE,
      'membershipCommitted', TRUE,
      'teamName', v_team.name,
      'cascade', jsonb_build_object(
        'eventInvitationsCanceled', 0,
        'eventApplicationsWithdrawn', 0,
        'slotRequestsCanceled', 0,
        'teamRequestsCanceled', 0,
        'teamNowFull', FALSE
      ),
      'alerts', '[]'::jsonb,
      'notice', 'Invitation was already accepted. Membership is unchanged.'
    );
  END IF;

  -- FR-051 expiry / Pending gate (same outcomes as revalidate)
  IF v_req.status = 'Pending'
     AND (v_req.expires_at IS NULL OR v_req.expires_at <= now()) THEN
    PERFORM mark_team_invitation_expired_if_due(p_invitation);
    RAISE EXCEPTION 'INVITATION_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'INVITATION_NOT_ACCEPTABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_team FROM teams WHERE id = v_req.team_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.recruitment_status <> 'Open' THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, status, end_date, COALESCE(max_team_size, 4) AS max_team_size
  INTO v_event
  FROM events
  WHERE id = v_req.event_id;

  IF NOT FOUND
     OR v_event.status <> 'Published'
     OR v_event.end_date IS NULL
     OR v_event.end_date < now() THEN
    RAISE EXCEPTION 'EVENT_NOT_RECRUITING' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.vacancy_id IS NULL THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vacancy
  FROM team_vacancies
  WHERE id = v_req.vacancy_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_vacancy.status <> 'Open' THEN
    RAISE EXCEPTION 'VACANCY_NOT_OPEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_invitee FROM participants WHERE id = p_actor FOR UPDATE;
  IF NOT FOUND
     OR v_invitee.role <> 'PART'
     OR v_invitee.is_verified IS NOT TRUE
     OR v_invitee.is_suspended IS TRUE THEN
    RAISE EXCEPTION 'INVITEE_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM team_memberships
    WHERE event_id = v_req.event_id
      AND participant_id = p_actor
      AND status = 'Confirmed'
  ) THEN
    RAISE EXCEPTION 'INVITEE_ALREADY_CONFIRMED' USING ERRCODE = 'P0001';
  END IF;

  -- Capacity: confirmed members + this placement must not exceed max
  SELECT count(*)::INTEGER INTO v_confirmed_count
  FROM team_memberships
  WHERE team_id = v_req.team_id
    AND status = 'Confirmed';

  v_max_size := v_event.max_team_size;
  IF v_confirmed_count >= v_max_size THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE team_requests
  SET status = 'Accepted',
      resolved_at = now(),
      updated_at = now()
  WHERE id = p_invitation
  RETURNING * INTO v_req;

  UPDATE team_vacancies
  SET status = 'Filled',
      updated_at = now()
  WHERE id = v_vacancy.id;

  INSERT INTO team_memberships (
    team_id,
    event_id,
    participant_id,
    role,
    status
  ) VALUES (
    v_req.team_id,
    v_req.event_id,
    p_actor,
    'Member',
    'Confirmed'
  ) RETURNING * INTO v_membership;

  UPDATE event_availability
  SET is_looking = FALSE,
      updated_at = now()
  WHERE participant_id = p_actor
    AND event_id = v_req.event_id
    AND is_looking = TRUE;

  SELECT count(*)::INTEGER INTO v_confirmed_count
  FROM team_memberships
  WHERE team_id = v_req.team_id
    AND status = 'Confirmed';

  v_team_now_full := v_confirmed_count >= v_max_size;

  v_cascade := cancel_competing_requests_on_placement(
    v_req.id,
    p_actor,
    v_req.event_id,
    v_req.team_id,
    v_req.vacancy_id,
    v_team_now_full
  );

  v_invitee_msg := 'You accepted the invitation to join "' || v_team.name
    || '" for the ' || v_vacancy.role || ' slot. Membership is confirmed.';
  v_owner_msg := 'An invitee accepted the invitation for the ' || v_vacancy.role
    || ' slot on "' || v_team.name || '".';

  INSERT INTO participant_notifications (
    participant_id, team_id, event_id, type, message
  ) VALUES (
    p_actor,
    v_req.team_id,
    v_req.event_id,
    'team_invitation_accepted',
    LEFT(v_invitee_msg, 500)
  );

  INSERT INTO participant_notifications (
    participant_id, team_id, event_id, type, message
  ) VALUES (
    v_team.owner_participant_id,
    v_req.team_id,
    v_req.event_id,
    'team_invitation_accepted',
    LEFT(v_owner_msg, 500)
  );

  RETURN jsonb_build_object(
    'invitation', to_jsonb(v_req),
    'membership', to_jsonb(v_membership),
    'changed', TRUE,
    'idempotent', FALSE,
    'membershipCommitted', TRUE,
    'teamName', v_team.name,
    'vacancyRole', v_vacancy.role,
    'cascade', v_cascade,
    'alerts', jsonb_build_array(
      jsonb_build_object(
        'audience', 'invitee',
        'type', 'team_invitation_accepted',
        'message', LEFT(v_invitee_msg, 500)
      ),
      jsonb_build_object(
        'audience', 'owner',
        'type', 'team_invitation_accepted',
        'message', LEFT(v_owner_msg, 500)
      )
    ),
    'notice',
      'Invitation accepted. Membership confirmed, the slot is filled, and competing pending requests for this event were cleared.'
  );
END;
$$;

REVOKE ALL ON FUNCTION accept_team_invitation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_team_invitation(UUID, UUID) TO service_role;

COMMENT ON FUNCTION accept_team_invitation(UUID, UUID) IS
  'US-019 / #181 / FR-056: accept invitation, confirm membership, clear availability, run competing-request cascade.';
