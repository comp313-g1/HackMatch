-- Migration: 0060_create_chat_message_mentions.sql
-- Description: US-034 / #400 — deterministic, durable @handle mention
-- metadata for channel/team-chat messages and one-to-one direct messages.
--
-- The canonical profile handle grammar is [A-Za-z0-9_-]{2,50}. Handles are
-- resolved case-insensitively when a message is inserted, but mention rows keep
-- only the stable participant id. A later rename therefore cannot transfer an
-- historical mention to the new owner of the old handle.
--
-- Invalid, unavailable, hidden, or conversation-ineligible handles remain
-- ordinary message text. The write never reveals whether such an account
-- exists. AFTER INSERT triggers keep the message and its mention rows in the
-- same transaction. Existing messages are intentionally not reinterpreted or
-- backfilled against today's handle ownership.
--
-- Access: RLS enabled with zero public policies (Express service role only).
-- General participant_notifications rows remain separate and unchanged.

-- ---------------------------------------------------------------------------
-- 1. Stable mention relations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_message_mentions (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  mentioned_participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_chat_message_mentions
    PRIMARY KEY (message_id, mentioned_participant_id)
);

CREATE TABLE IF NOT EXISTS direct_message_mentions (
  message_id UUID NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  mentioned_participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_direct_message_mentions
    PRIMARY KEY (message_id, mentioned_participant_id)
);

ALTER TABLE chat_message_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_message_mentions ENABLE ROW LEVEL SECURITY;

-- The primary keys serve message -> recipients and enforce one event per
-- message/participant. These reverse indexes serve participant mention badges.
CREATE INDEX IF NOT EXISTS idx_chat_message_mentions_participant_created
  ON chat_message_mentions(mentioned_participant_id, created_at DESC, message_id);

CREATE INDEX IF NOT EXISTS idx_direct_message_mentions_participant_created
  ON direct_message_mentions(mentioned_participant_id, created_at DESC, message_id);

-- ---------------------------------------------------------------------------
-- 2. One approved parser shared by every persisted chat message type
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION extract_chat_mention_handles(p_body TEXT)
RETURNS TABLE (normalized_handle TEXT)
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT DISTINCT LOWER(matches[2]) AS normalized_handle
  FROM regexp_matches(
    p_body,
    '(^|[^A-Za-z0-9_@-])@([A-Za-z0-9_-]{2,50})(?=$|[^A-Za-z0-9_-])',
    'gi'
  ) AS extracted(matches)
  ORDER BY normalized_handle;
$$;

-- ---------------------------------------------------------------------------
-- 3. Public forum and private team-channel mention persistence
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION persist_chat_message_mentions()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO chat_message_mentions (message_id, mentioned_participant_id)
  SELECT NEW.id, profile.participant_id
  FROM extract_chat_mention_handles(NEW.body) AS mention
  JOIN participant_profiles AS profile
    ON LOWER(profile.handle) = mention.normalized_handle
  JOIN participants AS participant
    ON participant.id = profile.participant_id
  JOIN chat_channels AS channel
    ON channel.id = NEW.channel_id
  WHERE profile.participant_id <> NEW.author_id
    AND participant.role = 'PART'
    AND participant.is_verified = TRUE
    AND participant.is_suspended = FALSE
    AND participant.is_deactivated = FALSE
    AND COALESCE(profile.moderation_status, 'None') <> 'Hidden'
    AND (
      channel.channel_type = 'public'
      OR (
        channel.channel_type = 'team'
        AND channel.team_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM team_memberships AS membership
          WHERE membership.team_id = channel.team_id
            AND membership.participant_id = profile.participant_id
            AND membership.status = 'Confirmed'
        )
      )
    )
  ON CONFLICT (message_id, mentioned_participant_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chat_messages_persist_mentions ON chat_messages;
CREATE TRIGGER trigger_chat_messages_persist_mentions
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION persist_chat_message_mentions();

-- ---------------------------------------------------------------------------
-- 4. One-to-one direct-message mention persistence
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION persist_direct_message_mentions()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO direct_message_mentions (message_id, mentioned_participant_id)
  SELECT NEW.id, profile.participant_id
  FROM extract_chat_mention_handles(NEW.body) AS mention
  JOIN participant_profiles AS profile
    ON LOWER(profile.handle) = mention.normalized_handle
  JOIN participants AS participant
    ON participant.id = profile.participant_id
  JOIN direct_message_threads AS thread
    ON thread.id = NEW.thread_id
  WHERE profile.participant_id <> NEW.author_id
    AND profile.participant_id IN (
      thread.participant_low_id,
      thread.participant_high_id
    )
    AND participant.role = 'PART'
    AND participant.is_verified = TRUE
    AND participant.is_suspended = FALSE
    AND participant.is_deactivated = FALSE
    AND COALESCE(profile.moderation_status, 'None') <> 'Hidden'
    AND NOT EXISTS (
      SELECT 1
      FROM participant_blocks AS block
      WHERE (
        block.blocker_id = NEW.author_id
        AND block.blocked_id = profile.participant_id
      ) OR (
        block.blocker_id = profile.participant_id
        AND block.blocked_id = NEW.author_id
      )
    )
  ON CONFLICT (message_id, mentioned_participant_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_direct_messages_persist_mentions ON direct_messages;
CREATE TRIGGER trigger_direct_messages_persist_mentions
  AFTER INSERT ON direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION persist_direct_message_mentions();

-- ---------------------------------------------------------------------------
-- 5. Documentation
-- ---------------------------------------------------------------------------

COMMENT ON TABLE chat_message_mentions IS
  'US-034 / #400: one stable mention event per channel/team message and participant; contains no handle, email, or account snapshot.';

COMMENT ON TABLE direct_message_mentions IS
  'US-034 / #400: one stable mention event per direct message and thread participant; contains no handle, email, or account snapshot.';

COMMENT ON FUNCTION extract_chat_mention_handles(TEXT) IS
  'US-034 / #400: case-normalized parser for canonical @handle tokens using the participant profile handle grammar.';
