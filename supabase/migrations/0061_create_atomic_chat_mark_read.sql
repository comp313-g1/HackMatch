-- Migration: 0061_create_atomic_chat_mark_read.sql
-- Description: US-034 / #401 — atomically and monotonically advance one
-- participant's channel/team-chat or direct-message read cursor, then return
-- fresh unread-message and unread-mention counts derived from durable state.
--
-- The requested read position is a concrete message the client actually saw.
-- Cursor order is the canonical (created_at, id) tuple from migration 0058.
-- INSERT ... ON CONFLICT locks the one participant/conversation cursor row and
-- updates it only when EXCLUDED is newer, preventing a concurrent stale request
-- from moving the cursor backward. Mention history from 0060 is preserved;
-- unread mentions are derived by comparing their messages with the same cursor.
--
-- Access: both functions are service-role-only. General notification read_at
-- state remains separate and unchanged.

-- ---------------------------------------------------------------------------
-- 1. Refresh-safe unread message + mention counts for every accessible chat
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_participant_chat_activity_counts(
  p_participant UUID
) RETURNS TABLE (
  conversation_type TEXT,
  conversation_id UUID,
  unread_count BIGINT,
  unread_mention_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible_participant AS MATERIALIZED (
    SELECT id
    FROM participants
    WHERE id = p_participant
      AND role = 'PART'
      AND is_verified = TRUE
      AND is_suspended = FALSE
      AND is_deactivated = FALSE
  ),
  authorized_channels AS (
    SELECT channel.id AS channel_id, participant.id AS participant_id
    FROM eligible_participant AS participant
    JOIN chat_channels AS channel ON TRUE
    WHERE channel.channel_type = 'public'
       OR (
         channel.channel_type = 'team'
         AND channel.team_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM team_memberships AS membership
           WHERE membership.team_id = channel.team_id
             AND membership.participant_id = participant.id
             AND membership.status = 'Confirmed'
         )
       )
  ),
  channel_counts AS (
    SELECT
      'channel'::TEXT AS conversation_type,
      authorized.channel_id AS conversation_id,
      COUNT(message.id) FILTER (
        WHERE message.author_id <> authorized.participant_id
          AND (
            cursor.participant_id IS NULL
            OR (message.created_at, message.id) > (
              cursor.last_read_message_created_at,
              cursor.last_read_message_id
            )
          )
      )::BIGINT AS unread_count,
      COUNT(mention.message_id) FILTER (
        WHERE cursor.participant_id IS NULL
           OR (message.created_at, message.id) > (
             cursor.last_read_message_created_at,
             cursor.last_read_message_id
           )
      )::BIGINT AS unread_mention_count
    FROM authorized_channels AS authorized
    LEFT JOIN chat_channel_read_cursors AS cursor
      ON cursor.participant_id = authorized.participant_id
     AND cursor.channel_id = authorized.channel_id
    LEFT JOIN chat_messages AS message
      ON message.channel_id = authorized.channel_id
    LEFT JOIN chat_message_mentions AS mention
      ON mention.message_id = message.id
     AND mention.mentioned_participant_id = authorized.participant_id
    GROUP BY authorized.channel_id
  ),
  authorized_direct_threads AS (
    SELECT thread.id AS thread_id, participant.id AS participant_id
    FROM eligible_participant AS participant
    JOIN direct_message_threads AS thread
      ON participant.id IN (
        thread.participant_low_id,
        thread.participant_high_id
      )
  ),
  direct_message_counts AS (
    SELECT
      'direct_message'::TEXT AS conversation_type,
      authorized.thread_id AS conversation_id,
      COUNT(message.id) FILTER (
        WHERE message.author_id <> authorized.participant_id
          AND (
            cursor.participant_id IS NULL
            OR (message.created_at, message.id) > (
              cursor.last_read_message_created_at,
              cursor.last_read_message_id
            )
          )
      )::BIGINT AS unread_count,
      COUNT(mention.message_id) FILTER (
        WHERE cursor.participant_id IS NULL
           OR (message.created_at, message.id) > (
             cursor.last_read_message_created_at,
             cursor.last_read_message_id
           )
      )::BIGINT AS unread_mention_count
    FROM authorized_direct_threads AS authorized
    LEFT JOIN direct_message_read_cursors AS cursor
      ON cursor.participant_id = authorized.participant_id
     AND cursor.thread_id = authorized.thread_id
    LEFT JOIN direct_messages AS message
      ON message.thread_id = authorized.thread_id
    LEFT JOIN direct_message_mentions AS mention
      ON mention.message_id = message.id
     AND mention.mentioned_participant_id = authorized.participant_id
    GROUP BY authorized.thread_id
  )
  SELECT * FROM channel_counts
  UNION ALL
  SELECT * FROM direct_message_counts
  ORDER BY conversation_type, conversation_id;
$$;

REVOKE ALL ON FUNCTION get_participant_chat_activity_counts(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_participant_chat_activity_counts(UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. One atomic mark-read operation for channel and direct-message scopes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mark_chat_conversation_read(
  p_participant UUID,
  p_conversation_type TEXT,
  p_conversation UUID,
  p_message UUID
) RETURNS TABLE (
  conversation_type TEXT,
  conversation_id UUID,
  last_read_message_id UUID,
  last_read_message_created_at TIMESTAMPTZ,
  advanced BOOLEAN,
  unread_count BIGINT,
  unread_mention_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel_type VARCHAR(10);
  v_team_id UUID;
  v_low UUID;
  v_high UUID;
  v_target_created_at TIMESTAMPTZ;
  v_cursor_message_id UUID;
  v_cursor_created_at TIMESTAMPTZ;
  v_rows_changed INTEGER := 0;
  v_unread_count BIGINT := 0;
  v_unread_mention_count BIGINT := 0;
BEGIN
  IF p_participant IS NULL
     OR p_conversation IS NULL
     OR p_message IS NULL
     OR p_conversation_type NOT IN ('channel', 'direct_message') THEN
    RAISE EXCEPTION 'CHAT_MARK_READ_VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = 'Participant, supported conversation type, conversation, and message are required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM participants
    WHERE id = p_participant
      AND role = 'PART'
      AND is_verified = TRUE
      AND is_suspended = FALSE
      AND is_deactivated = FALSE
  ) THEN
    RAISE EXCEPTION 'CHAT_MARK_READ_NOT_ELIGIBLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Only a verified active participant may advance chat read state.';
  END IF;

  IF p_conversation_type = 'channel' THEN
    -- Authorize the conversation before resolving the requested message.
    SELECT channel_type, team_id
    INTO v_channel_type, v_team_id
    FROM chat_channels
    WHERE id = p_conversation;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CHAT_MARK_READ_CHANNEL_NOT_FOUND'
        USING ERRCODE = 'P0001',
              DETAIL = 'The selected chat conversation is unavailable.';
    END IF;

    IF v_channel_type = 'team' AND NOT EXISTS (
      SELECT 1
      FROM team_memberships
      WHERE team_id = v_team_id
        AND participant_id = p_participant
        AND status = 'Confirmed'
    ) THEN
      RAISE EXCEPTION 'CHAT_MARK_READ_TEAM_ACCESS_DENIED'
        USING ERRCODE = 'P0001',
              DETAIL = 'The participant cannot access this team conversation.';
    END IF;

    SELECT created_at
    INTO v_target_created_at
    FROM chat_messages
    WHERE id = p_message
      AND channel_id = p_conversation;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CHAT_MARK_READ_POSITION_NOT_FOUND'
        USING ERRCODE = 'P0001',
              DETAIL = 'The requested read position is unavailable.';
    END IF;

    INSERT INTO chat_channel_read_cursors (
      participant_id,
      channel_id,
      last_read_message_id,
      last_read_message_created_at
    ) VALUES (
      p_participant,
      p_conversation,
      p_message,
      v_target_created_at
    )
    ON CONFLICT (participant_id, channel_id) DO UPDATE
    SET last_read_message_id = EXCLUDED.last_read_message_id,
        last_read_message_created_at = EXCLUDED.last_read_message_created_at
    WHERE (
      chat_channel_read_cursors.last_read_message_created_at,
      chat_channel_read_cursors.last_read_message_id
    ) < (
      EXCLUDED.last_read_message_created_at,
      EXCLUDED.last_read_message_id
    );
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

    SELECT cursor.last_read_message_id, cursor.last_read_message_created_at
    INTO v_cursor_message_id, v_cursor_created_at
    FROM chat_channel_read_cursors AS cursor
    WHERE cursor.participant_id = p_participant
      AND cursor.channel_id = p_conversation;
  ELSE
    -- Missing and unrelated DM threads intentionally share one denial.
    SELECT participant_low_id, participant_high_id
    INTO v_low, v_high
    FROM direct_message_threads
    WHERE id = p_conversation;

    IF NOT FOUND OR p_participant NOT IN (v_low, v_high) THEN
      RAISE EXCEPTION 'CHAT_MARK_READ_DM_ACCESS_DENIED'
        USING ERRCODE = 'P0001',
              DETAIL = 'The participant cannot access this direct-message conversation.';
    END IF;

    SELECT created_at
    INTO v_target_created_at
    FROM direct_messages
    WHERE id = p_message
      AND thread_id = p_conversation;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CHAT_MARK_READ_POSITION_NOT_FOUND'
        USING ERRCODE = 'P0001',
              DETAIL = 'The requested read position is unavailable.';
    END IF;

    INSERT INTO direct_message_read_cursors (
      participant_id,
      thread_id,
      last_read_message_id,
      last_read_message_created_at
    ) VALUES (
      p_participant,
      p_conversation,
      p_message,
      v_target_created_at
    )
    ON CONFLICT (participant_id, thread_id) DO UPDATE
    SET last_read_message_id = EXCLUDED.last_read_message_id,
        last_read_message_created_at = EXCLUDED.last_read_message_created_at
    WHERE (
      direct_message_read_cursors.last_read_message_created_at,
      direct_message_read_cursors.last_read_message_id
    ) < (
      EXCLUDED.last_read_message_created_at,
      EXCLUDED.last_read_message_id
    );
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

    SELECT cursor.last_read_message_id, cursor.last_read_message_created_at
    INTO v_cursor_message_id, v_cursor_created_at
    FROM direct_message_read_cursors AS cursor
    WHERE cursor.participant_id = p_participant
      AND cursor.thread_id = p_conversation;
  END IF;

  SELECT activity.unread_count, activity.unread_mention_count
  INTO v_unread_count, v_unread_mention_count
  FROM get_participant_chat_activity_counts(p_participant) AS activity
  WHERE activity.conversation_type = p_conversation_type
    AND activity.conversation_id = p_conversation;

  IF NOT FOUND THEN
    -- Access changed during the operation. The transaction rolls back the cursor.
    RAISE EXCEPTION 'CHAT_MARK_READ_ACCESS_CHANGED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Conversation access changed while read state was being advanced.';
  END IF;

  RETURN QUERY SELECT
    p_conversation_type,
    p_conversation,
    v_cursor_message_id,
    v_cursor_created_at,
    v_rows_changed > 0,
    v_unread_count,
    v_unread_mention_count;
END;
$$;

REVOKE ALL ON FUNCTION mark_chat_conversation_read(UUID, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_chat_conversation_read(UUID, TEXT, UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION get_participant_chat_activity_counts(UUID) IS
  'US-034 / #401: refresh-safe unread message and mention counts for authorized channel/team/DM conversations.';

COMMENT ON FUNCTION mark_chat_conversation_read(UUID, TEXT, UUID, UUID) IS
  'US-034 / #401: service-role-only atomic monotonic read-cursor advancement with fresh unread message and mention counts.';
