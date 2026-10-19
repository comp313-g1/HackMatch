-- Migration: 0018_create_team_invitation_issuance.sql
-- Description: Adds invitation expiry, one-pending-per-slot index, and atomic issue_team_invitation
--              for US-017 / FR-049 issuance used by US-015 FR-048 recommendation wiring.

-- 1. Persist 48-hour expiry on invitations (applications may leave expires_at NULL)
ALTER TABLE team_requests
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

ALTER TABLE team_requests
  DROP CONSTRAINT IF EXISTS chk_team_requests_invitation_expiry,
  ADD CONSTRAINT chk_team_requests_invitation_expiry
    CHECK (
      request_type <> 'Invitation'
      OR expires_at IS NOT NULL
    );

-- 2. At most one Pending invitation per open vacancy slot (US-017 AC 3 / FR-049)
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_requests_pending_invite_per_slot
  ON team_requests(vacancy_id)
  WHERE request_type = 'Invitation'
    AND status = 'Pending'
    AND vacancy_id IS NOT NULL;

-- 3. Atomic owner-only invitation issuance with eligibility + quota checks
CREATE OR REPLACE FUNCTION issue_team_invitation(
  p_actor UUID,
  p_team UUID,
  p_vacancy UUID,
  p_invitee UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_vacancy team_vacancies%ROWTYPE;
  v_invitee participants%ROWTYPE;
  v_availability event_availability%ROWTYPE;
  v_request team_requests%ROWTYPE;
  v_expires_at TIMESTAMPTZ;
  v_platform_event UUID := '00000000-0000-4000-8000-000000000001'::uuid;
  v_message TEXT;
BEGIN
  IF p_invitee IS NULL OR p_vacancy IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('field', 'inviteeParticipantId')::text;
  END IF;

  IF p_actor = p_invitee THEN
    RAISE EXCEPTION 'CANNOT_INVITE_SELF' USING ERRCODE = 'P0001';
  END IF;

  -- Owner + mutable team + recruiting event (shared lock)
  v_team := lock_team_for_owner_mutation(p_actor, p_team);

  SELECT * INTO v_vacancy
  FROM team_vacancies
  WHERE id = p_vacancy
    AND team_id = p_team
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VACANCY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_vacancy.status <> 'Open' THEN
    RAISE EXCEPTION 'VACANCY_NOT_OPEN'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('vacancyStatus', v_vacancy.status)::text;
  END IF;

  SELECT * INTO v_invitee
  FROM participants
  WHERE id = p_invitee
  FOR UPDATE;

  IF NOT FOUND
     OR v_invitee.role <> 'PART'
     OR v_invitee.is_verified IS NOT TRUE
     OR v_invitee.is_suspended IS TRUE THEN
    RAISE EXCEPTION 'INVITEE_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  -- Looking-for-Team on the platform availability pool (US-011 / US-017)
  SELECT * INTO v_availability
  FROM event_availability
  WHERE participant_id = p_invitee
    AND event_id = v_platform_event
  FOR SHARE;

  IF NOT FOUND OR v_availability.is_looking IS NOT TRUE THEN
    RAISE EXCEPTION 'INVITEE_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- One confirmed team per participant per hackathon
  IF EXISTS (
    SELECT 1
    FROM team_memberships
    WHERE event_id = v_team.event_id
      AND participant_id = p_invitee
      AND status = 'Confirmed'
  ) THEN
    RAISE EXCEPTION 'INVITEE_ALREADY_CONFIRMED' USING ERRCODE = 'P0001';
  END IF;

  v_expires_at := now() + INTERVAL '48 hours';

  BEGIN
    INSERT INTO team_requests (
      team_id,
      event_id,
      vacancy_id,
      participant_id,
      request_type,
      status,
      expires_at
    ) VALUES (
      p_team,
      v_team.event_id,
      p_vacancy,
      p_invitee,
      'Invitation',
      'Pending',
      v_expires_at
    )
    RETURNING * INTO v_request;
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM ILIKE '%uq_team_requests_pending_invite_per_slot%' THEN
        RAISE EXCEPTION 'SLOT_PENDING_INVITATION_EXISTS' USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION 'DUPLICATE_PENDING_INVITATION' USING ERRCODE = 'P0001';
  END;

  v_message := 'You received an invitation to join "' || v_team.name || '" for an open '
    || v_vacancy.role || ' slot. Respond within 48 hours.';

  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  ) VALUES (
    p_invitee,
    p_team,
    v_team.event_id,
    'team_invitation',
    LEFT(v_message, 500)
  );

  RETURN jsonb_build_object(
    'invitation', to_jsonb(v_request),
    'expiresAt', v_expires_at,
    'vacancyRole', v_vacancy.role,
    'teamName', v_team.name
  );
END;
$$;

REVOKE ALL ON FUNCTION issue_team_invitation(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION issue_team_invitation(UUID, UUID, UUID, UUID) TO service_role;
