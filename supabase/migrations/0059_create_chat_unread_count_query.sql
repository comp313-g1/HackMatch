-- Migration: 0059_create_chat_unread_count_query.sql
-- Description: US-034 / #399 — service-role-only, set-based unread counts for
-- every channel and direct-message thread the requesting participant may read.
-- Uses the durable 0058 (created_at, message id) cursors and existing message
-- indexes; it adds no tables, columns, policies, or indexes.
--
-- Semantics:
--   * no cursor means every message from another participant is unread;
--   * a cursor means messages strictly after its deterministic tuple are unread;
--   * a participant's own messages are already known/read and are not counted;
--   * public channels are available to an eligible PART;
--   * team channels require a current Confirmed membership;
--   * DM threads require the participant to be one of the persisted pair;
--   * missing conversations and cursors for lost access never enter the result.
--
-- General notification read_at state remains separate from chat read cursors.

CREATE OR REPLACE FUNCTION get_participant_chat_unread_counts(
  p_participant UUID
) RETURNS TABLE (
  conversation_type TEXT,
  conversation_id UUID,
  unread_count BIGINT
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
    SELECT c.id AS channel_id, p.id AS participant_id
    FROM eligible_participant p
    JOIN chat_channels c ON TRUE
    WHERE c.channel_type = 'public'
       OR (
         c.channel_type = 'team'
         AND c.team_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM team_memberships tm
           WHERE tm.team_id = c.team_id
             AND tm.participant_id = p.id
             AND tm.status = 'Confirmed'
         )
       )
  ),
  channel_counts AS (
    SELECT
      'channel'::TEXT AS conversation_type,
      ac.channel_id AS conversation_id,
      COUNT(m.id) FILTER (
        WHERE m.author_id <> ac.participant_id
          AND (
            cursor.participant_id IS NULL
            OR (m.created_at, m.id) > (
              cursor.last_read_message_created_at,
              cursor.last_read_message_id
            )
          )
      )::BIGINT AS unread_count
    FROM authorized_channels ac
    LEFT JOIN chat_channel_read_cursors cursor
      ON cursor.participant_id = ac.participant_id
     AND cursor.channel_id = ac.channel_id
    LEFT JOIN chat_messages m
      ON m.channel_id = ac.channel_id
    GROUP BY ac.channel_id
  ),
  authorized_direct_threads AS (
    SELECT t.id AS thread_id, p.id AS participant_id
    FROM eligible_participant p
    JOIN direct_message_threads t
      ON p.id IN (t.participant_low_id, t.participant_high_id)
  ),
  direct_message_counts AS (
    SELECT
      'direct_message'::TEXT AS conversation_type,
      adt.thread_id AS conversation_id,
      COUNT(m.id) FILTER (
        WHERE m.author_id <> adt.participant_id
          AND (
            cursor.participant_id IS NULL
            OR (m.created_at, m.id) > (
              cursor.last_read_message_created_at,
              cursor.last_read_message_id
            )
          )
      )::BIGINT AS unread_count
    FROM authorized_direct_threads adt
    LEFT JOIN direct_message_read_cursors cursor
      ON cursor.participant_id = adt.participant_id
     AND cursor.thread_id = adt.thread_id
    LEFT JOIN direct_messages m
      ON m.thread_id = adt.thread_id
    GROUP BY adt.thread_id
  )
  SELECT * FROM channel_counts
  UNION ALL
  SELECT * FROM direct_message_counts
  ORDER BY conversation_type, conversation_id;
$$;

REVOKE ALL ON FUNCTION get_participant_chat_unread_counts(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_participant_chat_unread_counts(UUID)
  TO service_role;

COMMENT ON FUNCTION get_participant_chat_unread_counts(UUID) IS
  'US-034 / #399: privacy-filtered channel and DM unread counts using durable deterministic read cursors; service role only.';
