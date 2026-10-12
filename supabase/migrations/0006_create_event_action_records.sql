-- Migration: 0006_create_event_action_records.sql
-- Description: Creates event_action_records table, append-only immutability triggers, admin role verification, indexes, and RLS

-- 1. Helper trigger function to enforce that only ADMIN accounts can record event actions (US-010 AC 1)
CREATE OR REPLACE FUNCTION check_event_action_actor_role()
RETURNS TRIGGER AS $$
DECLARE
  v_role VARCHAR(10);
BEGIN
  SELECT role INTO v_role FROM participants WHERE id = NEW.actor_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Actor not found in participants';
  ELSIF v_role != 'ADMIN' THEN
    RAISE EXCEPTION 'Actor must have ADMIN role to record event actions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Helper trigger function to prevent any modifications or deletions (append-only audit log per FR-079 / US-010)
CREATE OR REPLACE FUNCTION prevent_event_action_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Event action records are append-only and cannot be updated, deleted, or truncated.';
END;
$$ LANGUAGE plpgsql;

-- 3. Event Action Records Table
CREATE TABLE IF NOT EXISTS event_action_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  target_type VARCHAR(50) NOT NULL CHECK (LENGTH(TRIM(target_type)) > 0),
  target_id UUID NOT NULL,
  action_type VARCHAR(50) NOT NULL CHECK (LENGTH(TRIM(action_type)) > 0),
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) > 0),
  outcome VARCHAR(50) NOT NULL CHECK (LENGTH(TRIM(outcome)) > 0),
  safe_state_summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Enable Row Level Security (zero public policies to deny PostgREST anon access)
ALTER TABLE event_action_records ENABLE ROW LEVEL SECURITY;

-- 5. Indexes
-- Target entity history lookup index
CREATE INDEX IF NOT EXISTS idx_event_action_records_target_id
  ON event_action_records(target_id);

-- Actor audit lookup index
CREATE INDEX IF NOT EXISTS idx_event_action_records_actor_id
  ON event_action_records(actor_id);

-- Chronological audit ordering index (newest first per US-028 / FR-080)
CREATE INDEX IF NOT EXISTS idx_event_action_records_created_at
  ON event_action_records(created_at DESC);

-- Action type filtering index (US-028 AC 4 / FR-080)
CREATE INDEX IF NOT EXISTS idx_event_action_records_action_type
  ON event_action_records(action_type);

-- 6. Triggers
-- Enforce ADMIN role on insert
DROP TRIGGER IF EXISTS trigger_check_event_action_actor_role ON event_action_records;
CREATE TRIGGER trigger_check_event_action_actor_role
  BEFORE INSERT ON event_action_records
  FOR EACH ROW
  EXECUTE FUNCTION check_event_action_actor_role();

-- Prevent row UPDATE or DELETE
DROP TRIGGER IF EXISTS trigger_event_action_records_prevent_modification ON event_action_records;
CREATE TRIGGER trigger_event_action_records_prevent_modification
  BEFORE UPDATE OR DELETE ON event_action_records
  FOR EACH ROW
  EXECUTE FUNCTION prevent_event_action_modification();

-- Prevent table TRUNCATE
DROP TRIGGER IF EXISTS trigger_event_action_records_prevent_truncate ON event_action_records;
CREATE TRIGGER trigger_event_action_records_prevent_truncate
  BEFORE TRUNCATE ON event_action_records
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_event_action_modification();
