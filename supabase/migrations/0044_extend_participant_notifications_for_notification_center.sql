-- Migration: 0044_extend_participant_notifications_for_notification_center.sql
-- Description: US-021 / #197 — extends the existing participant_notifications
-- table (created in 0011, written by the US-012..US-027 lifecycle functions)
-- into the in-app notification center model (FR-063, FR-065):
--   * derived `category` for the feed dropdown groups,
--   * nullable deep-link targets (request_id, submission_id),
--   * read-state integrity (read_at cannot precede created_at),
--   * partial indexes that keep the unread badge count and unread feed cheap,
--   * service-role-only transactional mark-read / mark-all-read operations
--     scoped strictly to the owning participant.
-- Additive and idempotent: existing rows and existing notification producers
-- (which never set the new columns) keep working unchanged.

-- ---------------------------------------------------------------------------
-- 1. Category derivation (single source of truth for feed grouping)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notification_category_for_type(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_type = 'team_invitation' THEN 'invitation'
    WHEN p_type = 'team_application_submitted' THEN 'application'
    WHEN p_type IN (
      'team_application_approved',
      'team_application_declined',
      'team_invitation_accepted',
      'team_invitation_declined'
    ) THEN 'decision'
    WHEN p_type = 'TEAM_ROSTER_LOCKED' THEN 'roster'
    WHEN p_type LIKE 'event\_verification\_%' THEN 'event_verification'
    ELSE 'general'
  END
$$;

COMMENT ON FUNCTION notification_category_for_type(TEXT) IS
  'US-021 / #197: maps a notification type to its feed category (invitation, application, decision, roster, event_verification, general).';

-- ---------------------------------------------------------------------------
-- 2. New columns
-- ---------------------------------------------------------------------------

ALTER TABLE participant_notifications
  ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'general';

ALTER TABLE participant_notifications
  ADD COLUMN IF NOT EXISTS request_id UUID
    REFERENCES team_requests(id) ON DELETE SET NULL;

ALTER TABLE participant_notifications
  ADD COLUMN IF NOT EXISTS submission_id UUID
    REFERENCES pending_event_submissions(id) ON DELETE SET NULL;

-- Backfill categories for rows written before this migration.
UPDATE participant_notifications
SET category = notification_category_for_type(type)
WHERE category IS DISTINCT FROM notification_category_for_type(type);

-- ---------------------------------------------------------------------------
-- 3. Constraints
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_participant_notifications_category'
      AND conrelid = 'participant_notifications'::regclass
  ) THEN
    ALTER TABLE participant_notifications
      ADD CONSTRAINT chk_participant_notifications_category
      CHECK (category IN (
        'invitation',
        'application',
        'decision',
        'roster',
        'event_verification',
        'general'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_participant_notifications_read_after_created'
      AND conrelid = 'participant_notifications'::regclass
  ) THEN
    ALTER TABLE participant_notifications
      ADD CONSTRAINT chk_participant_notifications_read_after_created
      CHECK (read_at IS NULL OR read_at >= created_at);
  END IF;
END
$$;

-- Category is always derived from type so producers cannot drift from the
-- mapping and existing producers need no change.
CREATE OR REPLACE FUNCTION set_participant_notification_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.category := notification_category_for_type(NEW.type);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_participant_notifications_category
  ON participant_notifications;
CREATE TRIGGER trigger_participant_notifications_category
  BEFORE INSERT OR UPDATE OF type ON participant_notifications
  FOR EACH ROW
  EXECUTE FUNCTION set_participant_notification_category();

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------

-- Unread badge count and unread-only feed, newest first. Partial so the index
-- shrinks as notifications are read.
CREATE INDEX IF NOT EXISTS idx_participant_notifications_unread
  ON participant_notifications(participant_id, created_at DESC)
  WHERE read_at IS NULL;

-- Category-filtered unread feed.
CREATE INDEX IF NOT EXISTS idx_participant_notifications_unread_category
  ON participant_notifications(participant_id, category, created_at DESC)
  WHERE read_at IS NULL;

-- Keep ON DELETE SET NULL on the deep-link targets cheap.
CREATE INDEX IF NOT EXISTS idx_participant_notifications_request
  ON participant_notifications(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_participant_notifications_submission
  ON participant_notifications(submission_id)
  WHERE submission_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Mark one notification read (FR-065)
-- ---------------------------------------------------------------------------
-- Scoped to the owner: another participant's id is indistinguishable from a
-- missing id (NOTIFICATION_NOT_FOUND), so existence never leaks. Idempotent:
-- an already-read notification keeps its original read_at.

CREATE OR REPLACE FUNCTION mark_participant_notification_read(
  p_participant UUID,
  p_notification UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row participant_notifications%ROWTYPE;
  v_already_read BOOLEAN;
  v_unread_count INTEGER;
BEGIN
  IF p_participant IS NULL OR p_notification IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'participantRequired', p_participant IS NULL,
              'notificationRequired', p_notification IS NULL
            )::text;
  END IF;

  SELECT * INTO v_row
  FROM participant_notifications
  WHERE id = p_notification
    AND participant_id = p_participant
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOTIFICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_already_read := v_row.read_at IS NOT NULL;

  IF NOT v_already_read THEN
    UPDATE participant_notifications
    SET read_at = GREATEST(NOW(), created_at)
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_unread_count
  FROM participant_notifications
  WHERE participant_id = p_participant
    AND read_at IS NULL;

  RETURN jsonb_build_object(
    'notification', to_jsonb(v_row),
    'alreadyRead', v_already_read,
    'unreadCount', v_unread_count
  );
END;
$$;

REVOKE ALL ON FUNCTION mark_participant_notification_read(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_participant_notification_read(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION mark_participant_notification_read(UUID, UUID) IS
  'US-021 / #197 / FR-065: idempotently marks one of the caller''s own notifications read and returns the fresh unread count.';

-- ---------------------------------------------------------------------------
-- 6. Mark all read (FR-065)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mark_all_participant_notifications_read(
  p_participant UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marked INTEGER;
  v_unread_count INTEGER;
BEGIN
  IF p_participant IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('participantRequired', true)::text;
  END IF;

  UPDATE participant_notifications
  SET read_at = GREATEST(NOW(), created_at)
  WHERE participant_id = p_participant
    AND read_at IS NULL;

  GET DIAGNOSTICS v_marked = ROW_COUNT;

  SELECT COUNT(*)::INTEGER INTO v_unread_count
  FROM participant_notifications
  WHERE participant_id = p_participant
    AND read_at IS NULL;

  RETURN jsonb_build_object(
    'markedCount', v_marked,
    'unreadCount', v_unread_count
  );
END;
$$;

REVOKE ALL ON FUNCTION mark_all_participant_notifications_read(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_all_participant_notifications_read(UUID)
  TO service_role;

COMMENT ON FUNCTION mark_all_participant_notifications_read(UUID) IS
  'US-021 / #197 / FR-065: marks every unread notification owned by the participant read in one statement; never touches other accounts.';

COMMENT ON TABLE participant_notifications IS
  'FR-064 basic lifecycle alerts, extended by US-021 / #197 into the notification center feed (category, deep-link targets, unread indexes). Access: Express service role only (RLS, zero policies).';
