-- Migration: 0015_create_team_member_removal_function.sql
-- Description: Creates atomic PL/pgSQL function for team member removal, availability restore, and notification (US-012 / #124)

CREATE OR REPLACE FUNCTION remove_team_member(
  p_actor UUID,
  p_team UUID,
  p_member UUID,
  p_reason VARCHAR
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_membership team_memberships%ROWTYPE;
  v_restored_count INTEGER := 0;
  v_availability_restored BOOLEAN := FALSE;
BEGIN
  -- 1. Guard check via shared lock
  v_team := lock_team_for_owner_mutation(p_actor, p_team);

  -- 2. Owner self-removal forbidden (owner must disband team instead; AC6)
  IF p_member = v_team.owner_participant_id THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_OWNER' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Locate confirmed membership for target participant
  SELECT *
  INTO v_membership
  FROM team_memberships
  WHERE team_id = p_team
    AND participant_id = p_member
    AND status = 'Confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Mark membership Removed with provided reason
  UPDATE team_memberships
  SET status = 'Removed',
      removal_reason = p_reason,
      ended_at = now(),
      updated_at = now()
  WHERE id = v_membership.id;

  -- 5. Restore looking-for-team availability (only if row exists, event is active/recruiting, no other confirmed membership)
  UPDATE event_availability ea
  SET is_looking = TRUE,
      updated_at = now()
  WHERE ea.participant_id = p_member
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
      WHERE tm.participant_id = p_member
        AND tm.event_id = v_team.event_id
        AND tm.status = 'Confirmed'
    );

  GET DIAGNOSTICS v_restored_count = ROW_COUNT;
  v_availability_restored := (v_restored_count > 0);

  -- 6. Insert notification for removed member
  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    p_member,
    p_team,
    v_team.event_id,
    'MEMBER_REMOVED',
    'You were removed from "' || v_team.name || '". Reason: ' || p_reason
  );

  RETURN jsonb_build_object(
    'removedParticipantId', p_member,
    'availabilityRestored', v_availability_restored
  );
END;
$$;

-- 7. Access permissions: restrict public/anon and grant only to service_role
REVOKE ALL ON FUNCTION remove_team_member(UUID, UUID, UUID, VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION remove_team_member(UUID, UUID, UUID, VARCHAR) TO service_role;
