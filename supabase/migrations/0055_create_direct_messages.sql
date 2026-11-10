-- Migration: 0055_create_direct_messages.sql
-- Description: US-032 / #385 / FR-091 — completes the direct-message data model
-- after the already-applied 0053 thread migration. Adds thread messages, author-pair
-- integrity, deterministic chronological lookup, and recent-activity inbox indexes.
--
-- This migration is additive and idempotent. It does not add DM API or UI behavior.

-- ---------------------------------------------------------------------------
-- 1. Recent-activity cursor for efficient inbox ordering
-- ---------------------------------------------------------------------------

ALTER TABLE direct_message_threads
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_direct_message_threads_low_activity
  ON direct_message_threads(participant_low_id, last_message_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_direct_message_threads_high_activity
  ON direct_message_threads(participant_high_id, last_message_at DESC, id);

-- ---------------------------------------------------------------------------
-- 2. Direct-message rows linked to one canonical thread and one author
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES direct_message_threads(id) ON DELETE RESTRICT,
  author_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_direct_messages_body_nonempty CHECK (LENGTH(TRIM(body)) > 0),
  CONSTRAINT chk_direct_messages_body_length CHECK (LENGTH(body) <= 4000)
);

ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

-- Stable thread reads: timestamp first, UUID as the deterministic tie-breaker.
CREATE INDEX IF NOT EXISTS idx_direct_messages_thread_created_id
  ON direct_messages(thread_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_direct_messages_author_id
  ON direct_messages(author_id);

-- ---------------------------------------------------------------------------
-- 3. Database-enforced thread participation and activity maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_direct_message_author()
RETURNS TRIGGER AS $$
DECLARE
  v_participant_low UUID;
  v_participant_high UUID;
BEGIN
  SELECT participant_low_id, participant_high_id
  INTO v_participant_low, v_participant_high
  FROM direct_message_threads
  WHERE id = NEW.thread_id;

  IF NOT FOUND THEN
    RETURN NEW; -- the thread FK reports the missing relation
  END IF;

  IF NEW.author_id NOT IN (v_participant_low, v_participant_high) THEN
    RAISE EXCEPTION 'DIRECT_MESSAGE_AUTHOR_NOT_PARTICIPANT'
      USING ERRCODE = 'P0001',
            DETAIL = 'Only a participant in the direct-message thread may author its messages.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_direct_messages_guard_author ON direct_messages;
CREATE TRIGGER trigger_direct_messages_guard_author
  BEFORE INSERT OR UPDATE OF thread_id, author_id ON direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION guard_direct_message_author();

CREATE OR REPLACE FUNCTION touch_direct_message_thread_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE direct_message_threads
  SET last_message_at = GREATEST(last_message_at, NEW.created_at)
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_direct_messages_touch_thread ON direct_messages;
CREATE TRIGGER trigger_direct_messages_touch_thread
  AFTER INSERT ON direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION touch_direct_message_thread_activity();

COMMENT ON TABLE direct_messages IS
  'US-032 / #385: private text messages belonging to one canonical direct_message_threads row.';

COMMENT ON COLUMN direct_message_threads.last_message_at IS
  'US-032 / #385: latest direct-message timestamp used for deterministic inbox activity ordering.';

