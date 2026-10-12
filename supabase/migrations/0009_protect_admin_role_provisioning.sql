-- Migration: 0009_protect_admin_role_provisioning.sql
-- Helper function for authorized deployment operator admin provisioning

CREATE OR REPLACE FUNCTION provision_admin_participant(
  p_firebase_uid VARCHAR(128),
  p_email VARCHAR(255),
  p_full_name VARCHAR(100)
)
RETURNS SETOF participants
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO participants (firebase_uid, email, full_name, role, is_verified)
  VALUES (p_firebase_uid, p_email, p_full_name, 'ADMIN', TRUE)
  ON CONFLICT (firebase_uid) DO UPDATE
    SET role = 'ADMIN',
        is_verified = TRUE,
        updated_at = NOW()
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION provision_admin_participant(VARCHAR, VARCHAR, VARCHAR) IS
  'Provisions or promotes an account to ADMIN and returns the complete participant record. Strictly invoked by authorized deployment operator tooling.';
