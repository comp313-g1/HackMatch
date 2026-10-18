-- Migration: 0014_create_team_cancellation_functions.sql
-- Description: Creates atomic PL/pgSQL functions for vacancy removal and team disbanding with request cancellation and notification cascades (US-012 / #123)

-- 1. Remove team vacancy
CREATE OR REPLACE FUNCTION remove_team_vacancy(
  p_actor UUID,
  p_team UUID,
  p_vacancy UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_vacancy team_vacancies%ROWTYPE;
  v_canceled_count INTEGER := 0;
BEGIN
  v_team := lock_team_for_owner_mutation(p_actor, p_team);

  SELECT *
  INTO v_vacancy
  FROM team_vacancies
  WHERE id = p_vacancy
    AND team_id = p_team;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_vacancy.status <> 'Open' THEN
    RAISE EXCEPTION 'VACANCY_NOT_OPEN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE team_vacancies
  SET status = 'Removed',
      removed_at = now(),
      updated_at = now()
  WHERE id = p_vacancy;

  WITH canceled AS (
    UPDATE team_requests
    SET status = 'Canceled',
        cancel_reason = 'SLOT_REMOVED',
        resolved_at = now(),
        updated_at = now()
    WHERE vacancy_id = p_vacancy
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
      'REQUEST_CANCELED_SLOT_REMOVED',
      'Your ' || CASE WHEN c.request_type = 'Invitation' THEN 'invitation' ELSE 'application' END || ' to "' || v_team.name || '" was canceled because the open slot was removed.'
    FROM canceled c
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO v_canceled_count FROM canceled;

  RETURN jsonb_build_object(
    'vacancyId', p_vacancy,
    'canceledRequests', v_canceled_count
  );
END;
$$;

-- 2. Disband team
CREATE OR REPLACE FUNCTION disband_team(
  p_actor UUID,
  p_team UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_released_count INTEGER := 0;
  v_canceled_count INTEGER := 0;
BEGIN
  v_team := lock_team_for_owner_mutation(p_actor, p_team);

  UPDATE teams
  SET recruitment_status = 'Disbanded',
      disbanded_at = now(),
      updated_at = now()
  WHERE id = p_team;

  UPDATE team_vacancies
  SET status = 'Removed',
      removed_at = now(),
      updated_at = now()
  WHERE team_id = p_team
    AND status = 'Open';

  WITH released AS (
    UPDATE team_memberships
    SET status = 'Released',
        ended_at = now(),
        updated_at = now()
    WHERE team_id = p_team
      AND status = 'Confirmed'
    RETURNING participant_id, role
  ),
  notified_members AS (
    INSERT INTO participant_notifications (
      participant_id,
      team_id,
      event_id,
      type,
      message
    )
    SELECT
      r.participant_id,
      p_team,
      v_team.event_id,
      'TEAM_DISBANDED',
      'Team "' || v_team.name || '" was disbanded by its owner.'
    FROM released r
    WHERE r.role <> 'Owner'
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO v_released_count FROM released;

  WITH canceled AS (
    UPDATE team_requests
    SET status = 'Canceled',
        cancel_reason = 'TEAM_DISBANDED',
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
      'REQUEST_CANCELED_TEAM_DISBANDED',
      'Your ' || CASE WHEN c.request_type = 'Invitation' THEN 'invitation' ELSE 'application' END || ' to "' || v_team.name || '" was canceled because the team was disbanded.'
    FROM canceled c
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO v_canceled_count FROM canceled;

  -- Restore availability for released members (only existing rows, event still recruiting, no other Confirmed membership)
  UPDATE event_availability ea
  SET is_looking = TRUE,
      updated_at = now()
  WHERE ea.event_id = v_team.event_id
    AND ea.is_looking = FALSE
    AND ea.participant_id IN (
      SELECT participant_id
      FROM team_memberships
      WHERE team_id = p_team
        AND status = 'Released'
    )
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = v_team.event_id
        AND e.status = 'Published'
        AND e.end_date >= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM team_memberships tm
      WHERE tm.participant_id = ea.participant_id
        AND tm.event_id = v_team.event_id
        AND tm.status = 'Confirmed'
    );

  RETURN jsonb_build_object(
    'releasedMembers', v_released_count,
    'canceledRequests', v_canceled_count
  );
END;
$$;

-- 3. Access permissions: restrict public/anon and grant only to service_role
REVOKE ALL ON FUNCTION remove_team_vacancy(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION remove_team_vacancy(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION disband_team(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION disband_team(UUID, UUID) TO service_role;
