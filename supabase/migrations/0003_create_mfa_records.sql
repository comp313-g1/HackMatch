-- Migration: 0003_create_mfa_records.sql
-- Description: Creates mfa_challenges and mfa_attempts tables for US-004 email-based 2FA,
-- attaches updated_at trigger, enforces state constraints and indexes, and enables RLS.

-- 1. MFA Challenges Table
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mfa_challenges_state CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);

-- 2. MFA Attempts Table
CREATE TABLE IF NOT EXISTS mfa_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES mfa_challenges(id) ON DELETE SET NULL,
  success BOOLEAN NOT NULL,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Row Level Security (Explicitly enabled with zero public policies)
ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_attempts ENABLE ROW LEVEL SECURITY;

-- 4. Indexes
-- Index for rate-limiting queries on challenges (FR-081)
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_participant_created ON mfa_challenges(participant_id, created_at DESC);

-- Index for locating active unexpired challenges
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_active ON mfa_challenges(participant_id, expires_at);

-- Index for querying recent attempts and lockout audits (FR-010)
CREATE INDEX IF NOT EXISTS idx_mfa_attempts_participant_created ON mfa_attempts(participant_id, created_at DESC);

-- 5. Trigger for updated_at on mfa_challenges
DROP TRIGGER IF EXISTS trigger_mfa_challenges_updated_at ON mfa_challenges;
CREATE TRIGGER trigger_mfa_challenges_updated_at
  BEFORE UPDATE ON mfa_challenges
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
