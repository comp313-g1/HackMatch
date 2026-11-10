-- Migration: 0050_enforce_audit_records_least_privilege.sql
-- Description: US-028 / #262 — read-only access and denial of record mutations for
-- event_action_records (FR-079, FR-080), as a least-privilege grant model.
--
-- Why: 0006 blocks UPDATE/DELETE/TRUNCATE with triggers and 0049 revoked those three
-- privileges, but every application role still held TRIGGER and REFERENCES (and anon /
-- authenticated still held SELECT and INSERT behind row-level security alone). TRIGGER lets
-- the holder attach its own BEFORE INSERT trigger to the audit table, which can silently
-- rewrite or block every FUTURE audit record without touching a single existing row.
--
-- After this migration:
--   service_role (the Express API)  -> SELECT, INSERT   (append and read; nothing else)
--   anon, authenticated, PUBLIC     -> no access of any kind (previously empty-by-RLS only)
--   table owner                     -> unchanged; UPDATE/DELETE/TRUNCATE still blocked by the
--                                      append-only triggers from 0006
-- Reads for administrators go through query_admin_audit_records() (0049), which re-verifies
-- the caller is an active ADMIN. Writers continue to work: INSERT ... RETURNING needs only
-- INSERT + SELECT. Additive, idempotent, and safe to re-run.

REVOKE ALL ON TABLE event_action_records
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE event_action_records
  TO service_role;

COMMENT ON TABLE event_action_records IS
  'FR-079 append-only administrative action records (event, moderation_*, account_*). Least privilege (0050): service_role may only SELECT and INSERT; no other role has any access. UPDATE/DELETE/TRUNCATE are also blocked by triggers (0006). Administrators read through query_admin_audit_records() (US-028).';
