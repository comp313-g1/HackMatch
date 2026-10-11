-- Migration: 0008_create_verification_guard_helpers.sql
-- Helper function for database-layer verification enforcement

CREATE OR REPLACE FUNCTION is_participant_verified(p_participant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT is_verified FROM participants WHERE id = p_participant_id),
    FALSE
  );
$$;

COMMENT ON FUNCTION is_participant_verified(UUID) IS 
  'Returns true if the participant exists and is marked is_verified=true; otherwise false. Used by RLS policies and table check constraints.';
