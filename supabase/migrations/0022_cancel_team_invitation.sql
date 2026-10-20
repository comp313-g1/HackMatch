-- Migration: 0022_cancel_team_invitation.sql
-- Description: US-017 / #166 / FR-052 — owner cancel of Pending invitations with
--              idempotent repeats and basic status alerts for both parties.

CREATE OR REPLACE FUNCTION cancel_team_invitation(
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
  v_role TEXT;
  v_invitee_msg TEXT;
  v_owner_msg TEXT;
  v_changed BOOLEAN := FALSE;
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

  SELECT * INTO v_team
  FROM teams
  WHERE id = v_req.team_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.owner_participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_TEAM_OWNER' USING ERRCODE = 'P0001';
  END IF;

  -- FR-052: repeated cancellation is idempotent
  IF v_req.status = 'Canceled' THEN
    RETURN jsonb_build_object(
      'invitation', to_jsonb(v_req),
      'changed', FALSE,
      'idempotent', TRUE,
      'teamName', v_team.name,
      'notice', 'Invitation was already canceled.'
    );
  END IF;

  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'INVITATION_NOT_CANCELABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('status', v_req.status)::text;
  END IF;

  UPDATE team_requests
  SET status = 'Canceled',
      cancel_reason = 'OWNER_CANCELED',
      resolved_at = now(),
      updated_at = now()
  WHERE id = p_invitation
  RETURNING * INTO v_req;

  v_changed := TRUE;

  SELECT role INTO v_role
  FROM team_vacancies
  WHERE id = v_req.vacancy_id;

  v_invitee_msg := 'Your invitation to join "' || v_team.name || '"'
    || CASE WHEN v_role IS NOT NULL THEN ' for the ' || v_role || ' slot' ELSE '' END
    || ' was canceled by the team owner.';

  v_owner_msg := 'You canceled the pending invitation'
    || CASE WHEN v_role IS NOT NULL THEN ' for the ' || v_role || ' slot' ELSE '' END
    || ' on "' || v_team.name || '".';

  -- Basic status alerts (FR-052 / FR-064) — both parties, without US-021 centre
  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    v_req.participant_id,
    v_req.team_id,
    v_req.event_id,
    'team_invitation_canceled',
    LEFT(v_invitee_msg, 500)
  );

  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    v_team.owner_participant_id,
    v_req.team_id,
    v_req.event_id,
    'team_invitation_canceled',
    LEFT(v_owner_msg, 500)
  );

  RETURN jsonb_build_object(
    'invitation', to_jsonb(v_req),
    'changed', v_changed,
    'idempotent', FALSE,
    'teamName', v_team.name,
    'vacancyRole', v_role,
    'alerts', jsonb_build_array(
      jsonb_build_object(
        'audience', 'invitee',
        'type', 'team_invitation_canceled',
        'message', LEFT(v_invitee_msg, 500)
      ),
      jsonb_build_object(
        'audience', 'owner',
        'type', 'team_invitation_canceled',
        'message', LEFT(v_owner_msg, 500)
      )
    ),
    'notice', 'Pending invitation canceled. Quota for this slot and invitee is released.'
  );
END;
$$;

REVOKE ALL ON FUNCTION cancel_team_invitation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_team_invitation(UUID, UUID) TO service_role;
