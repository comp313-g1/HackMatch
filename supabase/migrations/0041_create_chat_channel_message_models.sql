-- Migration: 0041_create_chat_channel_message_models.sql
-- Description: US-030 / #342 — PostgreSQL models for chat forums/channels and
-- text messages (FR-087, FR-088). Presence, Express routes, React UI, and
-- privacy scrubbing ship in later US-030 tasks.
--
-- Channel contract: title, description, created_by, created_at, updated_at
-- Message contract: channel_id, author_id, body, created_at
-- Access: RLS enabled with zero public policies (Express service role only).

-- ---------------------------------------------------------------------------
-- 1. Chat channels (forums)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  created_by UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_chat_channels_title_nonempty CHECK (
    LENGTH(TRIM(title)) > 0
  ),
  CONSTRAINT chk_chat_channels_description_nonempty CHECK (
    LENGTH(TRIM(description)) > 0
  )
);

ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_chat_channels_created_at
  ON chat_channels(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_channels_created_by
  ON chat_channels(created_by);

DROP TRIGGER IF EXISTS trigger_chat_channels_updated_at ON chat_channels;
CREATE TRIGGER trigger_chat_channels_updated_at
  BEFORE UPDATE ON chat_channels
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE chat_channels IS
  'US-030 / #342: public PART forums/channels with required title and description (FR-087).';

-- ---------------------------------------------------------------------------
-- 2. Chat messages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_chat_messages_body_nonempty CHECK (
    LENGTH(TRIM(body)) > 0
  ),
  CONSTRAINT chk_chat_messages_body_length CHECK (
    LENGTH(body) <= 4000
  )
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created_at
  ON chat_messages(channel_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_author_id
  ON chat_messages(author_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
  ON chat_messages(created_at DESC);

COMMENT ON TABLE chat_messages IS
  'US-030 / #342: text messages in a chat channel (FR-088); author handle resolved via participants/profiles at read time.';
