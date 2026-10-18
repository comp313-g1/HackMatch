-- Migration: 0016_alter_event_availability_for_platform_pool.sql
-- Description: Seeds the platform-wide canonical availability pool event and adds preferences columns to event_availability.

-- 1. Seed deterministic platform availability pool event so event_availability works without client eventId (US-011)
INSERT INTO events (
  id,
  title,
  official_url,
  normalized_url,
  start_date,
  end_date,
  format,
  status
) VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'Platform Availability Pool',
  'https://hackmatch.internal/events/platform-availability-pool',
  'https://hackmatch.internal/events/platform-availability-pool',
  '2026-01-01T00:00:00Z'::timestamptz,
  '2099-12-31T23:59:59Z'::timestamptz,
  'Online',
  'Published'
)
ON CONFLICT (id) DO NOTHING;

-- 2. Alter event_availability table to support platform pool default and preferences
ALTER TABLE event_availability
  ALTER COLUMN event_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN IF NOT EXISTS desired_role VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS commitment_hours NUMERIC(4,1) NULL,
  ADD COLUMN IF NOT EXISTS goal VARCHAR(30) NULL;

-- 3. Check constraints for availability preferences
ALTER TABLE event_availability
  DROP CONSTRAINT IF EXISTS chk_event_availability_desired_role,
  ADD CONSTRAINT chk_event_availability_desired_role
    CHECK (
      desired_role IS NULL
      OR desired_role IN ('Frontend', 'Backend', 'Mobile', 'AI/ML', 'UI/UX', 'Pitch')
    ),
  DROP CONSTRAINT IF EXISTS chk_event_availability_commitment_hours,
  ADD CONSTRAINT chk_event_availability_commitment_hours
    CHECK (
      commitment_hours IS NULL
      OR (commitment_hours >= 0 AND commitment_hours <= 168.0)
    ),
  DROP CONSTRAINT IF EXISTS chk_event_availability_goal,
  ADD CONSTRAINT chk_event_availability_goal
    CHECK (
      goal IS NULL
      OR goal IN ('Learning', 'Project Completion', 'Competitive')
    );
