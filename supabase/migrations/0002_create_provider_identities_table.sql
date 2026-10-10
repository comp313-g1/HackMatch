-- Migration: 0002_create_provider_identities_table.sql
-- Description: Creates provider_identities table for federated OAuth accounts,
-- enforces unique constraints, cascades deletion from participants, blocks ADMIN account linking,
-- attaches updated_at trigger, and enables RLS.

-- 1. Helper trigger function to prevent linking OAuth identities to ADMIN accounts
CREATE OR REPLACE FUNCTION check_provider_identity_participant_role()
RETURNS TRIGGER AS $$
DECLARE
  v_role VARCHAR(10);
BEGIN
  SELECT role INTO v_role FROM participants WHERE id = NEW.participant_id;
  IF v_role = 'ADMIN' THEN
    RAISE EXCEPTION 'Public OAuth cannot link to an ADMIN account';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Provider Identities Table
CREATE TABLE IF NOT EXISTS provider_identities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('google', 'github', 'google.com', 'github.com')),
  provider_uid VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  provider_handle VARCHAR(100),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Row Level Security (Explicitly enabled with zero public policies to deny PostgREST anon access)
ALTER TABLE provider_identities ENABLE ROW LEVEL SECURITY;

-- 4. Indexes and Constraints
-- Ensure an external OAuth provider identity is linked to at most one participant
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_identities_provider_uid ON provider_identities(provider, provider_uid);

-- Ensure a participant links at most one identity per OAuth provider
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_identities_participant_provider ON provider_identities(participant_id, provider);

-- Lookup index on participant_id
CREATE INDEX IF NOT EXISTS idx_provider_identities_participant_id ON provider_identities(participant_id);

-- Lookup index on case-insensitive email
CREATE INDEX IF NOT EXISTS idx_provider_identities_email_lower ON provider_identities(LOWER(email));

-- 5. Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_provider_identities_updated_at ON provider_identities;
CREATE TRIGGER trigger_provider_identities_updated_at
  BEFORE UPDATE ON provider_identities
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 6. Trigger to block ADMIN linking
DROP TRIGGER IF EXISTS trigger_check_provider_identity_role ON provider_identities;
CREATE TRIGGER trigger_check_provider_identity_role
  BEFORE INSERT OR UPDATE ON provider_identities
  FOR EACH ROW
  EXECUTE FUNCTION check_provider_identity_participant_role();
