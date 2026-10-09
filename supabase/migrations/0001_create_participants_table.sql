-- Migration: 0001_create_participants_table.sql
-- Description: Creates participants table, indexes, updated_at trigger, and enables RLS

-- 1. Helper trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Participants Table
CREATE TABLE IF NOT EXISTS participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  firebase_uid VARCHAR(128) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'PART' CHECK (role IN ('PART', 'ADMIN')),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Row Level Security (Explicitly enabled with zero public policies to deny PostgREST anon access)
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_participants_firebase_uid ON participants(firebase_uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_email_lower ON participants(LOWER(email));

-- 5. Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_participants_updated_at ON participants;
CREATE TRIGGER trigger_participants_updated_at
  BEFORE UPDATE ON participants
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
