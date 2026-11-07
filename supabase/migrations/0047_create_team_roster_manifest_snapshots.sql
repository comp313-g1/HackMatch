-- Migration: 0047_create_team_roster_manifest_snapshots.sql
-- Description: US-024 / #223 / FR-071 / FR-072 — locked-team roster manifest snapshot
--              storage and integrity tracking with canonical serialization and SHA-256 checksums.

-- ---------------------------------------------------------------------------
-- 1. Latest canonical manifest record per locked team
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_roster_manifests (
  team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  schema_version VARCHAR(16) NOT NULL DEFAULT '1.0' CHECK (schema_version = '1.0'),
  locked_at TIMESTAMPTZ NOT NULL,
  member_count INTEGER NOT NULL CHECK (member_count >= 2),
  snapshot_json JSONB NOT NULL,
  canonical_json TEXT NOT NULL CHECK (LENGTH(TRIM(canonical_json)) > 0),
  checksum VARCHAR(71) NOT NULL CHECK (
    checksum ~ '^sha256:[0-9a-f]{64}$'
  ),
  last_exported_by UUID NULL REFERENCES participants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE team_roster_manifests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_team_roster_manifests_event_id
  ON team_roster_manifests(event_id);

CREATE INDEX IF NOT EXISTS idx_team_roster_manifests_checksum
  ON team_roster_manifests(checksum);

DROP TRIGGER IF EXISTS trigger_team_roster_manifests_updated_at ON team_roster_manifests;
CREATE TRIGGER trigger_team_roster_manifests_updated_at
  BEFORE UPDATE ON team_roster_manifests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Append-only historical snapshots log for integrity verification
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_roster_manifest_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  schema_version VARCHAR(16) NOT NULL DEFAULT '1.0' CHECK (schema_version = '1.0'),
  locked_at TIMESTAMPTZ NOT NULL,
  member_count INTEGER NOT NULL CHECK (member_count >= 2),
  snapshot_json JSONB NOT NULL,
  canonical_json TEXT NOT NULL CHECK (LENGTH(TRIM(canonical_json)) > 0),
  checksum VARCHAR(71) NOT NULL CHECK (
    checksum ~ '^sha256:[0-9a-f]{64}$'
  ),
  recorded_by UUID NULL REFERENCES participants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_roster_manifest_snapshots_team_checksum UNIQUE (team_id, checksum)
);

ALTER TABLE team_roster_manifest_snapshots ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_team_roster_manifest_snapshots_team_created
  ON team_roster_manifest_snapshots(team_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Atomic manifest snapshot recorder (SECURITY DEFINER, service_role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_team_roster_manifest_snapshot(
  p_actor UUID,
  p_team UUID,
  p_event UUID,
  p_locked_at TIMESTAMPTZ,
  p_member_count INTEGER,
  p_snapshot_json JSONB,
  p_canonical_json TEXT,
  p_checksum VARCHAR(71)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_manifest team_roster_manifests%ROWTYPE;
BEGIN
  IF p_team IS NULL OR p_event IS NULL OR p_locked_at IS NULL OR p_snapshot_json IS NULL OR p_canonical_json IS NULL OR p_checksum IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:manifest:team:' || p_team::text, 0)
  );

  SELECT * INTO v_team
  FROM teams
  WHERE id = p_team;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.recruitment_status <> 'Locked' OR v_team.locked_at IS NULL THEN
    RAISE EXCEPTION 'TEAM_NOT_MUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('reason', v_team.recruitment_status)::text;
  END IF;

  INSERT INTO team_roster_manifests (
    team_id,
    event_id,
    schema_version,
    locked_at,
    member_count,
    snapshot_json,
    canonical_json,
    checksum,
    last_exported_by,
    updated_at
  ) VALUES (
    p_team,
    p_event,
    '1.0',
    p_locked_at,
    p_member_count,
    p_snapshot_json,
    p_canonical_json,
    p_checksum,
    p_actor,
    NOW()
  )
  ON CONFLICT (team_id) DO UPDATE
  SET
    event_id = EXCLUDED.event_id,
    locked_at = EXCLUDED.locked_at,
    member_count = EXCLUDED.member_count,
    snapshot_json = EXCLUDED.snapshot_json,
    canonical_json = EXCLUDED.canonical_json,
    checksum = EXCLUDED.checksum,
    last_exported_by = EXCLUDED.last_exported_by,
    updated_at = NOW()
  RETURNING * INTO v_manifest;

  INSERT INTO team_roster_manifest_snapshots (
    team_id,
    schema_version,
    locked_at,
    member_count,
    snapshot_json,
    canonical_json,
    checksum,
    recorded_by
  ) VALUES (
    p_team,
    '1.0',
    p_locked_at,
    p_member_count,
    p_snapshot_json,
    p_canonical_json,
    p_checksum,
    p_actor
  )
  ON CONFLICT (team_id, checksum) DO NOTHING;

  RETURN jsonb_build_object(
    'teamId', v_manifest.team_id,
    'eventId', v_manifest.event_id,
    'schemaVersion', v_manifest.schema_version,
    'lockedAt', v_manifest.locked_at,
    'memberCount', v_manifest.member_count,
    'checksum', v_manifest.checksum
  );
END;
$$;

REVOKE ALL ON FUNCTION record_team_roster_manifest_snapshot(UUID, UUID, UUID, TIMESTAMPTZ, INTEGER, JSONB, TEXT, VARCHAR(71)) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_team_roster_manifest_snapshot(UUID, UUID, UUID, TIMESTAMPTZ, INTEGER, JSONB, TEXT, VARCHAR(71)) TO service_role;
