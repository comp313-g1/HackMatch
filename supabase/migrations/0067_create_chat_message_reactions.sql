-- Migration: 0067_create_chat_message_reactions.sql
-- Description: US-035 / #405 — durable message reactions for public-channel,
-- team-channel, and direct messages, following the approved #404 policy
-- (docs/04_requirements/us035_rich_chat_policy.md, section 4).
--
-- Model
--   * One table per message table, mirroring the 0060 mention tables, so every
--     reaction keeps a real foreign key to its message (no polymorphic ids).
--   * One row per (message, participant, reaction). The composite primary key
--     makes duplicates impossible, serves message aggregate reads (leading
--     message_id), and serves the participant/message mutation check.
--   * Only the eight approved reaction codes are storable.
--   * Rows follow the message and participant lifecycles (ON DELETE CASCADE),
--     exactly like the mention tables.
--
-- Writes go through service-role-only functions that re-check, at write time,
-- the same send rules the API enforces (team membership / read-only team,
-- DM participation, eligibility, and blocks), so a race between the route's
-- guard and the write still cannot produce a reaction. Adds use
-- INSERT ... ON CONFLICT DO NOTHING and removes are plain deletes, so retries
-- and concurrent duplicates converge on one deterministic final state.
--
-- Reactions never touch participant_notifications, chat read cursors, mention
-- rows, message timestamps, or direct_message_threads.last_message_at.
--
-- Access: RLS enabled with zero public policies (Express service role only).

-- ---------------------------------------------------------------------------
-- 1. The approved reaction set (single SQL source of truth)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_approved_chat_reaction(p_reaction TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_reaction IN (
    'thumbs_up', 'heart', 'laugh', 'party', 'surprised', 'sad', 'eyes', 'check'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Reaction relations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_message_reactions (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  reaction VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_chat_message_reactions
    PRIMARY KEY (message_id, participant_id, reaction),
  CONSTRAINT chk_chat_message_reactions_approved
    CHECK (is_approved_chat_reaction(reaction))
);

CREATE TABLE IF NOT EXISTS direct_message_reactions (
  message_id UUID NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  reaction VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_direct_message_reactions
    PRIMARY KEY (message_id, participant_id, reaction),
  CONSTRAINT chk_direct_message_reactions_approved
    CHECK (is_approved_chat_reaction(reaction))
);

ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_message_reactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE chat_message_reactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE direct_message_reactions FROM PUBLIC, anon, authenticated;

-- The primary keys serve message -> aggregate reads. These serve the
-- participant foreign-key cascade without a full scan.
CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_participant
  ON chat_message_reactions(participant_id);

CREATE INDEX IF NOT EXISTS idx_direct_message_reactions_participant
  ON direct_message_reactions(participant_id);

-- ---------------------------------------------------------------------------
-- 3. Public / team channel add-or-remove (idempotent, access re-checked)
-- ---------------------------------------------------------------------------
-- Error messages start with a stable code the API maps to its existing answers:
--   CHAT_REACTION_VALIDATION_ERROR / CHAT_REACTION_INVALID -> 400
--   CHAT_REACTION_NOT_ELIGIBLE                             -> 403
--   CHAT_REACTION_MESSAGE_NOT_FOUND                        -> 404 (same for a random id
--                                                             and a message elsewhere)
--   TEAM_CHANNEL_READ_ONLY / TEAM_CHANNEL_NOT_A_MEMBER     -> existing 0052 team answers

CREATE OR REPLACE FUNCTION set_chat_message_reaction(
  p_participant UUID,
  p_channel UUID,
  p_message UUID,
  p_reaction TEXT,
  p_present BOOLEAN
) RETURNS TABLE (changed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel_type VARCHAR(10);
  v_team_id UUID;
  v_team_status VARCHAR(20);
  v_rows INTEGER;
BEGIN
  IF p_participant IS NULL OR p_channel IS NULL OR p_message IS NULL OR p_present IS NULL THEN
    RAISE EXCEPTION 'CHAT_REACTION_VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(is_approved_chat_reaction(p_reaction), FALSE) THEN
    RAISE EXCEPTION 'CHAT_REACTION_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE id = p_participant
      AND role = 'PART'
      AND is_verified = TRUE
      AND is_suspended = FALSE
      AND is_deactivated = FALSE
  ) THEN
    RAISE EXCEPTION 'CHAT_REACTION_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT channel.channel_type, channel.team_id
  INTO v_channel_type, v_team_id
  FROM chat_messages AS message
  JOIN chat_channels AS channel ON channel.id = message.channel_id
  WHERE message.id = p_message
    AND message.channel_id = p_channel;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAT_REACTION_MESSAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_channel_type = 'team' THEN
    -- Same write rules as 0052 message inserts: a live team and a confirmed member.
    SELECT recruitment_status INTO v_team_status FROM teams WHERE id = v_team_id;
    IF v_team_status IS NULL OR v_team_status = 'Disbanded' THEN
      RAISE EXCEPTION 'TEAM_CHANNEL_READ_ONLY' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_id = v_team_id
        AND participant_id = p_participant
        AND status = 'Confirmed'
    ) THEN
      RAISE EXCEPTION 'TEAM_CHANNEL_NOT_A_MEMBER' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_channel_type IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'CHAT_REACTION_MESSAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_present THEN
    INSERT INTO chat_message_reactions (message_id, participant_id, reaction)
    VALUES (p_message, p_participant, p_reaction)
    ON CONFLICT ON CONSTRAINT pk_chat_message_reactions DO NOTHING;
  ELSE
    DELETE FROM chat_message_reactions
    WHERE message_id = p_message
      AND participant_id = p_participant
      AND reaction = p_reaction;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Direct-message add-or-remove (idempotent, send rules re-checked)
-- ---------------------------------------------------------------------------
-- Codes reuse the existing DM write vocabulary (mapDirectMessageWriteError):
--   DM_NOT_A_PARTICIPANT -> 403 FORBIDDEN_NOT_THREAD_PARTICIPANT (missing or foreign thread)
--   DM_ACCOUNT_SUSPENDED -> 403 DM_ACCOUNT_NOT_ELIGIBLE (the caller)
--   DM_PEER_UNVERIFIED / DM_PEER_BLOCKED -> 403 DM_PEER_UNAVAILABLE (one neutral answer)

CREATE OR REPLACE FUNCTION set_direct_message_reaction(
  p_participant UUID,
  p_thread UUID,
  p_message UUID,
  p_reaction TEXT,
  p_present BOOLEAN
) RETURNS TABLE (changed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_low UUID;
  v_high UUID;
  v_peer UUID;
  v_rows INTEGER;
BEGIN
  IF p_participant IS NULL OR p_thread IS NULL OR p_message IS NULL OR p_present IS NULL THEN
    RAISE EXCEPTION 'CHAT_REACTION_VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(is_approved_chat_reaction(p_reaction), FALSE) THEN
    RAISE EXCEPTION 'CHAT_REACTION_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT participant_low_id, participant_high_id
  INTO v_low, v_high
  FROM direct_message_threads
  WHERE id = p_thread;

  -- A missing thread and somebody else's thread give the same answer.
  IF NOT FOUND OR p_participant NOT IN (v_low, v_high) THEN
    RAISE EXCEPTION 'DM_NOT_A_PARTICIPANT' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE id = p_participant
      AND role = 'PART'
      AND is_verified = TRUE
      AND is_suspended = FALSE
      AND is_deactivated = FALSE
  ) THEN
    RAISE EXCEPTION 'DM_ACCOUNT_SUSPENDED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM direct_messages
    WHERE id = p_message AND thread_id = p_thread
  ) THEN
    RAISE EXCEPTION 'CHAT_REACTION_MESSAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_peer := CASE WHEN p_participant = v_low THEN v_high ELSE v_low END;

  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE id = v_peer
      AND role = 'PART'
      AND is_verified = TRUE
      AND is_suspended = FALSE
      AND is_deactivated = FALSE
  ) THEN
    RAISE EXCEPTION 'DM_PEER_UNVERIFIED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM participant_blocks
    WHERE (blocker_id = p_participant AND blocked_id = v_peer)
       OR (blocker_id = v_peer AND blocked_id = p_participant)
  ) THEN
    RAISE EXCEPTION 'DM_PEER_BLOCKED' USING ERRCODE = 'P0001';
  END IF;

  IF p_present THEN
    INSERT INTO direct_message_reactions (message_id, participant_id, reaction)
    VALUES (p_message, p_participant, p_reaction)
    ON CONFLICT ON CONSTRAINT pk_direct_message_reactions DO NOTHING;
  ELSE
    DELETE FROM direct_message_reactions
    WHERE message_id = p_message
      AND participant_id = p_participant
      AND reaction = p_reaction;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Batched aggregate reads (counts only; never reactor identities)
-- ---------------------------------------------------------------------------
-- Callers pass only message ids they already authorized for p_participant.

CREATE OR REPLACE FUNCTION summarize_chat_message_reactions(
  p_participant UUID,
  p_messages UUID[]
) RETURNS TABLE (
  message_id UUID,
  reaction TEXT,
  reaction_count INTEGER,
  reacted_by_me BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.message_id,
    r.reaction::TEXT,
    COUNT(*)::INTEGER,
    BOOL_OR(r.participant_id = p_participant)
  FROM chat_message_reactions AS r
  WHERE r.message_id = ANY(p_messages)
  GROUP BY r.message_id, r.reaction;
$$;

CREATE OR REPLACE FUNCTION summarize_direct_message_reactions(
  p_participant UUID,
  p_messages UUID[]
) RETURNS TABLE (
  message_id UUID,
  reaction TEXT,
  reaction_count INTEGER,
  reacted_by_me BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.message_id,
    r.reaction::TEXT,
    COUNT(*)::INTEGER,
    BOOL_OR(r.participant_id = p_participant)
  FROM direct_message_reactions AS r
  WHERE r.message_id = ANY(p_messages)
  GROUP BY r.message_id, r.reaction;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION set_chat_message_reaction(UUID, UUID, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_chat_message_reaction(UUID, UUID, UUID, TEXT, BOOLEAN)
  TO service_role;

REVOKE ALL ON FUNCTION set_direct_message_reaction(UUID, UUID, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_direct_message_reaction(UUID, UUID, UUID, TEXT, BOOLEAN)
  TO service_role;

REVOKE ALL ON FUNCTION summarize_chat_message_reactions(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION summarize_chat_message_reactions(UUID, UUID[])
  TO service_role;

REVOKE ALL ON FUNCTION summarize_direct_message_reactions(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION summarize_direct_message_reactions(UUID, UUID[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Documentation
-- ---------------------------------------------------------------------------

COMMENT ON TABLE chat_message_reactions IS
  'US-035 / #405: one approved reaction per channel/team message, participant, and code; no handle, email, or account snapshot.';

COMMENT ON TABLE direct_message_reactions IS
  'US-035 / #405: one approved reaction per direct message, participant, and code; no handle, email, or account snapshot.';

COMMENT ON FUNCTION is_approved_chat_reaction(TEXT) IS
  'US-035 / #404: the fixed approved reaction codes (thumbs_up, heart, laugh, party, surprised, sad, eyes, check).';

COMMENT ON FUNCTION set_chat_message_reaction(UUID, UUID, UUID, TEXT, BOOLEAN) IS
  'US-035 / #405: idempotent add/remove of one channel/team message reaction after re-checking team write rules.';

COMMENT ON FUNCTION set_direct_message_reaction(UUID, UUID, UUID, TEXT, BOOLEAN) IS
  'US-035 / #405: idempotent add/remove of one direct-message reaction after re-checking DM send rules and blocks.';

COMMENT ON FUNCTION summarize_chat_message_reactions(UUID, UUID[]) IS
  'US-035 / #405: per-message reaction counts and the viewer''s own state for already-authorized channel/team messages.';

COMMENT ON FUNCTION summarize_direct_message_reactions(UUID, UUID[]) IS
  'US-035 / #405: per-message reaction counts and the viewer''s own state for already-authorized direct messages.';
