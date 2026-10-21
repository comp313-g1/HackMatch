-- Migration: 0039_account_enforcement_models.sql
-- Description: US-027 / #249 — suspension, deactivation, and ownership-verified
-- deletion-request data models. Enforcement APIs and cascades ship in later tasks.
-- Policy: deletion target_completion_at defaults to created_at + 30 days (proposed
-- product service target; retention policy R-06 remains open).

-- ---------------------------------------------------------------------------
-- 1. Participant suspension / deactivation state (extends 0010)
-- ---------------------------------------------------------------------------

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS suspended_by UUID NULL REFERENCES participants(id) ON DELETE SET NULL;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT NULL;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS is_deactivated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS deactivated_by UUID NULL REFERENCES participants(id) ON DELETE SET NULL;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT NULL;

-- Backfill legacy suspended rows (0010) so new checks can be applied safely.
UPDATE participants
SET
  suspended_at = COALESCE(suspended_at, NOW()),
  suspension_reason = COALESCE(NULLIF(TRIM(suspension_reason), ''), 'Legacy suspension record')
WHERE is_suspended = TRUE
  AND (suspended_at IS NULL OR suspension_reason IS NULL OR LENGTH(TRIM(suspension_reason)) = 0);

-- Suspended accounts must carry a timestamp and non-empty reason; cleared when active.
ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS chk_participants_suspension_fields;

ALTER TABLE participants
  ADD CONSTRAINT chk_participants_suspension_fields CHECK (
    (
      is_suspended = FALSE
      AND suspended_at IS NULL
      AND suspended_by IS NULL
      AND suspension_reason IS NULL
    )
    OR (
      is_suspended = TRUE
      AND suspended_at IS NOT NULL
      AND suspension_reason IS NOT NULL
      AND LENGTH(TRIM(suspension_reason)) > 0
      AND LENGTH(suspension_reason) <= 2000
    )
  );

ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS chk_participants_deactivation_fields;

ALTER TABLE participants
  ADD CONSTRAINT chk_participants_deactivation_fields CHECK (
    (
      is_deactivated = FALSE
      AND deactivated_at IS NULL
      AND deactivated_by IS NULL
      AND deactivation_reason IS NULL
    )
    OR (
      is_deactivated = TRUE
      AND deactivated_at IS NOT NULL
      AND deactivation_reason IS NOT NULL
      AND LENGTH(TRIM(deactivation_reason)) > 0
      AND LENGTH(deactivation_reason) <= 2000
    )
  );

-- Deactivated accounts are also treated as suspended for sign-in blocking.
ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS chk_participants_deactivated_implies_suspended;

ALTER TABLE participants
  ADD CONSTRAINT chk_participants_deactivated_implies_suspended CHECK (
    is_deactivated = FALSE OR is_suspended = TRUE
  );

CREATE INDEX IF NOT EXISTS idx_participants_is_deactivated
  ON participants(is_deactivated)
  WHERE is_deactivated = TRUE;

CREATE INDEX IF NOT EXISTS idx_participants_suspended_by
  ON participants(suspended_by)
  WHERE suspended_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_participants_deactivated_by
  ON participants(deactivated_by)
  WHERE deactivated_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Ownership-verified account deletion requests (US-027 AC 3)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_account_deletion_request_admin_actor()
RETURNS TRIGGER AS $$
DECLARE
  v_role VARCHAR(10);
BEGIN
  SELECT role INTO v_role FROM participants WHERE id = NEW.requested_by;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Deletion request actor not found in participants';
  ELSIF v_role != 'ADMIN' THEN
    RAISE EXCEPTION 'Deletion requests may only be created by ADMIN actors';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_account_deletion_target_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- Proposed 30-day processing target from request creation (US-027 AC 3).
  IF NEW.target_completion_at IS NULL THEN
    NEW.target_completion_at := COALESCE(NEW.created_at, NOW()) + INTERVAL '30 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (
    LENGTH(TRIM(reason)) > 0 AND LENGTH(reason) <= 2000
  ),
  status VARCHAR(32) NOT NULL DEFAULT 'Pending' CHECK (
    status IN (
      'Pending',
      'BlockedNeedsDisband',
      'Processing',
      'Completed',
      'Canceled'
    )
  ),
  -- Ownership verification required before live PII processing (AC 3).
  ownership_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ownership_verified_at TIMESTAMPTZ NULL,
  ownership_verified_by UUID NULL REFERENCES participants(id) ON DELETE SET NULL,
  -- Unlocked team owner must disband before deletion can proceed.
  blocked_reason TEXT NULL CHECK (
    blocked_reason IS NULL
    OR (LENGTH(TRIM(blocked_reason)) > 0 AND LENGTH(blocked_reason) <= 2000)
  ),
  target_completion_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  completed_at TIMESTAMPTZ NULL,
  -- Safe summary only — no credentials / OTPs / private notes (FR-079).
  safe_state_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_account_deletion_ownership_verified_fields CHECK (
    (
      ownership_verified = FALSE
      AND ownership_verified_at IS NULL
      AND ownership_verified_by IS NULL
    )
    OR (
      ownership_verified = TRUE
      AND ownership_verified_at IS NOT NULL
      AND ownership_verified_by IS NOT NULL
    )
  ),
  CONSTRAINT chk_account_deletion_completed_fields CHECK (
    (status <> 'Completed' AND completed_at IS NULL)
    OR (status = 'Completed' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT chk_account_deletion_blocked_fields CHECK (
    (status <> 'BlockedNeedsDisband' AND blocked_reason IS NULL)
    OR (status = 'BlockedNeedsDisband' AND blocked_reason IS NOT NULL)
  )
);

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- At most one in-flight deletion request per account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_requests_open_participant
  ON account_deletion_requests(participant_id)
  WHERE status IN ('Pending', 'BlockedNeedsDisband', 'Processing');

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_status_created_at
  ON account_deletion_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_participant_id
  ON account_deletion_requests(participant_id);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_requested_by
  ON account_deletion_requests(requested_by);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_target_completion_at
  ON account_deletion_requests(target_completion_at);

DROP TRIGGER IF EXISTS trigger_check_account_deletion_request_admin_actor
  ON account_deletion_requests;
CREATE TRIGGER trigger_check_account_deletion_request_admin_actor
  BEFORE INSERT ON account_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION check_account_deletion_request_admin_actor();

DROP TRIGGER IF EXISTS trigger_set_account_deletion_target_completion
  ON account_deletion_requests;
CREATE TRIGGER trigger_set_account_deletion_target_completion
  BEFORE INSERT ON account_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_account_deletion_target_completion();

DROP TRIGGER IF EXISTS trigger_account_deletion_requests_updated_at
  ON account_deletion_requests;
CREATE TRIGGER trigger_account_deletion_requests_updated_at
  BEFORE UPDATE ON account_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
