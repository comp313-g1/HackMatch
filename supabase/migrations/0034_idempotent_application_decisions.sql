-- Migration: 0034_idempotent_application_decisions.sql
-- Description: US-020 / #193 / FR-061 / FR-062 — make repeated owner
-- application decisions idempotent and return explicit conflicts for stale or
-- opposite decisions without repeating membership, cascade, or alert writes.

ALTER FUNCTION approve_team_application(UUID, UUID)
  RENAME TO approve_team_application_once;

ALTER FUNCTION decline_team_application(UUID, UUID)
  RENAME TO decline_team_application_once;

-- The one-shot implementations are callable only by the secured wrappers.
REVOKE ALL ON FUNCTION approve_team_application_once(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION decline_team_application_once(UUID, UUID)
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
  v_req team_requests%ROWTYPE;
  v_team teams%ROWTYPE;
  v_membership team_memberships%ROWTYPE;
  v_vacancy team_vacancies%ROWTYPE;
  v_result JSONB;
  v_member_count INTEGER := 0;
  v_max_team_size INTEGER := 4;
  v_idempotent BOOLEAN := FALSE;
BEGIN
  IF p_actor IS NULL OR p_application IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'actorRequired', p_actor IS NULL,
              'applicationRequired', p_application IS NULL
            )::text;
  END IF;

  SELECT * INTO v_req
  FROM team_requests
  WHERE id = p_application
    AND request_type = 'Application';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_team
  FROM teams
  WHERE id = v_req.team_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Authorization is always rechecked, including repeat requests. A completed
  -- outcome must not become an information-disclosure path for non-owners.
  IF v_team.owner_participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_TEAM_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.status = 'Accepted' THEN
    v_idempotent := TRUE;
  ELSIF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'APPLICATION_DECISION_CONFLICT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'applicationId', v_req.id,
              'requestedDecision', 'approve',
              'existingOutcome', v_req.status,
              'reason', v_req.cancel_reason,
              'resolvedAt', v_req.resolved_at,
              'retryable', FALSE
            )::text;
  ELSE
    BEGIN
      v_result := approve_team_application_once(p_actor, p_application);
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        -- A competing owner decision can finish after the preflight probe but
        -- before the one-shot function obtains its canonical locks.
        SELECT * INTO v_req
        FROM team_requests
        WHERE id = p_application
          AND request_type = 'Application';

        IF FOUND AND v_req.status = 'Accepted' THEN
          v_idempotent := TRUE;
        ELSIF FOUND AND v_req.status <> 'Pending' THEN
          RAISE EXCEPTION 'APPLICATION_DECISION_CONFLICT'
            USING ERRCODE = 'P0001',
                  DETAIL = jsonb_build_object(
                    'applicationId', v_req.id,
                    'requestedDecision', 'approve',
                    'existingOutcome', v_req.status,
                    'reason', v_req.cancel_reason,
                    'resolvedAt', v_req.resolved_at,
                    'retryable', FALSE
                  )::text;
        ELSE
          RAISE;
        END IF;
    END;
  END IF;

  IF v_idempotent THEN
    -- Return the persisted outcome without replaying membership, vacancy,
    -- availability, cascade, or notification writes. Membership history is
    -- retained even if the participant later left the unlocked team.
    SELECT * INTO v_membership
    FROM team_memberships
    WHERE team_id = v_req.team_id
      AND event_id = v_req.event_id
      AND participant_id = v_req.participant_id
    ORDER BY
      CASE WHEN status = 'Confirmed' THEN 0 ELSE 1 END,
      joined_at DESC
    LIMIT 1;

    IF v_req.vacancy_id IS NOT NULL THEN
      SELECT * INTO v_vacancy
      FROM team_vacancies
      WHERE id = v_req.vacancy_id;
    END IF;

    SELECT COUNT(*)::INTEGER INTO v_member_count
    FROM team_memberships
    WHERE team_id = v_req.team_id
      AND status = 'Confirmed';

    SELECT COALESCE(max_team_size, 4) INTO v_max_team_size
    FROM events
    WHERE id = v_req.event_id;
    v_max_team_size := COALESCE(v_max_team_size, 4);

    RETURN jsonb_build_object(
      'approved', TRUE,
      'changed', FALSE,
      'idempotent', TRUE,
      'existingOutcome', 'Accepted',
      'application', to_jsonb(v_req),
      'membership', to_jsonb(v_membership),
      'vacancy', to_jsonb(v_vacancy),
      'teamName', v_team.name,
      'vacancyRole', v_vacancy.role,
      'memberCount', v_member_count,
      'maxTeamSize', v_max_team_size,
      'availabilityCleared', FALSE,
      'membershipCommitted', v_membership.id IS NOT NULL
        AND v_membership.status = 'Confirmed',
      'cascade', jsonb_build_object(
        'winningRequestId', v_req.id,
        'eventInvitationsCanceled', 0,
        'eventApplicationsWithdrawn', 0,
        'slotRequestsCanceled', 0,
        'teamRequestsCanceled', 0,
        'teamNowFull', v_member_count >= v_max_team_size
      ),
      'notice', 'Application was already approved. No changes were made.'
    );
  END IF;

  RETURN v_result || jsonb_build_object(
    'changed', TRUE,
    'idempotent', FALSE,
    'existingOutcome', 'Accepted'
  );
END;
$$;

CREATE OR REPLACE FUNCTION decline_team_application(
  p_actor UUID,
  p_application UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req team_requests%ROWTYPE;
  v_team teams%ROWTYPE;
  v_result JSONB;
  v_idempotent BOOLEAN := FALSE;
  v_role TEXT;
BEGIN
  IF p_actor IS NULL OR p_application IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'actorRequired', p_actor IS NULL,
              'applicationRequired', p_application IS NULL
            )::text;
  END IF;

  SELECT * INTO v_req
  FROM team_requests
  WHERE id = p_application
    AND request_type = 'Application';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_team
  FROM teams
  WHERE id = v_req.team_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.owner_participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_TEAM_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF v_req.status = 'Declined' AND v_req.cancel_reason = 'OWNER_DECLINED' THEN
    v_idempotent := TRUE;
  ELSIF v_req.status <> 'Pending' THEN
    RAISE EXCEPTION 'APPLICATION_DECISION_CONFLICT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'applicationId', v_req.id,
              'requestedDecision', 'decline',
              'existingOutcome', v_req.status,
              'reason', v_req.cancel_reason,
              'resolvedAt', v_req.resolved_at,
              'retryable', FALSE
            )::text;
  ELSE
    BEGIN
      v_result := decline_team_application_once(p_actor, p_application);
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        SELECT * INTO v_req
        FROM team_requests
        WHERE id = p_application
          AND request_type = 'Application';

        IF FOUND
           AND v_req.status = 'Declined'
           AND v_req.cancel_reason = 'OWNER_DECLINED' THEN
          v_idempotent := TRUE;
        ELSIF FOUND AND v_req.status <> 'Pending' THEN
          RAISE EXCEPTION 'APPLICATION_DECISION_CONFLICT'
            USING ERRCODE = 'P0001',
                  DETAIL = jsonb_build_object(
                    'applicationId', v_req.id,
                    'requestedDecision', 'decline',
                    'existingOutcome', v_req.status,
                    'reason', v_req.cancel_reason,
                    'resolvedAt', v_req.resolved_at,
                    'retryable', FALSE
                  )::text;
        ELSE
          RAISE;
        END IF;
    END;
  END IF;

  IF v_idempotent THEN
    SELECT role INTO v_role
    FROM team_vacancies
    WHERE id = v_req.vacancy_id;

    RETURN jsonb_build_object(
      'decision', 'decline',
      'application', to_jsonb(v_req),
      'changed', FALSE,
      'idempotent', TRUE,
      'existingOutcome', 'Declined',
      'teamName', v_team.name,
      'vacancyRole', v_role,
      'alerts', jsonb_build_array(),
      'effects', jsonb_build_object(
        'applicationChanged', FALSE,
        'applicantAlertCreated', FALSE,
        'ownerAlertCreated', FALSE,
        'pendingQuotaReleased', FALSE,
        'availabilityChanged', FALSE,
        'membershipChanged', FALSE,
        'vacancyChanged', FALSE,
        'capacityChanged', FALSE
      ),
      'notice', 'Application was already declined. No changes or duplicate alerts were created.'
    );
  END IF;

  RETURN v_result || jsonb_build_object(
    'decision', 'decline',
    'changed', TRUE,
    'idempotent', FALSE,
    'existingOutcome', 'Declined'
  );
END;
$$;

REVOKE ALL ON FUNCTION approve_team_application(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_team_application(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION decline_team_application(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION decline_team_application(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION approve_team_application(UUID, UUID) IS
  'US-020 / #193: same-decision approval repeats return the existing outcome without replaying writes; stale opposite decisions conflict.';

COMMENT ON FUNCTION decline_team_application(UUID, UUID) IS
  'US-020 / #193: same-decision decline repeats return the existing outcome without duplicate alerts; stale opposite decisions conflict.';

COMMENT ON FUNCTION approve_team_application_once(UUID, UUID) IS
  'Internal #190/#191 one-shot approval implementation. Invoke only through the #193 idempotent wrapper.';

COMMENT ON FUNCTION decline_team_application_once(UUID, UUID) IS
  'Internal #192 one-shot decline implementation. Invoke only through the #193 idempotent wrapper.';
