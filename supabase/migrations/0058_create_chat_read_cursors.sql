-- Migration: 0058_create_chat_read_cursors.sql
-- Description: US-034 / #398 — durable per-participant read positions for
-- channel conversations (US-030 public forums and US-031 team chat) and
-- US-032 direct-message threads.
--
-- Channel and direct-message conversations use different root/message tables,
-- so separate cursor tables retain ordinary foreign keys instead of an unsafe
-- polymorphic conversation reference. A cursor stores the exact deterministic
-- message position (created_at, id); a trigger derives created_at from the
-- referenced message and rejects a message from another conversation.
--
-- The last-read message id intentionally is not a physical foreign key. The
-- trigger validates it when a cursor is written, while retaining the stable
-- ordering value if a public message is later removed. Conversation access is
-- still authorized by the existing chat services; #401 will provide the
-- authorized atomic mark-read operation.
--
-- Access: RLS enabled with zero public policies (Express service role only).
-- Existing notification read_at state remains separate and unchanged.

-- ---------------------------------------------------------------------------
-- 1. Channel/forum and private-team-channel read positions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_channel_read_cursors (
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  last_read_message_id UUID NOT NULL,
  last_read_message_created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_chat_channel_read_cursors PRIMARY KEY (participant_id, channel_id)
);

ALTER TABLE chat_channel_read_cursors ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION validate_chat_channel_read_cursor()
RETURNS TRIGGER AS $$
DECLARE
  v_created_at TIMESTAMPTZ;
  v_channel_type VARCHAR(10);
  v_team_id UUID;
BEGIN
  SELECT channel_type, team_id INTO v_channel_type, v_team_id
  FROM chat_channels
  WHERE id = NEW.channel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAT_READ_CURSOR_CHANNEL_NOT_FOUND'
      USING ERRCODE = 'P0001',
            DETAIL = 'The selected chat channel does not exist.';
  END IF;

  -- The stable database relationship can enforce the US-031 membership
  -- boundary. Account/session eligibility and public-forum authorization stay
  -- in the existing services and the future #401 atomic mark-read operation.
  IF v_channel_type = 'team' AND NOT EXISTS (
    SELECT 1
    FROM team_memberships
    WHERE team_id = v_team_id
      AND participant_id = NEW.participant_id
      AND status = 'Confirmed'
  ) THEN
    RAISE EXCEPTION 'CHAT_READ_CURSOR_NOT_TEAM_MEMBER'
      USING ERRCODE = 'P0001',
            DETAIL = 'Only a confirmed team member may store this team-channel read position.';
  END IF;

  SELECT created_at INTO v_created_at
  FROM chat_messages
  WHERE id = NEW.last_read_message_id
    AND channel_id = NEW.channel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAT_READ_CURSOR_MESSAGE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = 'The read position must reference a message in the selected channel.';
  END IF;

  -- The database owns this half of the deterministic (created_at, id) cursor.
  NEW.last_read_message_created_at := v_created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chat_channel_read_cursors_validate
  ON chat_channel_read_cursors;
CREATE TRIGGER trigger_chat_channel_read_cursors_validate
  BEFORE INSERT OR UPDATE ON chat_channel_read_cursors
  FOR EACH ROW
  EXECUTE FUNCTION validate_chat_channel_read_cursor();

DROP TRIGGER IF EXISTS trigger_chat_channel_read_cursors_updated_at
  ON chat_channel_read_cursors;
CREATE TRIGGER trigger_chat_channel_read_cursors_updated_at
  BEFORE UPDATE ON chat_channel_read_cursors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- PK serves participant + channel lookup. Reverse order supports FK cleanup and
-- future conversation-centric cursor work without scanning every participant.
CREATE INDEX IF NOT EXISTS idx_chat_channel_read_cursors_channel
  ON chat_channel_read_cursors(channel_id, participant_id);

-- 0041 indexed (channel_id, created_at); the UUID tie-breaker makes unread
-- ranges deterministic when two messages share a timestamp.
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created_id
  ON chat_messages(channel_id, created_at ASC, id ASC);

-- ---------------------------------------------------------------------------
-- 2. One-to-one direct-message thread read positions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS direct_message_read_cursors (
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES direct_message_threads(id) ON DELETE CASCADE,
  last_read_message_id UUID NOT NULL,
  last_read_message_created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_direct_message_read_cursors PRIMARY KEY (participant_id, thread_id)
);

ALTER TABLE direct_message_read_cursors ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION validate_direct_message_read_cursor()
RETURNS TRIGGER AS $$
DECLARE
  v_created_at TIMESTAMPTZ;
  v_participant_low UUID;
  v_participant_high UUID;
BEGIN
  SELECT participant_low_id, participant_high_id
  INTO v_participant_low, v_participant_high
  FROM direct_message_threads
  WHERE id = NEW.thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIRECT_MESSAGE_READ_CURSOR_THREAD_NOT_FOUND'
      USING ERRCODE = 'P0001',
            DETAIL = 'The selected direct-message thread does not exist.';
  END IF;

  IF NEW.participant_id NOT IN (v_participant_low, v_participant_high) THEN
    RAISE EXCEPTION 'DIRECT_MESSAGE_READ_CURSOR_NOT_PARTICIPANT'
      USING ERRCODE = 'P0001',
            DETAIL = 'Only a participant in the direct-message thread may store its read position.';
  END IF;

  SELECT created_at INTO v_created_at
  FROM direct_messages
  WHERE id = NEW.last_read_message_id
    AND thread_id = NEW.thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIRECT_MESSAGE_READ_CURSOR_MESSAGE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = 'The read position must reference a message in the selected direct-message thread.';
  END IF;

  NEW.last_read_message_created_at := v_created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_direct_message_read_cursors_validate
  ON direct_message_read_cursors;
CREATE TRIGGER trigger_direct_message_read_cursors_validate
  BEFORE INSERT OR UPDATE ON direct_message_read_cursors
  FOR EACH ROW
  EXECUTE FUNCTION validate_direct_message_read_cursor();

DROP TRIGGER IF EXISTS trigger_direct_message_read_cursors_updated_at
  ON direct_message_read_cursors;
CREATE TRIGGER trigger_direct_message_read_cursors_updated_at
  BEFORE UPDATE ON direct_message_read_cursors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_direct_message_read_cursors_thread
  ON direct_message_read_cursors(thread_id, participant_id);

-- 0055 already provides idx_direct_messages_thread_created_id on
-- (thread_id, created_at, id), so no duplicate DM message index is needed.

-- ---------------------------------------------------------------------------
-- 3. Documentation
-- ---------------------------------------------------------------------------

COMMENT ON TABLE chat_channel_read_cursors IS
  'US-034 / #398: one durable deterministic read position per participant and public/team chat channel.';

COMMENT ON TABLE direct_message_read_cursors IS
  'US-034 / #398: one durable deterministic read position per participant and direct-message thread.';

COMMENT ON COLUMN chat_channel_read_cursors.last_read_message_created_at IS
  'Database-derived created_at half of the deterministic (created_at, message id) channel cursor.';

COMMENT ON COLUMN direct_message_read_cursors.last_read_message_created_at IS
  'Database-derived created_at half of the deterministic (created_at, message id) direct-message cursor.';
