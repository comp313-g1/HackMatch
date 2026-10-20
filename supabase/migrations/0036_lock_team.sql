-- Migration: 0036_lock_team.sql
-- Description: US-022 / #208 / FR-066 — atomic roster lock transaction.
--              Serializes with invitation accept / application approve via the shared
--              hackmatch:accept:team:{teamId} advisory lock, and with leave_team via
--              teams FOR UPDATE (leave also takes the same advisory below).
--              Sets recruitment_status = Locked + locked_at, cancels Pending requests,
--              and rejects under/over-filled rosters without partial writes.

-- ---------------------------------------------------------------------------
-- 1. leave_team: take shared team advisory before FOR UPDATE so lock/leave/join
--    cannot interleave membership changes with roster finalization (#208).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION leave_team(
  p_actor UUID,
  p_team UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_event RECORD;
  v_membership team_memberships%ROWTYPE;
  v_restored_count INTEGER := 0;
  v_availability_restored BOOLEAN := FALSE;
BEGIN
  IF p_actor IS NULL OR p_team IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  -- Shared with accept/approve/lock so leave waits behind (or holds ahead of) lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:accept:team:' || p_team::text, 0)
  );

  SELECT * INTO v_team
  FROM teams
  WHERE id = p_team
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.owner_participant_id = p_actor THEN
    RAISE EXCEPTION 'CANNOT_LEAVE_AS_OWNER' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', 'EventNotRecruiting')::text;
  END IF;

  SELECT *
  INTO v_membership
  FROM team_memberships
  WHERE team_id = p_team
    AND participant_id = p_actor
    AND status = 'Confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_membership.role = 'Owner' THEN
    RAISE EXCEPTION 'CANNOT_LEAVE_AS_OWNER' USING ERRCODE = 'P0001';
  END IF;

  UPDATE team_memberships
  SET status = 'Removed',
      removal_reason = 'MEMBER_LEFT',
      ended_at = now(),
      updated_at = now()
  WHERE id = v_membership.id;

  UPDATE event_availability ea
  SET is_looking = TRUE,
      updated_at = now()
  WHERE ea.participant_id = p_actor
    AND ea.event_id = v_team.event_id
    AND ea.is_looking = FALSE
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = v_team.event_id
        AND e.status = 'Published'
        AND e.end_date >= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM team_memberships tm
      WHERE tm.participant_id = p_actor
        AND tm.event_id = v_team.event_id
        AND tm.status = 'Confirmed'
    );

  GET DIAGNOSTICS v_restored_count = ROW_COUNT;
  v_availability_restored := (v_restored_count > 0);

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
    'MEMBER_LEFT',
    LEFT(
      'A confirmed member left "' || v_team.name || '" before roster lock. Capacity is available again.',
      500
    )
  );

  RETURN jsonb_build_object(
    'leftParticipantId', p_actor,
    'teamId', p_team,
    'availabilityRestored', v_availability_restored,
    'notice', CASE
      WHEN v_availability_restored THEN
        'You left the team. Your Looking-for-Team availability for this event was restored.'
      ELSE
        'You left the team. Capacity is available for the team again.'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION leave_team(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION leave_team(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. lock_team — owner-only atomic roster lock (US-022 / #208 / FR-066)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_team(
  p_actor UUID,
  p_team UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_event RECORD;
  v_member_count INTEGER := 0;
  v_min_required INTEGER;
  v_max_allowed INTEGER;
  v_locked_at TIMESTAMPTZ;
  v_canceled_count INTEGER := 0;
  v_elsewhere_count INTEGER := 0;
BEGIN
  IF p_actor IS NULL OR p_team IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize with accept / approve / leave (same team advisory key).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:accept:team:' || p_team::text, 0)
  );

  SELECT * INTO v_team
  FROM teams
  WHERE id = p_team
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.owner_participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_TEAM_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.recruitment_status = 'Locked' THEN
    RAISE EXCEPTION 'ALREADY_LOCKED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('lockedAt', v_team.locked_at)::text;
  END IF;

  IF v_team.recruitment_status <> 'Open' THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', v_team.recruitment_status)::text;
  END IF;

  SELECT id, status, end_date, min_team_size, max_team_size
  INTO v_event
  FROM events
  WHERE id = v_team.event_id
  FOR SHARE;

  IF NOT FOUND OR v_event.status <> 'Published' OR v_event.end_date < now() THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', 'EventNotRecruiting')::text;
  END IF;

  -- Official event bounds; platform floor for lock is 2 confirmed members (US-022).
  v_min_required := GREATEST(2, COALESCE(v_event.min_team_size, 2));
  v_max_allowed := COALESCE(v_event.max_team_size, 4);
  IF v_max_allowed < v_min_required THEN
    v_max_allowed := v_min_required;
  END IF;

  SELECT count(*)::INTEGER
  INTO v_member_count
  FROM team_memberships
  WHERE team_id = p_team
    AND status = 'Confirmed';

  IF v_member_count < v_min_required THEN
    RAISE EXCEPTION 'BELOW_MIN_MEMBERS'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'memberCount', v_member_count,
              'minRequired', v_min_required,
              'maxAllowed', v_max_allowed
            )::text;
  END IF;

  IF v_member_count > v_max_allowed THEN
    RAISE EXCEPTION 'ABOVE_MAX_MEMBERS'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'memberCount', v_member_count,
              'minRequired', v_min_required,
              'maxAllowed', v_max_allowed
            )::text;
  END IF;

  -- FR-083: every confirmed member on this team must not be confirmed elsewhere
  -- for the same event (unique index should already prevent this).
  SELECT count(*)::INTEGER
  INTO v_elsewhere_count
  FROM team_memberships tm
  WHERE tm.event_id = v_team.event_id
    AND tm.status = 'Confirmed'
    AND tm.team_id <> p_team
    AND tm.participant_id IN (
      SELECT participant_id
      FROM team_memberships
      WHERE team_id = p_team
        AND status = 'Confirmed'
    );

  IF v_elsewhere_count > 0 THEN
    RAISE EXCEPTION 'MEMBER_CONFIRMED_ELSEWHERE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('conflictCount', v_elsewhere_count)::text;
  END IF;

  v_locked_at := now();

  UPDATE teams
  SET recruitment_status = 'Locked',
      locked_at = v_locked_at,
      updated_at = now()
  WHERE id = p_team;

  -- Cancel remaining Pending invitations/applications atomically with the lock.
  WITH canceled AS (
    UPDATE team_requests
    SET status = 'Canceled',
        cancel_reason = 'TEAM_LOCKED',
        resolved_at = now(),
        updated_at = now()
    WHERE team_id = p_team
      AND status = 'Pending'
    RETURNING participant_id, request_type
  ),
  inserted_notifications AS (
    INSERT INTO participant_notifications (
      participant_id,
      team_id,
      event_id,
      type,
      message
    )
    SELECT
      c.participant_id,
      p_team,
      v_team.event_id,
      'REQUEST_CANCELED_TEAM_LOCKED',
      'Your ' || CASE WHEN c.request_type = 'Invitation' THEN 'invitation' ELSE 'application' END
        || ' to "' || v_team.name || '" was canceled because the roster was locked.'
    FROM canceled c
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO v_canceled_count FROM canceled;

  -- Basic member alert that the roster is locked (FR-064).
  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  )
  SELECT
    tm.participant_id,
    p_team,
    v_team.event_id,
    'TEAM_ROSTER_LOCKED',
    'Team "' || v_team.name || '" roster was locked by the owner.'
  FROM team_memberships tm
  WHERE tm.team_id = p_team
    AND tm.status = 'Confirmed';

  RETURN jsonb_build_object(
    'teamId', p_team,
    'lockedAt', v_locked_at,
    'memberCount', v_member_count,
    'minRequired', v_min_required,
    'maxAllowed', v_max_allowed,
    'canceledRequests', v_canceled_count
  );
END;
$$;

REVOKE ALL ON FUNCTION lock_team(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lock_team(UUID, UUID) TO service_role;
