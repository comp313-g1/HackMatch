-- Migration: 0025_decline_team_invitation.sql
-- Description: US-019 / #179 / FR-058 — invitee decline of Pending invitations with
--              idempotent repeats and basic status alerts for both parties.
--              Availability and membership are unchanged.

CREATE OR REPLACE FUNCTION decline_team_invitation(
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

  IF v_req.participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_INVITEE' USING ERRCODE = 'P0001';
  END IF;

  -- FR-058: repeated decline is idempotent
  IF v_req.status = 'Declined' THEN
    RETURN jsonb_build_object(
      'invitation', to_jsonb(v_req),
      'changed', FALSE,
      'idempotent', TRUE,
      'teamName', v_team.name,
      'notice', 'Invitation was already declined.'
    );
  END IF;

  IF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'INVITATION_NOT_DECLINABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('status', v_req.status)::text;
  END IF;

  UPDATE team_requests
  SET status = 'Declined',
      cancel_reason = 'INVITEE_DECLINED',
      resolved_at = now(),
      updated_at = now()
  WHERE id = p_invitation
  RETURNING * INTO v_req;

  v_changed := TRUE;

  SELECT role INTO v_role
  FROM team_vacancies
  WHERE id = v_req.vacancy_id;

  v_invitee_msg := 'You declined the invitation to join "' || v_team.name || '"'
    || CASE WHEN v_role IS NOT NULL THEN ' for the ' || v_role || ' slot' ELSE '' END
    || '.';

  v_owner_msg := 'An invitee declined the pending invitation'
    || CASE WHEN v_role IS NOT NULL THEN ' for the ' || v_role || ' slot' ELSE '' END
    || ' on "' || v_team.name || '".';

  -- Basic status alerts (FR-058 / FR-064) — both parties, without US-021 centre
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
    'team_invitation_declined',
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
    'team_invitation_declined',
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
        'type', 'team_invitation_declined',
        'message', LEFT(v_invitee_msg, 500)
      ),
      jsonb_build_object(
        'audience', 'owner',
        'type', 'team_invitation_declined',
        'message', LEFT(v_owner_msg, 500)
      )
    ),
    'notice', 'Invitation declined. The team owner has been notified. Your availability is unchanged.'
  );
END;
$$;

REVOKE ALL ON FUNCTION decline_team_invitation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION decline_team_invitation(UUID, UUID) TO service_role;

COMMENT ON FUNCTION decline_team_invitation(UUID, UUID) IS
  'US-019 / #179 / FR-058: invitee declines a Pending invitation; alerts both parties; leaves availability unchanged.';
