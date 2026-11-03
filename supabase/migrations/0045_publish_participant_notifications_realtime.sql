-- Migration: 0045_publish_participant_notifications_realtime.sql
-- Description: US-021 / #198 — adds participant_notifications to the Supabase
-- Realtime publication so the Express notification service can push new alerts
-- (written by any lifecycle function) to online recipients (NR-004).
-- Idempotent and safe where the publication does not exist (plain Postgres).
-- Access stays Express service role only: RLS remains enabled with zero policies,
-- so anon/authenticated Realtime clients receive nothing from this table.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'participant_notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.participant_notifications;
  END IF;
END
$$;
