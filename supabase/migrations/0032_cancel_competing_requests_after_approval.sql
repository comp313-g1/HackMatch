-- Migration: 0032_cancel_competing_requests_after_approval.sql
-- Description: US-020 / #191 / FR-061 — extend atomic application approval
-- with the shared placement cascade from #181. Approval and every competing
-- request transition either commit together or roll back together.

ALTER FUNCTION approve_team_application(UUID, UUID)
  RENAME TO approve_team_application_without_cascade;

-- The implementation is callable only by the secured public wrapper below.
REVOKE ALL ON FUNCTION approve_team_application_without_cascade(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION approve_team_application(
  p_actor UUID,
  p_application UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_cascade JSONB;
  v_team_now_full BOOLEAN;
BEGIN
  -- #190 remains the authoritative validation, authorization, locking, and
  -- membership transaction. A failure below rolls all of those writes back.
  v_result := approve_team_application_without_cascade(p_actor, p_application);

  v_team_now_full :=
    (v_result ->> 'memberCount')::INTEGER >=
    (v_result ->> 'maxTeamSize')::INTEGER;

  v_cascade := cancel_competing_requests_on_placement(
    p_application,
    (v_result #>> '{application,participant_id}')::UUID,
    (v_result #>> '{application,event_id}')::UUID,
    (v_result #>> '{application,team_id}')::UUID,
    NULLIF(v_result #>> '{application,vacancy_id}', '')::UUID,
    v_team_now_full
  );

  RETURN v_result || jsonb_build_object(
    'cascade', v_cascade,
    'notice',
      'Application approved. Membership is confirmed, the vacancy is filled, and competing pending requests were cleared.'
  );
END;
$$;

REVOKE ALL ON FUNCTION approve_team_application(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_team_application(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION approve_team_application(UUID, UUID) IS
  'US-020 / #190 / #191: atomically approve an application, confirm membership, fill the vacancy, and clear competing pending requests.';

COMMENT ON FUNCTION approve_team_application_without_cascade(UUID, UUID) IS
  'Internal #190 approval implementation. Invoke only through the #191 approve_team_application wrapper.';
