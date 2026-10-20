-- Migration: 0028_leave_team.sql
-- Description: US-019 / #183 / FR-059 — pre-lock voluntary leave for confirmed
--              non-owner members. Releases membership, restores event availability
--              when recruitment remains open, alerts the owner, and does not revive
--              canceled requests. Owners must disband; locked/non-mutable teams reject.

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

  -- 1. Lock team row
  SELECT * INTO v_team
  FROM teams
  WHERE id = p_team
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Owner cannot leave — must disband (US-019-T6 / FR-059)
  IF v_team.owner_participant_id = p_actor THEN
    RAISE EXCEPTION 'CANNOT_LEAVE_AS_OWNER' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Pre-lock only: recruitment must be Open
  IF v_team.recruitment_status <> 'Open' THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', v_team.recruitment_status)::text;
  END IF;

  -- 4. Event must still be recruiting
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

  -- 5. Actor must be a confirmed non-owner member on this team
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

  -- 6. Release membership (capacity reopens via confirmed-member count)
  UPDATE team_memberships
  SET status = 'Removed',
      removal_reason = 'MEMBER_LEFT',
      ended_at = now(),
      updated_at = now()
  WHERE id = v_membership.id;

  -- 7. Restore Looking-for-Team when an availability row exists, event is recruiting,
  --    and the participant has no other confirmed membership for this event.
  --    Do not INSERT new availability rows. Do not touch team_requests.
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

  -- 8. Basic owner alert (FR-059 / FR-064) — no US-021 centre
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
    'notice',
      CASE
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

COMMENT ON FUNCTION leave_team(UUID, UUID) IS
  'US-019 / #183 / FR-059: confirmed non-owner leaves unlocked team; restores availability; alerts owner; does not revive canceled requests.';
