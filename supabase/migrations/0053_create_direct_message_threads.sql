-- Migration: 0053_create_direct_message_threads.sql
-- Description: US-032 / FR-091 — one-to-one direct-message thread table, the minimum the
-- idempotent "open or continue" endpoint (#386) needs. Messages, inbox, block rules and the
-- React views ship in later US-032 tasks.
--
-- Rules enforced here, in the database, so no code path can bypass them:
--   * A thread is exactly one UNORDERED pair of two different participants. The pair is stored
--     in canonical order (participant_low_id < participant_high_id), so (A,B) and (B,A) are the
--     same row and a self-thread is impossible.
--   * At most ONE thread per pair (unique constraint). Concurrent "open" requests therefore
--     resolve to the same row, which makes opening idempotent.
--   * The two participants of a thread never change.
--   * Participants cannot be deleted while they have a thread (history is never orphaned).
-- Access: RLS enabled with zero public policies (Express service role only), like chat_channels.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS direct_message_threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_low_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  participant_high_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_direct_message_threads_canonical_pair CHECK (
    participant_low_id < participant_high_id
  ),
  CONSTRAINT uq_direct_message_threads_pair UNIQUE (participant_low_id, participant_high_id)
);

ALTER TABLE direct_message_threads ENABLE ROW LEVEL SECURITY;

-- The unique constraint serves lookups by (low) or (low, high); this serves "threads of X" as the high side.
CREATE INDEX IF NOT EXISTS idx_direct_message_threads_high
  ON direct_message_threads(participant_high_id);

CREATE OR REPLACE FUNCTION prevent_direct_message_thread_repairing()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.participant_low_id IS DISTINCT FROM OLD.participant_low_id
     OR NEW.participant_high_id IS DISTINCT FROM OLD.participant_high_id THEN
    RAISE EXCEPTION 'DIRECT_MESSAGE_THREAD_PARTICIPANTS_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'The participants of a direct-message thread cannot be changed.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_direct_message_threads_prevent_repairing ON direct_message_threads;
CREATE TRIGGER trigger_direct_message_threads_prevent_repairing
  BEFORE UPDATE OF participant_low_id, participant_high_id ON direct_message_threads
  FOR EACH ROW
  EXECUTE FUNCTION prevent_direct_message_thread_repairing();

DROP TRIGGER IF EXISTS trigger_direct_message_threads_updated_at ON direct_message_threads;
CREATE TRIGGER trigger_direct_message_threads_updated_at
  BEFORE UPDATE ON direct_message_threads
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE direct_message_threads IS
  'US-032 / #386 / FR-091: one private thread per unordered pair of participants, stored in canonical (low < high) order.';
