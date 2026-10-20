-- Migration: 0019_complete_team_invitation_model.sql
-- Description: Completes the US-017 / #161 PostgreSQL invitation model on team_requests:
--   Pending status, 48-hour expiry, status lifecycle, slot binding, indexes, and
--   transactional expiry helpers (FR-049, FR-050, FR-051).
-- Builds on 0011 (team_requests) and 0018 (expires_at + issuance RPC).
--
-- Invitation row contract (request_type = 'Invitation'):
--   Keys: id, team_id, event_id, vacancy_id, participant_id (invitee)
--   Status: Pending | Accepted | Declined | Withdrawn | Expired | Canceled
--   Expiry: expires_at NOT NULL; Pending TTL is 48 hours from issuance
--   Quotas: one Pending per (team, invitee) and one Pending per vacancy slot
--   Pending invites do NOT confirm membership or reserve capacity vs applications

-- 1. Pending invitations must target an open slot (slot-specific FR-049).
--    Non-pending rows may keep vacancy_id NULL after slot removal (ON DELETE SET NULL).
ALTER TABLE team_requests
  DROP CONSTRAINT IF EXISTS chk_team_requests_pending_invite_requires_vacancy,
  ADD CONSTRAINT chk_team_requests_pending_invite_requires_vacancy
    CHECK (
      NOT (
        request_type = 'Invitation'
        AND status = 'Pending'
        AND vacancy_id IS NULL
      )
    );

-- 2. Expiry lookup for Pending invitations (cleanup / acceptance revalidation)
CREATE INDEX IF NOT EXISTS idx_team_requests_pending_invite_expires
  ON team_requests(expires_at)
  WHERE request_type = 'Invitation'
    AND status = 'Pending';

-- Invitee inbox / status views
CREATE INDEX IF NOT EXISTS idx_team_requests_invitee_invitation_status
  ON team_requests(participant_id, status, created_at DESC)
  WHERE request_type = 'Invitation';

-- Owner outbound invitation lists
CREATE INDEX IF NOT EXISTS idx_team_requests_team_invitation_status
  ON team_requests(team_id, status, created_at DESC)
  WHERE request_type = 'Invitation';

-- 3. Clock-based validity: reject acceptance at/after expires_at even if cleanup lagged (FR-051)
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
BEGIN
  SELECT * INTO v_req
  FROM team_requests
  WHERE id = p_invitation
    AND request_type = 'Invitation';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Only Pending can be accepted; Expired/Canceled/etc. are terminal for acceptance
  IF v_req.status <> 'Pending' THEN
    RETURN FALSE;
  END IF;

  -- Expiry wins even when status cleanup has not run yet
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

  RETURN TRUE;
END;
$$;

-- 4. Mark a single invitation Expired when past TTL (idempotent; used at acceptance time)
CREATE OR REPLACE FUNCTION mark_team_invitation_expired_if_due(
  p_invitation UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req team_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req
  FROM team_requests
  WHERE id = p_invitation
    AND request_type = 'Invitation'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.status = 'Expired' THEN
    RETURN jsonb_build_object(
      'invitation', to_jsonb(v_req),
      'changed', FALSE
    );
  END IF;

  IF v_req.status <> 'Pending' THEN
    RETURN jsonb_build_object(
      'invitation', to_jsonb(v_req),
      'changed', FALSE,
      'reason', v_req.status
    );
  END IF;

  IF v_req.expires_at IS NULL OR v_req.expires_at > now() THEN
    RETURN jsonb_build_object(
      'invitation', to_jsonb(v_req),
      'changed', FALSE,
      'reason', 'NOT_DUE'
    );
  END IF;

  UPDATE team_requests
  SET status = 'Expired',
      resolved_at = now(),
      updated_at = now()
  WHERE id = p_invitation
  RETURNING * INTO v_req;

  INSERT INTO participant_notifications (
    participant_id,
    team_id,
    event_id,
    type,
    message
  )
  SELECT
    t.owner_participant_id,
    v_req.team_id,
    v_req.event_id,
    'team_invitation_expired',
    LEFT(
      'A pending invitation on "' || t.name || '" expired after 48 hours.',
      500
    )
  FROM teams t
  WHERE t.id = v_req.team_id;

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
    'team_invitation_expired',
    'Your team invitation expired after 48 hours and can no longer be accepted.'
  );

  RETURN jsonb_build_object(
    'invitation', to_jsonb(v_req),
    'changed', TRUE
  );
END;
$$;

-- 5. Batch cleanup of due Pending invitations (restores quota by leaving Pending) (FR-051)
CREATE OR REPLACE FUNCTION expire_due_team_invitations(
  p_limit INTEGER DEFAULT 100
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_id UUID;
  v_result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 100;
  END IF;

  FOR v_id IN
    SELECT id
    FROM team_requests
    WHERE request_type = 'Invitation'
      AND status = 'Pending'
      AND expires_at IS NOT NULL
      AND expires_at <= now()
    ORDER BY expires_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_result := mark_team_invitation_expired_if_due(v_id);
    IF COALESCE((v_result->>'changed')::boolean, FALSE) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('expiredCount', v_count);
END;
$$;

REVOKE ALL ON FUNCTION team_invitation_is_currently_valid(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION team_invitation_is_currently_valid(UUID) TO service_role;

REVOKE ALL ON FUNCTION mark_team_invitation_expired_if_due(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_team_invitation_expired_if_due(UUID) TO service_role;

REVOKE ALL ON FUNCTION expire_due_team_invitations(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_due_team_invitations(INTEGER) TO service_role;
