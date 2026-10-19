-- Migration: 0021_invitation_acceptance_revalidation.sql
-- Description: US-017 / #165 / FR-051 — strengthen clock + slot/event validity and
--              expose revalidate_team_invitation_for_acceptance for acceptance-time checks.
--              Delayed cleanup must not extend validity past expires_at.

-- 1. Validity includes event still recruiting (Published + end_date in the future)
CREATE OR REPLACE FUNCTION team_invitation_is_currently_valid(
  p_invitation UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req team_requests%ROWTYPE;
  v_vacancy_status VARCHAR(20);
  v_team_status VARCHAR(20);
  v_event_status VARCHAR(20);
  v_event_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_req
  FROM team_requests
  WHERE id = p_invitation
    AND request_type = 'Invitation';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_req.status <> 'Pending' THEN
    RETURN FALSE;
  END IF;

  -- Expiry wins even when status cleanup has not run yet (FR-051)
  IF v_req.expires_at IS NULL OR v_req.expires_at <= now() THEN
    RETURN FALSE;
  END IF;

  IF v_req.vacancy_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT status INTO v_vacancy_status
  FROM team_vacancies
  WHERE id = v_req.vacancy_id;

  IF NOT FOUND OR v_vacancy_status <> 'Open' THEN
    RETURN FALSE;
  END IF;

  SELECT recruitment_status INTO v_team_status
  FROM teams
  WHERE id = v_req.team_id;

  IF NOT FOUND OR v_team_status <> 'Open' THEN
    RETURN FALSE;
  END IF;

  SELECT status, end_date INTO v_event_status, v_event_end
  FROM events
  WHERE id = v_req.event_id;

  IF NOT FOUND
     OR v_event_status <> 'Published'
     OR v_event_end IS NULL
     OR v_event_end < now() THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

-- 2. Acceptance-time revalidation: mark Expired if due, then return ok or domain error
CREATE OR REPLACE FUNCTION revalidate_team_invitation_for_acceptance(
  p_actor UUID,
  p_invitation UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req team_requests%ROWTYPE;
  v_mark JSONB;
  v_team teams%ROWTYPE;
  v_vacancy team_vacancies%ROWTYPE;
  v_event_status VARCHAR(20);
  v_event_end TIMESTAMPTZ;
  v_invitee participants%ROWTYPE;
BEGIN
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

  -- Persist Expired when past 48h TTL so quotas restore (FR-051)
  IF v_req.status = 'Pending'
     AND (v_req.expires_at IS NULL OR v_req.expires_at <= now()) THEN
    v_mark := mark_team_invitation_expired_if_due(p_invitation);
    v_req := jsonb_populate_record(NULL::team_requests, v_mark->'invitation');
  END IF;

  IF v_req.status = 'Expired'
     OR (v_req.expires_at IS NOT NULL AND v_req.expires_at <= now()) THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'INVITATION_NOT_ACCEPTABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_team FROM teams WHERE id = v_req.team_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.recruitment_status <> 'Open' THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT status, end_date INTO v_event_status, v_event_end
  FROM events
  WHERE id = v_req.event_id;

  IF NOT FOUND
     OR v_event_status <> 'Published'
     OR v_event_end IS NULL
     OR v_event_end < now() THEN
    RAISE EXCEPTION 'EVENT_NOT_RECRUITING' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.vacancy_id IS NULL THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vacancy
  FROM team_vacancies
  WHERE id = v_req.vacancy_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_vacancy.status <> 'Open' THEN
    RAISE EXCEPTION 'VACANCY_NOT_OPEN'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('vacancyStatus', v_vacancy.status)::text;
  END IF;

  SELECT * INTO v_invitee FROM participants WHERE id = p_actor FOR SHARE;
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

  RETURN jsonb_build_object(
    'eligible', TRUE,
    'invitation', to_jsonb(v_req),
    'expiresAt', v_req.expires_at,
    'vacancyRole', v_vacancy.role,
    'teamName', v_team.name,
    'notice',
      'Invitation is still valid within its 48-hour window. Slot, team, and event checks passed at acceptance time.'
  );
END;
$$;

REVOKE ALL ON FUNCTION team_invitation_is_currently_valid(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION team_invitation_is_currently_valid(UUID) TO service_role;

REVOKE ALL ON FUNCTION revalidate_team_invitation_for_acceptance(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION revalidate_team_invitation_for_acceptance(UUID, UUID) TO service_role;
