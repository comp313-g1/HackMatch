-- Migration: 0068_create_chat_message_attachments.sql
-- Description: US-035 / #409 — secure chat attachment metadata, quota, linking,
-- and storage-cleanup bookkeeping, following the approved #404 policy
-- (docs/04_requirements/us035_rich_chat_policy.md, sections 6–7).
--
-- Model
--   * One table per conversation family, like the 0060 mentions and 0067 reactions:
--     chat_message_attachments (public and team channels) and
--     direct_message_attachments (DM threads). Every row has a REAL foreign key to
--     the conversation it was uploaded for and, once sent, to its message.
--   * A row is created as 'uploading' (bytes reserved against quota), becomes
--     'pending' once its object is stored, and 'attached' when a message is sent
--     with it. Only the server's service role reads or writes these tables.
--   * File bytes never enter PostgreSQL. They live in a PRIVATE storage bucket
--     under an opaque, server-generated UUID key (no filename, participant, or
--     conversation in the key).
--   * PostgreSQL cannot delete storage objects. Every deleted attachment row (by
--     any path: message or channel cascade, account deletion, expiry, demo reset)
--     records its storage key in chat_attachment_object_deletions; server
--     maintenance removes those objects and then the queue rows.
--   * Limits (#404 section 6): 10 MB per file, 5 per message, 20 uploads per
--     participant per rolling hour, 100 MB stored per participant (uploading,
--     pending, and attached rows), pending uploads expire after 24 h.
--   * scan_status records malware-scan state honestly. No scanner exists, so
--     uploads are stored as 'not_scanned'; nothing here can mark a file 'clean'.
--
-- Access: RLS enabled with zero public policies; functions are service-role only.

-- ---------------------------------------------------------------------------
-- 1. Approved detected types (single SQL source of truth)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_approved_chat_attachment_type(p_mime TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_mime IN (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Attachment metadata
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_message_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  uploader_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  message_id UUID NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(32) NOT NULL,
  size_bytes INTEGER NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'uploading',
  scan_status VARCHAR(12) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_chat_message_attachments_storage_key UNIQUE (storage_key),
  CONSTRAINT chk_chat_message_attachments_storage_key CHECK (
    storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT chk_chat_message_attachments_display_name CHECK (LENGTH(TRIM(display_name)) > 0),
  CONSTRAINT chk_chat_message_attachments_type CHECK (is_approved_chat_attachment_type(mime_type)),
  CONSTRAINT chk_chat_message_attachments_size CHECK (size_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT chk_chat_message_attachments_status CHECK (status IN ('uploading', 'pending', 'attached')),
  CONSTRAINT chk_chat_message_attachments_scan CHECK (
    scan_status IN ('not_scanned', 'pending', 'clean', 'infected', 'scan_failed')
  ),
  CONSTRAINT chk_chat_message_attachments_link CHECK (
    (status = 'attached') = (message_id IS NOT NULL)
    AND (message_id IS NULL) = (attached_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS direct_message_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  uploader_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES direct_message_threads(id) ON DELETE CASCADE,
  message_id UUID NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(32) NOT NULL,
  size_bytes INTEGER NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'uploading',
  scan_status VARCHAR(12) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_direct_message_attachments_storage_key UNIQUE (storage_key),
  CONSTRAINT chk_direct_message_attachments_storage_key CHECK (
    storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT chk_direct_message_attachments_display_name CHECK (LENGTH(TRIM(display_name)) > 0),
  CONSTRAINT chk_direct_message_attachments_type CHECK (is_approved_chat_attachment_type(mime_type)),
  CONSTRAINT chk_direct_message_attachments_size CHECK (size_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT chk_direct_message_attachments_status CHECK (status IN ('uploading', 'pending', 'attached')),
  CONSTRAINT chk_direct_message_attachments_scan CHECK (
    scan_status IN ('not_scanned', 'pending', 'clean', 'infected', 'scan_failed')
  ),
  CONSTRAINT chk_direct_message_attachments_link CHECK (
    (status = 'attached') = (message_id IS NOT NULL)
    AND (message_id IS NULL) = (attached_at IS NULL)
  )
);

ALTER TABLE chat_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_message_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE chat_message_attachments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE direct_message_attachments FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_chat_message_attachments_message
  ON chat_message_attachments(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_message_attachments_uploader_created
  ON chat_message_attachments(uploader_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_message_attachments_unattached_created
  ON chat_message_attachments(created_at) WHERE message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_message_attachments_channel
  ON chat_message_attachments(channel_id);

CREATE INDEX IF NOT EXISTS idx_direct_message_attachments_message
  ON direct_message_attachments(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_direct_message_attachments_uploader_created
  ON direct_message_attachments(uploader_id, created_at);
CREATE INDEX IF NOT EXISTS idx_direct_message_attachments_unattached_created
  ON direct_message_attachments(created_at) WHERE message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_direct_message_attachments_thread
  ON direct_message_attachments(thread_id);

-- ---------------------------------------------------------------------------
-- 3. Storage objects waiting to be deleted (filled by any row deletion)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_attachment_object_deletions (
  storage_key TEXT PRIMARY KEY,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NULL
);

ALTER TABLE chat_attachment_object_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE chat_attachment_object_deletions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION enqueue_chat_attachment_object_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO chat_attachment_object_deletions (storage_key)
  VALUES (OLD.storage_key)
  ON CONFLICT (storage_key) DO NOTHING;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_chat_message_attachments_enqueue_object ON chat_message_attachments;
CREATE TRIGGER trigger_chat_message_attachments_enqueue_object
  AFTER DELETE ON chat_message_attachments
  FOR EACH ROW EXECUTE FUNCTION enqueue_chat_attachment_object_deletion();

DROP TRIGGER IF EXISTS trigger_direct_message_attachments_enqueue_object ON direct_message_attachments;
CREATE TRIGGER trigger_direct_message_attachments_enqueue_object
  AFTER DELETE ON direct_message_attachments
  FOR EACH ROW EXECUTE FUNCTION enqueue_chat_attachment_object_deletion();

-- ---------------------------------------------------------------------------
-- 4. Linking rules enforced at write time (any path, any concurrency)
-- ---------------------------------------------------------------------------
-- A row may join a message only if the message is in the same conversation and
-- was written by the uploader, and the message has fewer than 5 attachments.
-- The per-message advisory lock serializes concurrent linking of one message.

CREATE OR REPLACE FUNCTION guard_chat_message_attachment_link()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_channel UUID;
  v_author UUID;
BEGIN
  IF NEW.message_id IS NULL OR NEW.message_id IS NOT DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.message_id END) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hackmatch:chat-attachment:message:' || NEW.message_id::text, 0));
  SELECT channel_id, author_id INTO v_channel, v_author FROM chat_messages WHERE id = NEW.message_id;
  IF v_channel IS DISTINCT FROM NEW.channel_id OR v_author IS DISTINCT FROM NEW.uploader_id THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT COUNT(*) FROM chat_message_attachments WHERE message_id = NEW.message_id AND id <> NEW.id) >= 5 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_chat_message_attachments_guard_link ON chat_message_attachments;
CREATE TRIGGER trigger_chat_message_attachments_guard_link
  BEFORE INSERT OR UPDATE OF message_id ON chat_message_attachments
  FOR EACH ROW EXECUTE FUNCTION guard_chat_message_attachment_link();

CREATE OR REPLACE FUNCTION guard_direct_message_attachment_link()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_thread UUID;
  v_author UUID;
BEGIN
  IF NEW.message_id IS NULL OR NEW.message_id IS NOT DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.message_id END) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hackmatch:chat-attachment:dm-message:' || NEW.message_id::text, 0));
  SELECT thread_id, author_id INTO v_thread, v_author FROM direct_messages WHERE id = NEW.message_id;
  IF v_thread IS DISTINCT FROM NEW.thread_id OR v_author IS DISTINCT FROM NEW.uploader_id THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT COUNT(*) FROM direct_message_attachments WHERE message_id = NEW.message_id AND id <> NEW.id) >= 5 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_direct_message_attachments_guard_link ON direct_message_attachments;
CREATE TRIGGER trigger_direct_message_attachments_guard_link
  BEFORE INSERT OR UPDATE OF message_id ON direct_message_attachments
  FOR EACH ROW EXECUTE FUNCTION guard_direct_message_attachment_link();

-- ---------------------------------------------------------------------------
-- 5. Usage (read-only pre-check) and race-safe reservation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION chat_attachment_usage(p_participant UUID)
RETURNS TABLE (uploads_last_hour INTEGER, oldest_upload_in_window TIMESTAMPTZ, stored_bytes BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT created_at, size_bytes, status FROM chat_message_attachments WHERE uploader_id = p_participant
    UNION ALL
    SELECT created_at, size_bytes, status FROM direct_message_attachments WHERE uploader_id = p_participant
  )
  SELECT
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::INTEGER,
    MIN(created_at) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour'),
    COALESCE(SUM(size_bytes), 0)::BIGINT
  FROM rows;
$$;

-- Serialized per participant, so simultaneous uploads cannot exceed the hourly
-- count or the 100 MB quota. Returns an outcome instead of raising so the caller
-- can report retry timing.
CREATE OR REPLACE FUNCTION reserve_chat_attachment_upload(
  p_participant UUID,
  p_scope TEXT,
  p_conversation UUID,
  p_storage_key TEXT,
  p_display_name TEXT,
  p_mime_type TEXT,
  p_size_bytes INTEGER,
  p_scan_status TEXT
) RETURNS TABLE (outcome TEXT, attachment_id UUID, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_oldest TIMESTAMPTZ;
  v_bytes BIGINT;
  v_id UUID;
BEGIN
  IF p_participant IS NULL OR p_conversation IS NULL OR p_scope NOT IN ('channel', 'direct_message') THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('hackmatch:chat-attachment:participant:' || p_participant::text, 0)
  );

  SELECT uploads_last_hour, oldest_upload_in_window, stored_bytes
  INTO v_count, v_oldest, v_bytes
  FROM chat_attachment_usage(p_participant);

  IF v_count >= 20 THEN
    RETURN QUERY SELECT
      'rate_limited'::TEXT,
      NULL::UUID,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_oldest + INTERVAL '1 hour' - NOW())))::INTEGER);
    RETURN;
  END IF;

  IF v_bytes + p_size_bytes > 104857600 THEN
    RETURN QUERY SELECT 'quota_exceeded'::TEXT, NULL::UUID, 0;
    RETURN;
  END IF;

  IF p_scope = 'channel' THEN
    INSERT INTO chat_message_attachments
      (uploader_id, channel_id, storage_key, display_name, mime_type, size_bytes, status, scan_status)
    VALUES
      (p_participant, p_conversation, p_storage_key, p_display_name, p_mime_type, p_size_bytes, 'uploading', p_scan_status)
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO direct_message_attachments
      (uploader_id, thread_id, storage_key, display_name, mime_type, size_bytes, status, scan_status)
    VALUES
      (p_participant, p_conversation, p_storage_key, p_display_name, p_mime_type, p_size_bytes, 'uploading', p_scan_status)
    RETURNING id INTO v_id;
  END IF;

  RETURN QUERY SELECT 'reserved'::TEXT, v_id, 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Send a message and link its attachments in ONE transaction
-- ---------------------------------------------------------------------------
-- Only the sender's own 'pending' uploads for this exact conversation, not yet
-- attached and not expired, can be linked. Anything else fails the whole send,
-- so the message is never stored without its attachments (and vice versa).

CREATE OR REPLACE FUNCTION send_chat_message_with_attachments(
  p_participant UUID,
  p_channel UUID,
  p_body TEXT,
  p_attachments UUID[]
) RETURNS SETOF chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wanted INTEGER;
  v_rows INTEGER;
  v_message chat_messages%ROWTYPE;
BEGIN
  v_wanted := COALESCE(CARDINALITY(ARRAY(SELECT DISTINCT unnest(p_attachments))), 0);
  IF v_wanted < 1 OR v_wanted <> CARDINALITY(p_attachments) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;
  IF v_wanted > 5 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the uploads so two sends cannot claim the same file.
  PERFORM 1 FROM chat_message_attachments WHERE id = ANY(p_attachments) FOR UPDATE;

  INSERT INTO chat_messages (channel_id, author_id, body)
  VALUES (p_channel, p_participant, p_body)
  RETURNING * INTO v_message;

  UPDATE chat_message_attachments
  SET message_id = v_message.id, status = 'attached', attached_at = NOW()
  WHERE id = ANY(p_attachments)
    AND uploader_id = p_participant
    AND channel_id = p_channel
    AND status = 'pending'
    AND message_id IS NULL
    AND created_at > NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> v_wanted THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEXT v_message;
END;
$$;

CREATE OR REPLACE FUNCTION send_direct_message_with_attachments(
  p_participant UUID,
  p_thread UUID,
  p_body TEXT,
  p_attachments UUID[]
) RETURNS SETOF direct_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wanted INTEGER;
  v_rows INTEGER;
  v_low UUID;
  v_high UUID;
  v_peer UUID;
  v_message direct_messages%ROWTYPE;
BEGIN
  v_wanted := COALESCE(CARDINALITY(ARRAY(SELECT DISTINCT unnest(p_attachments))), 0);
  IF v_wanted < 1 OR v_wanted <> CARDINALITY(p_attachments) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_VALIDATION_ERROR' USING ERRCODE = 'P0001';
  END IF;
  IF v_wanted > 5 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  -- Same send rules the API applies, re-checked at write time.
  SELECT participant_low_id, participant_high_id INTO v_low, v_high
  FROM direct_message_threads WHERE id = p_thread;
  IF NOT FOUND OR p_participant NOT IN (v_low, v_high) THEN
    RAISE EXCEPTION 'DM_NOT_A_PARTICIPANT' USING ERRCODE = 'P0001';
  END IF;
  v_peer := CASE WHEN p_participant = v_low THEN v_high ELSE v_low END;
  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE id = v_peer AND role = 'PART' AND is_verified = TRUE AND is_suspended = FALSE AND is_deactivated = FALSE
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

  PERFORM 1 FROM direct_message_attachments WHERE id = ANY(p_attachments) FOR UPDATE;

  INSERT INTO direct_messages (thread_id, author_id, body)
  VALUES (p_thread, p_participant, p_body)
  RETURNING * INTO v_message;

  UPDATE direct_message_attachments
  SET message_id = v_message.id, status = 'attached', attached_at = NOW()
  WHERE id = ANY(p_attachments)
    AND uploader_id = p_participant
    AND thread_id = p_thread
    AND status = 'pending'
    AND message_id IS NULL
    AND created_at > NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> v_wanted THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEXT v_message;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Expiry of uploads that were never sent (bounded work per call)
-- ---------------------------------------------------------------------------
-- Pending uploads expire 24 h after upload; reservations whose upload never
-- completed expire after 15 minutes. Deleting the rows queues their objects.

CREATE OR REPLACE FUNCTION expire_chat_attachment_uploads(p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel INTEGER;
  v_direct INTEGER;
BEGIN
  DELETE FROM chat_message_attachments
  WHERE id IN (
    SELECT id FROM chat_message_attachments
    WHERE message_id IS NULL
      AND (created_at <= NOW() - INTERVAL '24 hours'
           OR (status = 'uploading' AND created_at <= NOW() - INTERVAL '15 minutes'))
    ORDER BY created_at
    LIMIT GREATEST(p_limit, 0)
  );
  GET DIAGNOSTICS v_channel = ROW_COUNT;

  DELETE FROM direct_message_attachments
  WHERE id IN (
    SELECT id FROM direct_message_attachments
    WHERE message_id IS NULL
      AND (created_at <= NOW() - INTERVAL '24 hours'
           OR (status = 'uploading' AND created_at <= NOW() - INTERVAL '15 minutes'))
    ORDER BY created_at
    LIMIT GREATEST(p_limit, 0)
  );
  GET DIAGNOSTICS v_direct = ROW_COUNT;

  RETURN v_channel + v_direct;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Private storage bucket (Supabase only; skipped where storage is absent)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('chat-attachments', 'chat-attachments', FALSE)
    ON CONFLICT (id) DO UPDATE SET public = FALSE;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit'
    ) THEN
      EXECUTE $sql$UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'chat-attachments'$sql$;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
    ) THEN
      EXECUTE $sql$UPDATE storage.buckets
        SET allowed_mime_types = ARRAY['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain']
        WHERE id = 'chat-attachments'$sql$;
    END IF;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION chat_attachment_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_attachment_usage(UUID) TO service_role;

REVOKE ALL ON FUNCTION reserve_chat_attachment_upload(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_chat_attachment_upload(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION send_chat_message_with_attachments(UUID, UUID, TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION send_chat_message_with_attachments(UUID, UUID, TEXT, UUID[]) TO service_role;

REVOKE ALL ON FUNCTION send_direct_message_with_attachments(UUID, UUID, TEXT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION send_direct_message_with_attachments(UUID, UUID, TEXT, UUID[]) TO service_role;

REVOKE ALL ON FUNCTION expire_chat_attachment_uploads(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_chat_attachment_uploads(INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Documentation
-- ---------------------------------------------------------------------------

COMMENT ON TABLE chat_message_attachments IS
  'US-035 / #409: channel/team chat attachment metadata; bytes live in the private chat-attachments bucket under an opaque key.';
COMMENT ON TABLE direct_message_attachments IS
  'US-035 / #409: direct-message attachment metadata; bytes live in the private chat-attachments bucket under an opaque key.';
COMMENT ON TABLE chat_attachment_object_deletions IS
  'US-035 / #409: storage objects whose metadata row was deleted; server maintenance removes them from the bucket.';
COMMENT ON COLUMN chat_message_attachments.scan_status IS
  'not_scanned while no malware scanner exists; never set to clean without a real scan.';
COMMENT ON COLUMN direct_message_attachments.scan_status IS
  'not_scanned while no malware scanner exists; never set to clean without a real scan.';
