-- Migration: 0065_add_authenticator_recovery_controls.sql
-- Description: US-029 / #269 — owner-scoped recovery-code verifiers and atomic
-- replacement/disable operations for an active authenticator. Raw recovery
-- codes and TOTP secrets never reach PostgreSQL: the Node service stores only
-- keyed HMAC verifiers here and AES-GCM ciphertext in authenticator_enrollments.

CREATE TABLE IF NOT EXISTS authenticator_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  -- One generation; regenerating revokes every row of the previous batch.
  batch_id UUID NOT NULL,
  -- base64url HMAC-SHA256 (43 characters); irreversible without the server key.
  code_verifier VARCHAR(43) NOT NULL CHECK (code_verifier ~ '^[A-Za-z0-9_-]{43}$'),
  verifier_key_version VARCHAR(32) NOT NULL CHECK (
    verifier_key_version ~ '^[A-Za-z0-9._-]{1,32}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Single-use semantics: a code is spent once used_at is set.
  used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_authenticator_recovery_code_used_after_created CHECK (
    used_at IS NULL OR used_at >= created_at
  ),
  CONSTRAINT chk_authenticator_recovery_code_revoked_after_created CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

ALTER TABLE authenticator_recovery_codes ENABLE ROW LEVEL SECURITY;

-- Browser roles never receive verifier rows, even for their own account.
REVOKE ALL ON TABLE authenticator_recovery_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE authenticator_recovery_codes TO service_role;

-- A verifier is unique per account so one code can never match two rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_authenticator_recovery_codes_participant_verifier
  ON authenticator_recovery_codes(participant_id, code_verifier);

-- Supports owner-scoped summaries of the current (non-revoked) set.
CREATE INDEX IF NOT EXISTS idx_authenticator_recovery_codes_current
  ON authenticator_recovery_codes(participant_id)
  WHERE revoked_at IS NULL;

-- Replacement keeps the existing active authenticator and its recovery codes.
-- Any older pending replacement is canceled so its lost setup key can never
-- activate. The old factor and recovery set are retired only by
-- activate_authenticator_replacement (below) when the new code is confirmed.
CREATE OR REPLACE FUNCTION begin_authenticator_replacement(
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

  IF NOT EXISTS (
    SELECT 1 FROM authenticator_enrollments
    WHERE participant_id = p_participant AND status = 'Active'
  ) THEN
    RAISE EXCEPTION 'TOTP_AUTHENTICATOR_NOT_ACTIVE'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE authenticator_enrollments
  SET status = 'Expired', retired_at = NOW()
  WHERE participant_id = p_participant
    AND status = 'Pending'
    AND pending_expires_at <= NOW();

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

-- Disabling retires the active factor (history rows are kept), cancels any
-- pending replacement, and revokes the current recovery set in one
-- transaction. Email OTP is untouched and remains the mandatory fallback.
CREATE OR REPLACE FUNCTION disable_authenticator(
  p_participant UUID
) RETURNS TABLE (
  disabled_at TIMESTAMPTZ,
  revoked_recovery_codes INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant participants%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_revoked INTEGER := 0;
BEGIN
  IF p_participant IS NULL THEN
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

  IF NOT EXISTS (
    SELECT 1 FROM authenticator_enrollments
    WHERE participant_id = p_participant AND status = 'Active'
  ) THEN
    RAISE EXCEPTION 'TOTP_AUTHENTICATOR_NOT_ACTIVE'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE authenticator_enrollments
  SET status = 'Canceled', retired_at = v_now
  WHERE participant_id = p_participant
    AND status = 'Pending';

  UPDATE authenticator_enrollments
  SET status = 'Retired', retired_at = v_now
  WHERE participant_id = p_participant
    AND status = 'Active';

  UPDATE authenticator_recovery_codes
  SET revoked_at = v_now
  WHERE participant_id = p_participant
    AND revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  RETURN QUERY SELECT v_now, v_revoked;
END;
$$;

-- Generates a new recovery set only for an account with an active
-- authenticator. p_expected_batch is the caller's view of the current set
-- (NULL = none); a mismatch means another session regenerated first, so the
-- request is rejected instead of silently invalidating codes that session is
-- displaying. The previous set is revoked in the same transaction as the
-- insert, so any failure leaves the previous set valid.
CREATE OR REPLACE FUNCTION replace_authenticator_recovery_codes(
  p_participant UUID,
  p_batch UUID,
  p_expected_batch UUID,
  p_verifiers TEXT[],
  p_key_version TEXT
) RETURNS TABLE (
  batch_id UUID,
  code_count INTEGER,
  generated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant participants%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_current_batch UUID;
  v_count INTEGER;
BEGIN
  v_count := COALESCE(cardinality(p_verifiers), 0);
  IF p_participant IS NULL
     OR p_batch IS NULL
     OR v_count < 1
     OR v_count > 20
     OR p_key_version IS NULL
     OR p_key_version !~ '^[A-Za-z0-9._-]{1,32}$'
     OR EXISTS (
       SELECT 1 FROM unnest(p_verifiers) AS verifier
       WHERE verifier IS NULL OR verifier !~ '^[A-Za-z0-9_-]{43}$'
     )
     OR (SELECT COUNT(DISTINCT verifier) FROM unnest(p_verifiers) AS verifier) <> v_count THEN
    RAISE EXCEPTION 'RECOVERY_CODES_VALIDATION_ERROR'
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

  IF NOT EXISTS (
    SELECT 1 FROM authenticator_enrollments
    WHERE participant_id = p_participant AND status = 'Active'
  ) THEN
    RAISE EXCEPTION 'TOTP_AUTHENTICATOR_NOT_ACTIVE'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT codes.batch_id INTO v_current_batch
  FROM authenticator_recovery_codes AS codes
  WHERE codes.participant_id = p_participant
    AND codes.revoked_at IS NULL
  ORDER BY codes.created_at DESC
  LIMIT 1;

  IF v_current_batch IS DISTINCT FROM p_expected_batch THEN
    RAISE EXCEPTION 'RECOVERY_CODES_STALE'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE authenticator_recovery_codes
  SET revoked_at = v_now
  WHERE participant_id = p_participant
    AND revoked_at IS NULL;

  INSERT INTO authenticator_recovery_codes (
    participant_id,
    batch_id,
    code_verifier,
    verifier_key_version,
    created_at
  )
  SELECT p_participant, p_batch, verifier, p_key_version, v_now
  FROM unnest(p_verifiers) AS verifier;

  RETURN QUERY SELECT p_batch, v_count, v_now;
END;
$$;

-- Confirms a replacement in one transaction: the old active factor is
-- retired, the new factor is activated, the previous recovery set is revoked,
-- and the fresh set's verifiers are inserted. Until this commits, the old
-- factor and its recovery codes stay valid; an expired, stale, or failed
-- confirmation changes neither.
CREATE OR REPLACE FUNCTION activate_authenticator_replacement(
  p_participant UUID,
  p_enrollment UUID,
  p_batch UUID,
  p_verifiers TEXT[],
  p_key_version TEXT
) RETURNS TABLE (
  outcome TEXT,
  enrollment_id UUID,
  activation_time TIMESTAMPTZ,
  recovery_batch_id UUID,
  recovery_code_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row authenticator_enrollments%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_count INTEGER;
BEGIN
  v_count := COALESCE(cardinality(p_verifiers), 0);
  IF p_participant IS NULL
     OR p_enrollment IS NULL
     OR p_batch IS NULL
     OR v_count < 1
     OR v_count > 20
     OR p_key_version IS NULL
     OR p_key_version !~ '^[A-Za-z0-9._-]{1,32}$'
     OR EXISTS (
       SELECT 1 FROM unnest(p_verifiers) AS verifier
       WHERE verifier IS NULL OR verifier !~ '^[A-Za-z0-9_-]{43}$'
     )
     OR (SELECT COUNT(DISTINCT verifier) FROM unnest(p_verifiers) AS verifier) <> v_count THEN
    RAISE EXCEPTION 'RECOVERY_CODES_VALIDATION_ERROR'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:totp:participant:' || p_participant::text, 0)
  );

  PERFORM 1
  FROM participants
  WHERE id = p_participant
    AND role IN ('PART', 'ADMIN')
    AND is_verified = TRUE
    AND is_suspended = FALSE
    AND is_deactivated = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOTP_PARTICIPANT_NOT_ELIGIBLE'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM authenticator_enrollments
  WHERE id = p_enrollment
    AND participant_id = p_participant
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM authenticator_enrollments
      WHERE participant_id = p_participant AND status = 'Pending'
    ) THEN
      RAISE EXCEPTION 'TOTP_ENROLLMENT_STALE'
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'TOTP_ENROLLMENT_NOT_PENDING'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status = 'Active' THEN
    RAISE EXCEPTION 'TOTP_AUTHENTICATOR_ALREADY_ACTIVE'
      USING ERRCODE = 'P0001';
  ELSIF v_row.status <> 'Pending' THEN
    RAISE EXCEPTION 'TOTP_ENROLLMENT_STALE'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM authenticator_enrollments
    WHERE participant_id = p_participant
      AND status = 'Active'
      AND id <> v_row.id
  ) THEN
    RAISE EXCEPTION 'TOTP_AUTHENTICATOR_NOT_ACTIVE'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.pending_expires_at <= v_now THEN
    -- Old factor and recovery codes are deliberately left untouched.
    UPDATE authenticator_enrollments
    SET status = 'Expired', retired_at = v_now
    WHERE id = v_row.id;

    RETURN QUERY SELECT 'Expired'::TEXT, v_row.id, NULL::TIMESTAMPTZ, NULL::UUID, 0;
    RETURN;
  END IF;

  UPDATE authenticator_enrollments
  SET status = 'Retired', retired_at = v_now
  WHERE participant_id = p_participant
    AND status = 'Active'
    AND id <> v_row.id;

  UPDATE authenticator_enrollments
  SET
    status = 'Active',
    pending_expires_at = NULL,
    activated_at = v_now,
    retired_at = NULL
  WHERE id = v_row.id;

  UPDATE authenticator_recovery_codes
  SET revoked_at = v_now
  WHERE participant_id = p_participant
    AND revoked_at IS NULL;

  INSERT INTO authenticator_recovery_codes (
    participant_id,
    batch_id,
    code_verifier,
    verifier_key_version,
    created_at
  )
  SELECT p_participant, p_batch, verifier, p_key_version, v_now
  FROM unnest(p_verifiers) AS verifier;

  RETURN QUERY SELECT 'Activated'::TEXT, v_row.id, v_now, p_batch, v_count;
END;
$$;

REVOKE ALL ON FUNCTION activate_authenticator_replacement(
  UUID, UUID, UUID, TEXT[], TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION activate_authenticator_replacement(
  UUID, UUID, UUID, TEXT[], TEXT
) TO service_role;

REVOKE ALL ON FUNCTION begin_authenticator_replacement(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION begin_authenticator_replacement(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION disable_authenticator(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION disable_authenticator(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION replace_authenticator_recovery_codes(
  UUID, UUID, UUID, TEXT[], TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_authenticator_recovery_codes(
  UUID, UUID, UUID, TEXT[], TEXT
) TO service_role;
