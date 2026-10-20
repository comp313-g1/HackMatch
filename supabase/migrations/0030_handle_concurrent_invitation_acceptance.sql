-- Migration: 0030_handle_concurrent_invitation_acceptance.sql
-- Description: US-019 / #184 — serialize related invitation acceptances before
--              row locks and return deterministic conflicts when another acceptance wins.

-- Keep the #180/#181 transaction as an internal implementation. The public
-- wrapper below acquires canonical transaction locks before the core function
-- takes any row locks, preventing competing acceptance/cascade deadlocks.
ALTER FUNCTION accept_team_invitation(UUID, UUID)
  RENAME TO accept_team_invitation_unserialized;

REVOKE ALL ON FUNCTION accept_team_invitation_unserialized(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION accept_team_invitation(
  p_actor UUID,
  p_invitation UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_probe team_requests%ROWTYPE;
  v_result JSONB;
BEGIN
  IF p_actor IS NULL OR p_invitation IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('field', 'invitationId')::text;
  END IF;

  -- This first read intentionally takes no row lock. Related acceptances must
  -- reach the advisory-lock boundary without holding invitation rows that a
  -- winning transaction's cascade may need to cancel.
  SELECT * INTO v_probe
  FROM team_requests
  WHERE id = p_invitation
    AND request_type = 'Invitation';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_probe.participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_INVITEE' USING ERRCODE = 'P0001';
  END IF;

  -- Canonical lock order for every acceptance:
  --   1. participant + event (one confirmed team per PART/event)
  --   2. target team (capacity, vacancy, and full-team cascade)
  -- The 64-bit keys are transaction-scoped and automatically released on
  -- commit/rollback. The core RPC takes authoritative row locks afterwards.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hackmatch:accept:participant-event:' || p_actor::text || ':' || v_probe.event_id::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:accept:team:' || v_probe.team_id::text, 0)
  );

  -- Re-read after waiting. A winning acceptance may have accepted this exact
  -- invitation or canceled it through the #181 competing-request cascade.
  SELECT * INTO v_probe
  FROM team_requests
  WHERE id = p_invitation
    AND request_type = 'Invitation';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_probe.participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_INVITEE' USING ERRCODE = 'P0001';
  END IF;

  IF v_probe.status = 'Accepted' THEN
    RAISE EXCEPTION 'INVITATION_ACCEPTANCE_CONFLICT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'invitationId', v_probe.id,
              'status', v_probe.status,
              'reason', 'ALREADY_ACCEPTED',
              'retryable', FALSE
            )::text;
  END IF;

  IF v_probe.status = 'Canceled'
     AND v_probe.cancel_reason IN (
       'EVENT_MEMBERSHIP_CONFIRMED',
       'SLOT_FILLED',
       'TEAM_FULL'
     ) THEN
    RAISE EXCEPTION 'INVITATION_ACCEPTANCE_CONFLICT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'invitationId', v_probe.id,
              'status', v_probe.status,
              'reason', v_probe.cancel_reason,
              'retryable', FALSE
            )::text;
  END IF;

  BEGIN
    v_result := accept_team_invitation_unserialized(p_actor, p_invitation);
  EXCEPTION
    WHEN deadlock_detected OR serialization_failure OR lock_not_available THEN
      RAISE EXCEPTION 'INVITATION_ACCEPTANCE_CONFLICT'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'invitationId', p_invitation,
                'reason', 'DATABASE_CONCURRENCY_RETRY',
                'retryable', TRUE
              )::text;
  END;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION accept_team_invitation(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_team_invitation(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION accept_team_invitation(UUID, UUID) IS
  'US-019 / #184: serializes participant/event and team acceptance races, then invokes the atomic #180/#181 acceptance transaction with explicit 409 conflict outcomes.';

COMMENT ON FUNCTION accept_team_invitation_unserialized(UUID, UUID) IS
  'Internal #180/#181 acceptance implementation. Invoke only through the #184 serialized accept_team_invitation wrapper.';
