-- Migration: 0066_serialize_mfa_verification_attempts.sql
-- Description: US-029 / #271 — make the US-004 five-attempt / 15-minute email
-- OTP lock race-safe. Every verification first reserves an attempt row here,
-- serialized per participant, BEFORE the code is compared. Each reservation
-- is timestamped with clock_timestamp() while the advisory lock is held, so
-- row order equals commit order and a caller can tell exactly how many
-- attempts precede its own. Concurrent guesses beyond the fifth are therefore
-- rejected without ever being compared. Lock policy math is unchanged and
-- stays in the Node service (evaluateAccountLockout).

CREATE OR REPLACE FUNCTION reserve_mfa_verification_attempt(
  p_participant UUID,
  p_challenge UUID,
  p_ip_address TEXT
) RETURNS TABLE (
  attempt_id UUID,
  attempted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
  v_attempted_at TIMESTAMPTZ;
BEGIN
  IF p_participant IS NULL THEN
    RAISE EXCEPTION 'MFA_ATTEMPT_VALIDATION_ERROR'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:mfa-attempt:participant:' || p_participant::text, 0)
  );

  -- Taken after the lock is acquired, so timestamps follow serialization order.
  -- Forced strictly past this participant's latest attempt so coarse clocks can
  -- never produce ties (callers rely on created_at order to find their position).
  v_attempted_at := GREATEST(
    clock_timestamp(),
    COALESCE(
      (SELECT MAX(created_at) FROM mfa_attempts WHERE participant_id = p_participant),
      '-infinity'::TIMESTAMPTZ
    ) + INTERVAL '1 microsecond'
  );

  -- Recorded as a failure until the caller proves the code matched.
  INSERT INTO mfa_attempts (participant_id, challenge_id, success, ip_address, created_at)
  VALUES (p_participant, p_challenge, FALSE, LEFT(p_ip_address, 45), v_attempted_at)
  RETURNING id INTO v_attempt_id;

  RETURN QUERY SELECT v_attempt_id, v_attempted_at;
END;
$$;

REVOKE ALL ON FUNCTION reserve_mfa_verification_attempt(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_mfa_verification_attempt(UUID, UUID, TEXT)
  TO service_role;
