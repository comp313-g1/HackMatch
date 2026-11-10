-- Migration: 0052_enforce_team_channel_lifecycle.sql
-- Description: US-031 / #382 / FR-090 — lifecycle rules for private team channel history,
-- enforced in the database so no code path (including a race between the API's membership
-- check and the insert) can bypass them.
--
-- Rules
--   WRITES to a team channel are accepted only while ALL of these hold at insert time:
--     * the author has a Confirmed membership of that team
--       (Removed / Released / left members can no longer write);
--     * the team is not Disbanded (a disbanded team's channel is read-only history);
--     * the author's account is not suspended.
--   Open and Locked teams keep chatting: locking only stops recruitment.
--   HISTORY is never lost:
--     * messages of a team channel cannot be deleted or edited (no UPDATE of body/author);
--     * a team channel cannot be deleted (so its messages are never cascaded away);
--     * membership rows of a team that has a channel cannot be deleted, so "who was a
--       member" stays reconstructable — leaving/removal/disband only change `status`.
--   Public (US-030) channels and messages are untouched by every rule here.
-- Additive and idempotent. Error messages start with a stable code the API maps to 403.

-- ---------------------------------------------------------------------------
-- 1. Writes: only active confirmed members of a live team
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_team_channel_message_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_team_id UUID;
  v_status  VARCHAR(20);
BEGIN
  SELECT team_id INTO v_team_id
  FROM chat_channels
  WHERE id = NEW.channel_id AND channel_type = 'team';

  IF v_team_id IS NULL THEN
    RETURN NEW; -- public channel: US-030 behavior unchanged
  END IF;

  SELECT recruitment_status INTO v_status FROM teams WHERE id = v_team_id;
  IF v_status IS NULL OR v_status = 'Disbanded' THEN
    RAISE EXCEPTION 'TEAM_CHANNEL_READ_ONLY'
      USING ERRCODE = 'P0001',
            DETAIL = 'The team is disbanded; its channel history is read-only.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_id = v_team_id AND participant_id = NEW.author_id AND status = 'Confirmed'
  ) THEN
    RAISE EXCEPTION 'TEAM_CHANNEL_NOT_A_MEMBER'
      USING ERRCODE = 'P0001',
            DETAIL = 'Only confirmed team members can write to the team channel.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM participants WHERE id = NEW.author_id AND is_suspended = TRUE
  ) THEN
    RAISE EXCEPTION 'TEAM_CHANNEL_ACCOUNT_SUSPENDED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Suspended accounts cannot write to the team channel.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chat_messages_guard_team_insert ON chat_messages;
CREATE TRIGGER trigger_chat_messages_guard_team_insert
  BEFORE INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION guard_team_channel_message_insert();

-- ---------------------------------------------------------------------------
-- 2. History: team channel messages and channels are never deleted or rewritten
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION protect_team_channel_message_history()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM chat_channels WHERE id = OLD.channel_id AND channel_type = 'team'
  ) THEN
    IF TG_OP = 'UPDATE'
       AND NEW.channel_id = OLD.channel_id
       AND NEW.author_id = OLD.author_id
       AND NEW.body = OLD.body
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW; -- no-op update
    END IF;
    RAISE EXCEPTION 'TEAM_CHANNEL_HISTORY_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Team channel messages cannot be deleted or changed.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chat_messages_protect_team_history ON chat_messages;
CREATE TRIGGER trigger_chat_messages_protect_team_history
  BEFORE UPDATE OR DELETE ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION protect_team_channel_message_history();

CREATE OR REPLACE FUNCTION protect_team_channel_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.channel_type = 'team' THEN
    RAISE EXCEPTION 'TEAM_CHANNEL_HISTORY_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'A team channel and its history cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chat_channels_protect_team_deletion ON chat_channels;
CREATE TRIGGER trigger_chat_channels_protect_team_deletion
  BEFORE DELETE ON chat_channels
  FOR EACH ROW
  EXECUTE FUNCTION protect_team_channel_deletion();

-- ---------------------------------------------------------------------------
-- 3. Membership integrity: rows of a team with a channel are never deleted
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION protect_team_membership_rows_with_channel()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM chat_channels WHERE team_id = OLD.team_id) THEN
    RAISE EXCEPTION 'TEAM_MEMBERSHIP_HISTORY_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Membership rows of a team with a private channel cannot be deleted; change status instead.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_team_memberships_protect_channel_history ON team_memberships;
CREATE TRIGGER trigger_team_memberships_protect_channel_history
  BEFORE DELETE ON team_memberships
  FOR EACH ROW
  EXECUTE FUNCTION protect_team_membership_rows_with_channel();
