-- Migration: 0026_cancel_competing_requests_on_placement.sql
-- Description: US-019 / #181 / FR-056 / FR-057 — shared helper that cancels competing
--              invitations, withdraws competing applications for the placed PART/event,
--              cancels remaining Pending requests for the filled slot, and when the team
--              is full cancels every remaining Pending request to that team.
--              Called from accept_team_invitation (#180 / 0027) and later US-020 approval.

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
