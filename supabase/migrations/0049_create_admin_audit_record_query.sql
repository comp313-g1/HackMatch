-- Migration: 0049_create_admin_audit_record_query.sql
-- Description: US-028 / #258 — append-only audit-record QUERY model (FR-080, FR-079).
-- Builds the read side on top of event_action_records (0006), which already
-- stores event, moderation_* and account_* administrative action records:
--   * composite indexes so actor / action-type / date filters and newest-first
--     keyset paging never scan or sort the whole table,
--   * defense-in-depth append-only grants (the Express service role can no
--     longer UPDATE / DELETE / TRUNCATE even if application code tried to),
--   * query_admin_audit_records(): an ADMIN-verified, read-only, single-snapshot
--     filtered page with a stable (created_at, id) cursor.
-- Additive and idempotent. Existing rows and writers are untouched.

-- ---------------------------------------------------------------------------
-- 1. Indexes for filtering + keyset paging (all newest-first)
-- ---------------------------------------------------------------------------

-- Unfiltered page and date-range scans.
CREATE INDEX IF NOT EXISTS idx_event_action_records_created_at_id
  ON event_action_records(created_at DESC, id DESC);

-- "Everything this administrator did".
CREATE INDEX IF NOT EXISTS idx_event_action_records_actor_created
  ON event_action_records(actor_id, created_at DESC, id DESC);

-- Exact action type AND prefix (category) filters; varchar_pattern_ops lets
-- LIKE 'moderation\_%' use the index regardless of database collation.
CREATE INDEX IF NOT EXISTS idx_event_action_records_action_created
  ON event_action_records(action_type varchar_pattern_ops, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 2. Append-only, defense in depth (0006 already blocks UPDATE/DELETE/TRUNCATE
--    with triggers; also remove the privileges so the app role cannot even try)
-- ---------------------------------------------------------------------------

REVOKE UPDATE, DELETE, TRUNCATE ON event_action_records
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Audit query (read-only)
-- ---------------------------------------------------------------------------
-- Category is derived from the action_type prefix:
--   moderation_*  -> 'moderation'      account_*  -> 'account'      other -> 'event'
-- Authorization is re-verified here (not only in Express): the caller must be an
-- existing, non-suspended ADMIN, otherwise FORBIDDEN_NOT_ADMIN is raised before
-- anything is read. Validation errors are raised as VALIDATION_ERROR with a JSON
-- DETAIL naming the offending fields. Dates are inclusive on both ends.

CREATE OR REPLACE FUNCTION query_admin_audit_records(
  p_actor UUID,
  p_audit_actor UUID DEFAULT NULL,
  p_action_type TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 25,
  p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role VARCHAR(10);
  v_suspended BOOLEAN;
  v_action TEXT;
  v_errors JSONB := '{}'::jsonb;
  v_records JSONB;
  v_has_more BOOLEAN;
  v_last_ts TEXT;
  v_last_id UUID;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT role, is_suspended INTO v_role, v_suspended
  FROM participants
  WHERE id = p_actor;

  IF NOT FOUND OR v_role IS DISTINCT FROM 'ADMIN' OR v_suspended IS TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  v_action := NULLIF(BTRIM(p_action_type), '');
  IF p_action_type IS NOT NULL AND (v_action IS NULL OR LENGTH(v_action) > 50) THEN
    v_errors := v_errors || jsonb_build_object('actionType', 'actionType must be 1-50 characters.');
  END IF;

  IF p_category IS NOT NULL AND p_category NOT IN ('event', 'moderation', 'account') THEN
    v_errors := v_errors || jsonb_build_object('category', 'category must be event, moderation, or account.');
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    v_errors := v_errors || jsonb_build_object('limit', 'limit must be between 1 and 100.');
  END IF;

  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    v_errors := v_errors || jsonb_build_object('from', 'from must not be after to.');
  END IF;

  IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
    v_errors := v_errors || jsonb_build_object('cursor', 'cursor is incomplete.');
  END IF;

  IF v_errors <> '{}'::jsonb THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001', DETAIL = v_errors::text;
  END IF;

  -- One statement = one snapshot: the page and its "has more" flag are consistent
  -- even while new action records are being appended.
  WITH fetched AS (
    SELECT r.*
    FROM event_action_records r
    WHERE (p_audit_actor IS NULL OR r.actor_id = p_audit_actor)
      AND (v_action IS NULL OR r.action_type = v_action)
      AND (
        p_category IS NULL
        OR (p_category = 'moderation' AND r.action_type LIKE 'moderation\_%')
        OR (p_category = 'account' AND r.action_type LIKE 'account\_%')
        OR (
          p_category = 'event'
          AND r.action_type NOT LIKE 'moderation\_%'
          AND r.action_type NOT LIKE 'account\_%'
        )
      )
      AND (p_from IS NULL OR r.created_at >= p_from)
      AND (p_to IS NULL OR r.created_at <= p_to)
      AND (
        p_cursor_created_at IS NULL
        OR (r.created_at, r.id) < (p_cursor_created_at, p_cursor_id)
      )
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT p_limit + 1
  ),
  ranked AS (
    SELECT f.*, ROW_NUMBER() OVER (ORDER BY f.created_at DESC, f.id DESC) AS rn
    FROM fetched f
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', k.id,
          'actorId', k.actor_id,
          'targetType', k.target_type,
          'targetId', k.target_id,
          'actionType', k.action_type,
          'category', CASE
            WHEN k.action_type LIKE 'moderation\_%' THEN 'moderation'
            WHEN k.action_type LIKE 'account\_%' THEN 'account'
            ELSE 'event'
          END,
          'reason', k.reason,
          'outcome', k.outcome,
          'safeStateSummary', k.safe_state_summary,
          'createdAt', to_char(k.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        )
        ORDER BY k.rn
      ) FILTER (WHERE k.rn <= p_limit),
      '[]'::jsonb
    ),
    COUNT(*) > p_limit,
    (ARRAY_AGG(
      to_char(k.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ORDER BY k.rn
    ) FILTER (WHERE k.rn = p_limit))[1],
    (ARRAY_AGG(k.id ORDER BY k.rn) FILTER (WHERE k.rn = p_limit))[1]
  INTO v_records, v_has_more, v_last_ts, v_last_id
  FROM ranked k;

  RETURN jsonb_build_object(
    'records', v_records,
    'hasMore', v_has_more,
    'nextCursor', CASE
      WHEN v_has_more THEN jsonb_build_object('createdAt', v_last_ts, 'id', v_last_id)
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION query_admin_audit_records(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION query_admin_audit_records(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, UUID
) TO service_role;

COMMENT ON FUNCTION query_admin_audit_records(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, UUID
) IS
  'US-028 / #258 / FR-080: read-only, ADMIN-verified, newest-first keyset page of event_action_records filtered by actor, action type/category and inclusive UTC date range.';

COMMENT ON TABLE event_action_records IS
  'FR-079 append-only administrative action records (event, moderation_*, account_*). UPDATE/DELETE/TRUNCATE are blocked by triggers (0006) and revoked from every application role (0049); queried via query_admin_audit_records() (US-028).';
