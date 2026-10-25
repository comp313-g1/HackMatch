-- Migration: 0032_cancel_competing_requests_after_approval.sql
-- Description: US-020 / #191 / FR-061 — extend atomic application approval
-- with the shared placement cascade from #181. Approval and every competing
-- request transition either commit together or roll back together.

ALTER FUNCTION approve_team_application(UUID, UUID)
  RENAME TO approve_team_application_without_cascade;

-- The implementation is callable only by the secured public wrapper below.
REVOKE ALL ON FUNCTION approve_team_application_without_cascade(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION approve_team_application(
  p_actor UUID,
  p_application UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_cascade JSONB;
  v_team_now_full BOOLEAN;
BEGIN
  -- #190 remains the authoritative validation, authorization, locking, and
  -- membership transaction. A failure below rolls all of those writes back.
  v_result := approve_team_application_without_cascade(p_actor, p_application);

  v_team_now_full :=
    (v_result ->> 'memberCount')::INTEGER >=
    (v_result ->> 'maxTeamSize')::INTEGER;

  v_cascade := cancel_competing_requests_on_placement(
    p_application,
    (v_result #>> '{application,participant_id}')::UUID,
    (v_result #>> '{application,event_id}')::UUID,
    (v_result #>> '{application,team_id}')::UUID,
    NULLIF(v_result #>> '{application,vacancy_id}', '')::UUID,
    v_team_now_full
  );

  RETURN v_result || jsonb_build_object(
    'cascade', v_cascade,
    'notice',
      'Application approved. Membership is confirmed, the vacancy is filled, and competing pending requests were cleared.'
  );
END;
$$;

REVOKE ALL ON FUNCTION approve_team_application(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_team_application(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION approve_team_application(UUID, UUID) IS
  'US-020 / #190 / #191: atomically approve an application, confirm membership, fill the vacancy, and clear competing pending requests.';

COMMENT ON FUNCTION approve_team_application_without_cascade(UUID, UUID) IS
  'Internal #190 approval implementation. Invoke only through the #191 approve_team_application wrapper.';

-- Ensure the shared placement cascade helper (#181 / 0026) exists even if 0032
-- is applied to an environment where 0026 was skipped.
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
