-- Migration: 0051_add_team_channel_linkage_to_chat_channels.sql
-- Description: US-031 / #378 / FR-090 — adds the data model for private team chat
-- channels on top of the US-030 chat tables (0041): a channel can be tied to exactly one
-- existing team. Provisioning, authorization, endpoints and lifecycle rules ship in
-- later US-031 tasks; this migration only adds the linkage, its deterministic rules and
-- the lookup indexes.
--
-- Rules enforced here (all in the database, so no code path can bypass them):
--   * channel_type is 'public' (US-030 forums, unchanged) or 'team' (private team channel).
--   * A 'team' channel MUST have a team_id; a 'public' channel MUST NOT have one.
--   * team_id references teams(id) ON DELETE RESTRICT: a team that has a channel cannot
--     be deleted, so the channel and its message history can never be orphaned or
--     cascaded away. Team lifecycle (Open/Locked/Disbanded) is a status change and does
--     not touch the channel.
--   * At most ONE channel per team (partial unique index); it doubles as the team lookup.
--   * Once set, channel_type and team_id never change (no re-pointing a channel to another
--     team, no converting a public forum into a team channel or back).
-- Existing rows become 'public' through the column default, so US-030 channels, their
-- messages and every existing query keep working unchanged. Additive and idempotent.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS channel_type VARCHAR(10) NOT NULL DEFAULT 'public';

ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS team_id UUID NULL REFERENCES teams(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 2. Deterministic constraints
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_chat_channels_channel_type'
      AND conrelid = 'chat_channels'::regclass
  ) THEN
    ALTER TABLE chat_channels
      ADD CONSTRAINT chk_chat_channels_channel_type
      CHECK (channel_type IN ('public', 'team'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_chat_channels_team_linkage'
      AND conrelid = 'chat_channels'::regclass
  ) THEN
    ALTER TABLE chat_channels
      ADD CONSTRAINT chk_chat_channels_team_linkage
      CHECK (
        (channel_type = 'team' AND team_id IS NOT NULL)
        OR (channel_type = 'public' AND team_id IS NULL)
      );
  END IF;
END
$$;

-- The linkage is permanent once a channel exists.
CREATE OR REPLACE FUNCTION prevent_chat_channel_relinking()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.channel_type IS DISTINCT FROM OLD.channel_type
     OR NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    RAISE EXCEPTION 'CHAT_CHANNEL_LINKAGE_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'channel_type and team_id cannot be changed once a chat channel exists.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chat_channels_prevent_relinking ON chat_channels;
CREATE TRIGGER trigger_chat_channels_prevent_relinking
  BEFORE UPDATE OF channel_type, team_id ON chat_channels
  FOR EACH ROW
  EXECUTE FUNCTION prevent_chat_channel_relinking();

-- ---------------------------------------------------------------------------
-- 3. Lookup indexes
-- ---------------------------------------------------------------------------

-- One private channel per team, and the lookup "which channel belongs to this team?".
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_channels_team_id
  ON chat_channels(team_id)
  WHERE team_id IS NOT NULL;

-- The public forum listing (newest first) only ever reads public channels.
CREATE INDEX IF NOT EXISTS idx_chat_channels_public_created_at
  ON chat_channels(created_at DESC)
  WHERE channel_type = 'public';

-- ---------------------------------------------------------------------------
-- 4. Documentation
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN chat_channels.channel_type IS
  'US-031 / #378: public = US-030 platform forum; team = private channel for one team (requires team_id).';

COMMENT ON COLUMN chat_channels.team_id IS
  'US-031 / #378: the team a private channel belongs to. Unique, ON DELETE RESTRICT, immutable once set; NULL for public channels.';
