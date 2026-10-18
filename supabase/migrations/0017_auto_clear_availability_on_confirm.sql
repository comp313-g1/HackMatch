-- Migration: 0017_auto_clear_availability_on_confirm.sql
-- Description: Automatically clears Looking-for-Team status upon confirmed team membership or team creation (US-011 AC 4)

-- 1. Trigger function to deactivate Looking-for-Team status on any confirmed membership
CREATE OR REPLACE FUNCTION clear_participant_availability_on_confirmed_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Confirmed' THEN
    UPDATE event_availability
    SET is_looking = FALSE,
        updated_at = NOW()
    WHERE participant_id = NEW.participant_id
      AND is_looking = TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_availability_on_confirmed_membership ON team_memberships;

CREATE TRIGGER trg_clear_availability_on_confirmed_membership
AFTER INSERT OR UPDATE OF status ON team_memberships
FOR EACH ROW
WHEN (NEW.status = 'Confirmed')
EXECUTE FUNCTION clear_participant_availability_on_confirmed_membership();

-- 2. Update create_team_with_owner function to clear availability across all pools/events
CREATE OR REPLACE FUNCTION create_team_with_owner(
  p_owner_id UUID,
  p_event_id UUID,
  p_name VARCHAR,
  p_pitch VARCHAR,
  p_goal VARCHAR,
  p_commitment_hours NUMERIC,
  p_communication_link VARCHAR DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant RECORD;
  v_event RECORD;
  v_existing_membership_id UUID;
  v_team teams%ROWTYPE;
  v_membership team_memberships%ROWTYPE;
BEGIN
  -- 1. Lock participant FOR UPDATE
  SELECT id, role, is_verified, is_suspended
  INTO v_participant
  FROM participants
  WHERE id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND OR v_participant.role <> 'PART' OR NOT v_participant.is_verified OR v_participant.is_suspended THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock event FOR SHARE
  SELECT id, status, end_date, max_team_size
  INTO v_event
  FROM events
  WHERE id = p_event_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_event.status <> 'Published' OR v_event.end_date < now() THEN
    RAISE EXCEPTION 'EVENT_NOT_RECRUITING' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Existing Confirmed membership check
  SELECT id INTO v_existing_membership_id
  FROM team_memberships
  WHERE event_id = p_event_id
    AND participant_id = p_owner_id
    AND status = 'Confirmed'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'ALREADY_CONFIRMED_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  -- 4. INSERT teams & INSERT team_memberships
  INSERT INTO teams (
    event_id,
    owner_participant_id,
    name,
    pitch,
    goal,
    commitment_hours,
    communication_link,
    recruitment_status
  ) VALUES (
    p_event_id,
    p_owner_id,
    p_name,
    p_pitch,
    p_goal,
    p_commitment_hours,
    p_communication_link,
    'Open'
  ) RETURNING * INTO v_team;

  INSERT INTO team_memberships (
    team_id,
    event_id,
    participant_id,
    role,
    status
  ) VALUES (
    v_team.id,
    p_event_id,
    p_owner_id,
    'Owner',
    'Confirmed'
  ) RETURNING * INTO v_membership;

  -- 5. UPDATE event_availability SET is_looking = FALSE across all pools/events for the owner
  UPDATE event_availability
  SET is_looking = FALSE, updated_at = now()
  WHERE participant_id = p_owner_id
    AND is_looking = TRUE;

  -- 6. Cancel pending incoming invitations/applications for the owner in this event
  UPDATE team_requests
  SET status = 'Canceled',
      cancel_reason = 'OWNER_CREATED_TEAM',
      resolved_at = now(),
      updated_at = now()
  WHERE participant_id = p_owner_id
    AND event_id = p_event_id
    AND status = 'Pending';

  -- 7. Return jsonb
  RETURN jsonb_build_object(
    'team', to_jsonb(v_team),
    'membership', to_jsonb(v_membership)
  );
END;
$$;

REVOKE ALL ON FUNCTION create_team_with_owner(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, NUMERIC, VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_team_with_owner(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, NUMERIC, VARCHAR) TO service_role;
