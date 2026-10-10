-- Migration: 0004_create_profile_tables.sql
-- Description: Creates participant_profiles, participant_skills, and participant_portfolios tables,
-- attaches updated_at triggers, enforces role constraints and HTTPS checks, and enables RLS.

-- 1. Helper trigger function to prevent creating profiles for ADMIN accounts
CREATE OR REPLACE FUNCTION check_participant_profile_role()
RETURNS TRIGGER AS $$
DECLARE
  v_role VARCHAR(10);
BEGIN
  SELECT role INTO v_role FROM participants WHERE id = NEW.participant_id;
  IF v_role = 'ADMIN' THEN
    RAISE EXCEPTION 'ADMIN accounts cannot have a participant profile';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Participant Profiles Table
CREATE TABLE IF NOT EXISTS participant_profiles (
  participant_id UUID PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  handle VARCHAR(50),
  primary_role VARCHAR(20) CHECK (primary_role IN ('Frontend', 'Backend', 'Mobile', 'AI/ML', 'UI/UX', 'Pitch')),
  institution VARCHAR(150),
  shared_contact_handle VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Participant Skills Table
CREATE TABLE IF NOT EXISTS participant_skills (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  skill_name VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Participant Portfolios Table
CREATE TABLE IF NOT EXISTS participant_portfolios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  url VARCHAR(2048) NOT NULL CHECK (url LIKE 'https://%' AND LENGTH(url) > 8),
  label VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Row Level Security (Explicitly enabled with zero public policies)
ALTER TABLE participant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_portfolios ENABLE ROW LEVEL SECURITY;

-- 6. Indexes
-- Case-insensitive unique handle index (ignoring NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_profiles_handle_lower ON participant_profiles(LOWER(handle)) WHERE handle IS NOT NULL;

-- Prevent duplicate skills per participant
CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_skills_participant_skill_lower ON participant_skills(participant_id, LOWER(skill_name));

-- Lookup index for rule-based matching and candidate search by skill (FR-040, FR-044)
CREATE INDEX IF NOT EXISTS idx_participant_skills_name_lower ON participant_skills(LOWER(skill_name));

-- Portfolio lookup index
CREATE INDEX IF NOT EXISTS idx_participant_portfolios_participant_id ON participant_portfolios(participant_id);

-- 7. Triggers
-- Updated at triggers
DROP TRIGGER IF EXISTS trigger_participant_profiles_updated_at ON participant_profiles;
CREATE TRIGGER trigger_participant_profiles_updated_at
  BEFORE UPDATE ON participant_profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trigger_participant_portfolios_updated_at ON participant_portfolios;
CREATE TRIGGER trigger_participant_portfolios_updated_at
  BEFORE UPDATE ON participant_portfolios
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Block ADMIN profile trigger
DROP TRIGGER IF EXISTS trigger_check_participant_profile_role ON participant_profiles;
CREATE TRIGGER trigger_check_participant_profile_role
  BEFORE INSERT OR UPDATE ON participant_profiles
  FOR EACH ROW
  EXECUTE FUNCTION check_participant_profile_role();
