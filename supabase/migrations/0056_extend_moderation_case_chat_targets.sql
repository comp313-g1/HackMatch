-- Migration: 0056_extend_moderation_case_chat_targets.sql
-- Description: US-033 / #392 / FR-092 — extend the existing polymorphic
-- moderation_cases target model to recognize chat channels and chat messages.
--
-- target_id deliberately remains a plain UUID. Its referenced table is selected
-- by target_type, so a physical foreign key to chat_channels or chat_messages
-- would be invalid for the other polymorphic target kinds. Express validates the
-- target against the matching table before creating a case.

ALTER TABLE moderation_cases
  DROP CONSTRAINT IF EXISTS moderation_cases_target_type_check;

ALTER TABLE moderation_cases
  ADD CONSTRAINT moderation_cases_target_type_check
  CHECK (
    target_type IN (
      'team',
      'profile',
      'event',
      'url',
      'chat_channel',
      'chat_message'
    )
  );

COMMENT ON COLUMN moderation_cases.target_type IS
  'Polymorphic target discriminator. chat_channel resolves to chat_channels; chat_message resolves to chat_messages. target_id intentionally has no polymorphic foreign key.';

COMMENT ON COLUMN moderation_cases.target_id IS
  'Polymorphic target UUID resolved by target_type in the application service; only created_by has a physical participant foreign key.';
