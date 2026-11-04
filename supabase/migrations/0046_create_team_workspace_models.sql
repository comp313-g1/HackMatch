-- Migration: 0046_create_team_workspace_models.sql
-- Description: US-023 / #US-023-T1 — PostgreSQL models for locked-team private workspace,
-- shared external tool links, shared markdown notes, and revision history (FR-068, FR-069, FR-070).
-- Access: RLS enabled with zero public policies (Express service role only).

-- ---------------------------------------------------------------------------
-- 1. Team workspaces
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_workspaces (
  team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE team_workspaces ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trigger_team_workspaces_updated_at ON team_workspaces;
CREATE TRIGGER trigger_team_workspaces_updated_at
  BEFORE UPDATE ON team_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE team_workspaces IS
  'US-023: root private coordination workspace container for a locked team (FR-068).';

-- ---------------------------------------------------------------------------
-- 2. Team workspace links (owner-managed external HTTPS links)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_workspace_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  label VARCHAR(80) NOT NULL CHECK (
    LENGTH(TRIM(label)) >= 1 AND LENGTH(TRIM(label)) <= 80
  ),
  url VARCHAR(2048) NOT NULL CHECK (
    url LIKE 'https://%' AND LENGTH(TRIM(url)) > 8 AND LENGTH(url) <= 2048
  ),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0 AND display_order < 10),
  updated_by UUID NULL REFERENCES participants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE team_workspace_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_team_workspace_links_team_order
  ON team_workspace_links(team_id, display_order ASC, created_at ASC);

DROP TRIGGER IF EXISTS trigger_team_workspace_links_updated_at ON team_workspace_links;
CREATE TRIGGER trigger_team_workspace_links_updated_at
  BEFORE UPDATE ON team_workspace_links
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE team_workspace_links IS
  'US-023: owner-managed HTTPS external tool links for locked teams (FR-069).';

-- ---------------------------------------------------------------------------
-- 3. Team workspace notes (collaborative markdown note with optimistic locking)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_workspace_notes (
  team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '' CHECK (LENGTH(content) <= 10000),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by UUID NULL REFERENCES participants(id) ON DELETE SET NULL,
  author_display_name VARCHAR(120) NULL,
  author_pseudonymized_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE team_workspace_notes ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trigger_team_workspace_notes_updated_at ON team_workspace_notes;
CREATE TRIGGER trigger_team_workspace_notes_updated_at
  BEFORE UPDATE ON team_workspace_notes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE team_workspace_notes IS
  'US-023: shared concept markdown note with versioned optimistic concurrency (FR-070).';

-- ---------------------------------------------------------------------------
-- 4. Team workspace note revisions (immutable history log)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_workspace_note_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  content TEXT NOT NULL CHECK (
    LENGTH(TRIM(content)) > 0 AND LENGTH(content) <= 10000
  ),
  author_id UUID NULL REFERENCES participants(id) ON DELETE SET NULL,
  author_display_name VARCHAR(120) NOT NULL CHECK (
    LENGTH(TRIM(author_display_name)) > 0 AND LENGTH(author_display_name) <= 120
  ),
  author_pseudonymized_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_workspace_note_revisions_team_version UNIQUE (team_id, version)
);

ALTER TABLE team_workspace_note_revisions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_team_workspace_note_revisions_team_version
  ON team_workspace_note_revisions(team_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_team_workspace_note_revisions_author
  ON team_workspace_note_revisions(author_id)
  WHERE author_id IS NOT NULL;

COMMENT ON TABLE team_workspace_note_revisions IS
  'US-023: append-only revision snapshots for shared team concept notes (FR-070).';

-- ---------------------------------------------------------------------------
-- 5. Atomic optimistic note save function (US-023 / FR-070)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION save_team_workspace_note(
  p_actor UUID,
  p_team UUID,
  p_content TEXT,
  p_expected_version INTEGER,
  p_author_display_name VARCHAR(120)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_membership team_memberships%ROWTYPE;
  v_note team_workspace_notes%ROWTYPE;
  v_current_version INTEGER := 0;
  v_next_version INTEGER := 1;
  v_saved_note team_workspace_notes%ROWTYPE;
  v_saved_revision team_workspace_note_revisions%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_team IS NULL OR p_content IS NULL OR p_expected_version IS NULL OR p_author_display_name IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize note mutations for the team so concurrent first-saves or updates do not interleave.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:workspace:note:' || p_team::text, 0)
  );

  SELECT * INTO v_team
  FROM teams
  WHERE id = p_team;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.recruitment_status <> 'Locked' OR v_team.locked_at IS NULL THEN
    RAISE EXCEPTION 'WORKSPACE_TEAM_NOT_LOCKED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('recruitmentStatus', v_team.recruitment_status)::text;
  END IF;

  SELECT * INTO v_membership
  FROM team_memberships
  WHERE team_id = p_team
    AND participant_id = p_actor
    AND status = 'Confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note
  FROM team_workspace_notes
  WHERE team_id = p_team
  FOR UPDATE;

  IF FOUND THEN
    v_current_version := v_note.version;
  ELSE
    v_current_version := 0;
  END IF;

  IF v_current_version <> p_expected_version THEN
    RAISE EXCEPTION 'WORKSPACE_NOTE_CONFLICT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'currentVersion', v_current_version,
              'expectedVersion', p_expected_version,
              'currentContent', COALESCE(v_note.content, ''),
              'updatedAt', v_note.updated_at,
              'authorDisplayName', v_note.author_display_name
            )::text;
  END IF;

  v_next_version := v_current_version + 1;

  INSERT INTO team_workspaces (team_id, created_at, updated_at)
  VALUES (p_team, now(), now())
  ON CONFLICT (team_id) DO UPDATE SET updated_at = now();

  INSERT INTO team_workspace_notes (
    team_id,
    content,
    version,
    updated_by,
    author_display_name,
    author_pseudonymized_at,
    updated_at
  ) VALUES (
    p_team,
    p_content,
    v_next_version,
    p_actor,
    p_author_display_name,
    NULL,
    now()
  )
  ON CONFLICT (team_id) DO UPDATE
  SET content = EXCLUDED.content,
      version = EXCLUDED.version,
      updated_by = EXCLUDED.updated_by,
      author_display_name = EXCLUDED.author_display_name,
      author_pseudonymized_at = NULL,
      updated_at = now()
  RETURNING * INTO v_saved_note;

  INSERT INTO team_workspace_note_revisions (
    team_id,
    version,
    content,
    author_id,
    author_display_name,
    author_pseudonymized_at,
    created_at
  ) VALUES (
    p_team,
    v_next_version,
    p_content,
    p_actor,
    p_author_display_name,
    NULL,
    now()
  )
  RETURNING * INTO v_saved_revision;

  RETURN jsonb_build_object(
    'note', to_jsonb(v_saved_note),
    'revision', to_jsonb(v_saved_revision)
  );
END;
$$;

REVOKE ALL ON FUNCTION save_team_workspace_note(UUID, UUID, TEXT, INTEGER, VARCHAR(120)) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_team_workspace_note(UUID, UUID, TEXT, INTEGER, VARCHAR(120)) TO service_role;

COMMENT ON FUNCTION save_team_workspace_note(UUID, UUID, TEXT, INTEGER, VARCHAR(120)) IS
  'US-023: atomic optimistic save for locked team shared concept note and revision history (FR-070).';

-- ---------------------------------------------------------------------------
-- 6. Atomic external links replacement function (US-023 / FR-069)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION replace_team_workspace_links(
  p_actor UUID,
  p_team UUID,
  p_links JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_link RECORD;
  v_count INTEGER := 0;
BEGIN
  IF p_actor IS NULL OR p_team IS NULL OR p_links IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_team
  FROM teams
  WHERE id = p_team;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.owner_participant_id <> p_actor THEN
    RAISE EXCEPTION 'FORBIDDEN_WORKSPACE_LINKS_OWNER_ONLY' USING ERRCODE = 'P0001';
  END IF;

  IF v_team.recruitment_status <> 'Locked' OR v_team.locked_at IS NULL THEN
    RAISE EXCEPTION 'WORKSPACE_TEAM_NOT_LOCKED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('recruitmentStatus', v_team.recruitment_status)::text;
  END IF;

  INSERT INTO team_workspaces (team_id, created_at, updated_at)
  VALUES (p_team, now(), now())
  ON CONFLICT (team_id) DO UPDATE SET updated_at = now();

  DELETE FROM team_workspace_links WHERE team_id = p_team;

  IF jsonb_typeof(p_links) = 'array' THEN
    FOR v_link IN SELECT * FROM jsonb_to_recordset(p_links) AS x(label TEXT, url TEXT, display_order INTEGER)
    LOOP
      INSERT INTO team_workspace_links (
        team_id,
        label,
        url,
        display_order,
        updated_by,
        created_at,
        updated_at
      ) VALUES (
        p_team,
        v_link.label,
        v_link.url,
        COALESCE(v_link.display_order, v_count),
        p_actor,
        now(),
        now()
      );
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'teamId', p_team,
    'count', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION replace_team_workspace_links(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_team_workspace_links(UUID, UUID, JSONB) TO service_role;

COMMENT ON FUNCTION replace_team_workspace_links(UUID, UUID, JSONB) IS
  'US-023: atomic owner replacement of external tool links for locked teams (FR-069).';
