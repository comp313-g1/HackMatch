-- Migration: 0062_create_demo_team_chat_reset.sql
-- Description: #437 — lets the operator-only demo tool (db-seed) re-seed and reset the
-- `recruitment-v1` demo scenario now that its teams have private team chat.
--
-- Why this is needed: migration 0052 deliberately makes team chat history permanent
-- (messages and team channels cannot be deleted, and membership rows of a team that has a
-- channel cannot be deleted). That is right for real teams, but it also stops the demo tool
-- from deleting and recreating its own demo teams. Those protections are NOT weakened here.
-- Instead this adds ONE narrowly-guarded function that removes the team chat of DEMO teams only.
--
-- Guards
--   * Every team passed in must be owned by a demo account (firebase_uid starts with
--     'hm-demo-v1-'); if any is not, nothing is removed and the call fails.
--   * Only 'team' channels linked to the passed team ids are touched. Public forums, other
--     teams and direct messages are never touched.
--   * The two history triggers are disabled only inside this function's own transaction, so
--     they are re-enabled automatically when it finishes (or if it fails part-way).
--   * Executable by the service role only (the Express/db-seed service key); not by anon or
--     authenticated users.
-- Additive and idempotent.

CREATE OR REPLACE FUNCTION demo_remove_team_chat(p_team_ids UUID[])
RETURNS TABLE (channels_removed INTEGER, messages_removed INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel_ids UUID[];
  v_messages    INTEGER := 0;
  v_channels    INTEGER := 0;
BEGIN
  IF p_team_ids IS NULL OR cardinality(p_team_ids) = 0 THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM teams t
    JOIN participants p ON p.id = t.owner_participant_id
    WHERE t.id = ANY (p_team_ids)
      AND p.firebase_uid NOT LIKE 'hm-demo-v1-%'
  ) THEN
    RAISE EXCEPTION 'DEMO_CHAT_RESET_NOT_DEMO_TEAM'
      USING ERRCODE = 'P0001',
            DETAIL = 'Team chat can only be removed for teams owned by demo accounts.';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_channel_ids
  FROM chat_channels
  WHERE channel_type = 'team' AND team_id = ANY (p_team_ids);

  IF cardinality(v_channel_ids) = 0 THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  ALTER TABLE chat_messages DISABLE TRIGGER trigger_chat_messages_protect_team_history;
  ALTER TABLE chat_channels DISABLE TRIGGER trigger_chat_channels_protect_team_deletion;

  DELETE FROM chat_messages WHERE channel_id = ANY (v_channel_ids);
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM chat_channels WHERE id = ANY (v_channel_ids);
  GET DIAGNOSTICS v_channels = ROW_COUNT;

  ALTER TABLE chat_messages ENABLE TRIGGER trigger_chat_messages_protect_team_history;
  ALTER TABLE chat_channels ENABLE TRIGGER trigger_chat_channels_protect_team_deletion;

  RETURN QUERY SELECT v_channels, v_messages;
END;
$$;

REVOKE ALL ON FUNCTION demo_remove_team_chat(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION demo_remove_team_chat(UUID[])
  TO service_role;

COMMENT ON FUNCTION demo_remove_team_chat(UUID[]) IS
  '#437: operator-only demo reset. Removes the private team channel and messages of DEMO-owned teams (firebase_uid hm-demo-v1-*) so the demo scenario can be re-seeded; refuses any other team.';
