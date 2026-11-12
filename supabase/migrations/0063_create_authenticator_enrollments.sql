-- Migration: 0063_create_authenticator_enrollments.sql
-- Description: US-029 / #267 — protected, server-managed TOTP enrollment rows
-- and atomic begin/activation operations. Secret encryption and TOTP verification
-- happen in the Node service; PostgreSQL stores ciphertext only.

CREATE TABLE IF NOT EXISTS authenticator_enrollments (
  id UUID PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL CHECK (LENGTH(secret_ciphertext) >= 16),
  secret_iv TEXT NOT NULL CHECK (LENGTH(secret_iv) >= 12),
  secret_auth_tag TEXT NOT NULL CHECK (LENGTH(secret_auth_tag) >= 16),
  encryption_key_version VARCHAR(32) NOT NULL CHECK (
    encryption_key_version ~ '^[A-Za-z0-9._-]{1,32}$'
  ),
  status VARCHAR(16) NOT NULL DEFAULT 'Pending' CHECK (
    status IN ('Pending', 'Active', 'Retired', 'Expired', 'Canceled')
  ),
  pending_expires_at TIMESTAMPTZ NULL,
  activated_at TIMESTAMPTZ NULL,
  retired_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_authenticator_enrollment_lifecycle CHECK (
    (
      status = 'Pending'
      AND pending_expires_at IS NOT NULL
      AND pending_expires_at > created_at
      AND activated_at IS NULL
      AND retired_at IS NULL
    )
    OR (
      status = 'Active'
      AND pending_expires_at IS NULL
      AND activated_at IS NOT NULL
      AND retired_at IS NULL
    )
    OR (
      status = 'Retired'
      AND pending_expires_at IS NULL
      AND activated_at IS NOT NULL
      AND retired_at IS NOT NULL
      AND retired_at >= activated_at
    )
    OR (
      status IN ('Expired', 'Canceled')
      AND pending_expires_at IS NOT NULL
      AND activated_at IS NULL
      AND retired_at IS NOT NULL
    )
  )
);

ALTER TABLE authenticator_enrollments ENABLE ROW LEVEL SECURITY;

-- A browser never receives direct table access, even for its own credential.
REVOKE ALL ON TABLE authenticator_enrollments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE authenticator_enrollments TO service_role;

-- One current pending enrollment and one active credential per account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_authenticator_enrollments_pending_participant
  ON authenticator_enrollments(participant_id)
  WHERE status = 'Pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_authenticator_enrollments_active_participant
  ON authenticator_enrollments(participant_id)
  WHERE status = 'Active';

-- Supports pending-expiry cleanup without scanning historical/active rows.
CREATE INDEX IF NOT EXISTS idx_authenticator_enrollments_pending_expiry
  ON authenticator_enrollments(pending_expires_at)
  WHERE status = 'Pending';

DROP TRIGGER IF EXISTS trigger_authenticator_enrollments_updated_at
  ON authenticator_enrollments;
CREATE TRIGGER trigger_authenticator_enrollments_updated_at
  BEFORE UPDATE ON authenticator_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Begin is serialized per participant. Expired pending rows are terminalized
-- first; an active or still-pending factor yields the #266 deterministic error.
CREATE OR REPLACE FUNCTION begin_authenticator_enrollment(
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

  UPDATE authenticator_enrollments
  SET status = 'Expired', retired_at = NOW()
  WHERE participant_id = p_participant
    AND status = 'Pending'
    AND pending_expires_at <= NOW();

  IF EXISTS (
    SELECT 1 FROM authenticator_enrollments
    WHERE participant_id = p_participant AND status = 'Active'
  ) THEN
    RAISE EXCEPTION 'TOTP_AUTHENTICATOR_ALREADY_ACTIVE'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM authenticator_enrollments
    WHERE participant_id = p_participant AND status = 'Pending'
  ) THEN
    RAISE EXCEPTION 'TOTP_ENROLLMENT_PENDING'
      USING ERRCODE = 'P0001';
  END IF;

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

-- Activation rechecks ownership/status/expiry under the same participant lock.
-- If a future #269 replacement flow creates a pending row beside an active one,
-- the old factor is retired only in the transaction that activates the new one.
CREATE OR REPLACE FUNCTION activate_authenticator_enrollment(
  p_participant UUID,
  p_enrollment UUID
) RETURNS TABLE (
  outcome TEXT,
  enrollment_id UUID,
  activation_time TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row authenticator_enrollments%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_participant IS NULL OR p_enrollment IS NULL THEN
    RAISE EXCEPTION 'TOTP_ENROLLMENT_VALIDATION_ERROR'
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

  IF v_row.pending_expires_at <= v_now THEN
    UPDATE authenticator_enrollments
    SET status = 'Expired', retired_at = v_now
    WHERE id = v_row.id;

    RETURN QUERY SELECT 'Expired'::TEXT, v_row.id, NULL::TIMESTAMPTZ;
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

  RETURN QUERY SELECT 'Activated'::TEXT, v_row.id, v_now;
END;
$$;

REVOKE ALL ON FUNCTION begin_authenticator_enrollment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION begin_authenticator_enrollment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION activate_authenticator_enrollment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION activate_authenticator_enrollment(UUID, UUID)
  TO service_role;
