-- Migration: 0064_restart_pending_authenticator_enrollment.sql
-- Description: US-029 / #268 — atomically replace an owner-scoped pending
-- TOTP enrollment when ephemeral setup material was lost after refresh/navigation.

CREATE OR REPLACE FUNCTION restart_authenticator_enrollment(
  p_participant UUID,
  p_enrollment UUID,
  p_secret_ciphertext TEXT,
  p_secret_iv TEXT,
  p_secret_auth_tag TEXT,
  p_key_version TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS TABLE (
  enrollment_id UUID,
  enrollment_status VARCHAR(16),
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant participants%ROWTYPE;
BEGIN
  IF p_participant IS NULL
     OR p_enrollment IS NULL
     OR NULLIF(p_secret_ciphertext, '') IS NULL
     OR NULLIF(p_secret_iv, '') IS NULL
     OR NULLIF(p_secret_auth_tag, '') IS NULL
     OR p_key_version !~ '^[A-Za-z0-9._-]{1,32}$'
     OR p_expires_at IS NULL
     OR p_expires_at <= NOW() THEN
    RAISE EXCEPTION 'TOTP_ENROLLMENT_VALIDATION_ERROR'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:totp:participant:' || p_participant::text, 0)
  );

  SELECT * INTO v_participant
  FROM participants
  WHERE id = p_participant
  FOR UPDATE;

  IF NOT FOUND
     OR v_participant.role NOT IN ('PART', 'ADMIN')
     OR v_participant.is_verified = FALSE
     OR v_participant.is_suspended = TRUE
     OR v_participant.is_deactivated = TRUE THEN
    RAISE EXCEPTION 'TOTP_PARTICIPANT_NOT_ELIGIBLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM authenticator_enrollments
    WHERE participant_id = p_participant AND status = 'Active'
  ) THEN
    RAISE EXCEPTION 'TOTP_AUTHENTICATOR_ALREADY_ACTIVE'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM authenticator_enrollments
    WHERE participant_id = p_participant AND status = 'Pending'
  ) THEN
    RAISE EXCEPTION 'TOTP_ENROLLMENT_NOT_PENDING'
      USING ERRCODE = 'P0001';
  END IF;

  -- The prior secret becomes terminal before the replacement is inserted in
  -- this transaction. The shared participant lock also serializes activation,
  -- so the replaced enrollment can never become active afterwards.
  UPDATE authenticator_enrollments
  SET status = 'Canceled', retired_at = NOW()
  WHERE participant_id = p_participant
    AND status = 'Pending';

  INSERT INTO authenticator_enrollments (
    id,
    participant_id,
    secret_ciphertext,
    secret_iv,
    secret_auth_tag,
    encryption_key_version,
    status,
    pending_expires_at
  ) VALUES (
    p_enrollment,
    p_participant,
    p_secret_ciphertext,
    p_secret_iv,
    p_secret_auth_tag,
    p_key_version,
    'Pending',
    p_expires_at
  );

  RETURN QUERY SELECT p_enrollment, 'Pending'::VARCHAR(16), p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION restart_authenticator_enrollment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION restart_authenticator_enrollment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
