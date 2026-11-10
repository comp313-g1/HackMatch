-- Migration: 0057_connect_chat_message_reports.sql
-- Description: US-033 / #395 / FR-092 — allow US-025 participant reports to target
-- a visible chat_messages row and enter the existing US-026 moderation-case pipeline.
--
-- The target remains polymorphic: target_type = 'chat_message' resolves target_id against
-- chat_messages. No physical foreign key is added. Public messages are reportable by an
-- eligible PART; private team messages additionally require a current Confirmed membership
-- in the channel's persisted team. Direct messages remain outside this target contract because
-- they use direct_messages and are not resolvable by the #392/#394 chat_message evidence path.

ALTER TABLE moderation_reports
  DROP CONSTRAINT IF EXISTS moderation_reports_target_type_check;

ALTER TABLE moderation_reports
  ADD CONSTRAINT moderation_reports_target_type_check
  CHECK (target_type IN ('team', 'profile', 'event', 'url', 'chat_message'));

CREATE OR REPLACE FUNCTION validate_moderation_report_target()
RETURNS TRIGGER AS $$
DECLARE
  v_reporter_role VARCHAR(20);
  v_reporter_verified BOOLEAN;
  v_reporter_suspended BOOLEAN;
  v_reporter_deactivated BOOLEAN;
  v_target_exists BOOLEAN := FALSE;
BEGIN
  SELECT role,
         COALESCE(is_verified, FALSE),
         COALESCE(is_suspended, FALSE),
         COALESCE(is_deactivated, FALSE)
    INTO v_reporter_role,
         v_reporter_verified,
         v_reporter_suspended,
         v_reporter_deactivated
    FROM participants
   WHERE id = NEW.reporter_id;

  IF v_reporter_role IS NULL OR v_reporter_role <> 'PART' THEN
    RAISE EXCEPTION 'Reporter must be a valid PART account';
  END IF;

  IF v_reporter_suspended OR v_reporter_deactivated THEN
    RAISE EXCEPTION 'Suspended or deactivated accounts cannot submit moderation reports';
  END IF;

  IF NEW.target_type = 'team' THEN
    SELECT EXISTS (
      SELECT 1 FROM teams
       WHERE id = NEW.target_id
         AND COALESCE(moderation_status, 'None') <> 'Hidden'
         AND recruitment_status <> 'Disbanded'
    ) INTO v_target_exists;
  ELSIF NEW.target_type = 'profile' THEN
    IF NEW.target_id = NEW.reporter_id THEN
      RAISE EXCEPTION 'SELF_REPORT_FORBIDDEN: Participants cannot report their own profile';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM participants p
       LEFT JOIN participant_profiles pp ON pp.participant_id = p.id
       WHERE p.id = NEW.target_id
         AND p.role = 'PART'
         AND COALESCE(p.is_suspended, FALSE) = FALSE
         AND COALESCE(p.is_deactivated, FALSE) = FALSE
         AND COALESCE(pp.moderation_status, 'None') <> 'Hidden'
    ) INTO v_target_exists;
  ELSIF NEW.target_type = 'event' THEN
    SELECT EXISTS (
      SELECT 1 FROM events
       WHERE id = NEW.target_id
         AND status = 'Published'
    ) INTO v_target_exists;
  ELSIF NEW.target_type = 'url' THEN
    SELECT (
      EXISTS (
        SELECT 1 FROM teams
         WHERE id = NEW.target_id
           AND COALESCE(moderation_status, 'None') <> 'Hidden'
           AND recruitment_status <> 'Disbanded'
      )
      OR EXISTS (
        SELECT 1 FROM participants p
         LEFT JOIN participant_profiles pp ON pp.participant_id = p.id
         WHERE p.id = NEW.target_id
           AND p.role = 'PART'
           AND COALESCE(p.is_suspended, FALSE) = FALSE
           AND COALESCE(p.is_deactivated, FALSE) = FALSE
           AND COALESCE(pp.moderation_status, 'None') <> 'Hidden'
      )
      OR EXISTS (
        SELECT 1 FROM events
         WHERE id = NEW.target_id
           AND status = 'Published'
      )
    ) INTO v_target_exists;
  ELSIF NEW.target_type = 'chat_message' THEN
    IF NOT v_reporter_verified THEN
      RAISE EXCEPTION 'Reporter must be a verified PART account';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM chat_messages cm
        JOIN chat_channels cc ON cc.id = cm.channel_id
       WHERE cm.id = NEW.target_id
         AND (
           cc.channel_type = 'public'
           OR (
             cc.channel_type = 'team'
             AND cc.team_id IS NOT NULL
             AND EXISTS (
               SELECT 1
                 FROM team_memberships tm
                WHERE tm.team_id = cc.team_id
                  AND tm.participant_id = NEW.reporter_id
                  AND tm.status = 'Confirmed'
             )
           )
         )
    ) INTO v_target_exists;
  END IF;

  IF NOT v_target_exists THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND: Moderation report target does not exist or is not eligible for reporting';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN moderation_reports.target_type IS
  'Polymorphic participant-report target. chat_message resolves only to chat_messages through visibility-aware validation; target_id intentionally has no polymorphic foreign key.';
