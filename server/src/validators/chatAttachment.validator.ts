import { ATTACHMENTS_PER_MESSAGE_MAX } from '../db/chatAttachmentModel.js';
import { UUID_REGEX } from './team.validator.js';

/**
 * US-035 / #409 — the optional `attachmentIds` field of a message send: up to 5
 * distinct upload ids. Returns the lowercased ids (an empty list means "none"),
 * or an error message. The ids are only claims: the database checks that each is
 * the sender's own pending upload for this exact conversation.
 */
export function parseAttachmentIds(value: unknown): { ids: string[] } | { error: string } {
  if (value === undefined) return { ids: [] };
  if (!Array.isArray(value)) return { error: 'attachmentIds must be a list of attachment ids.' };
  if (value.length > ATTACHMENTS_PER_MESSAGE_MAX) {
    return { error: `A message can have at most ${ATTACHMENTS_PER_MESSAGE_MAX} attachments.` };
  }
  if (!value.every((id) => typeof id === 'string' && UUID_REGEX.test(id))) {
    return { error: 'attachmentIds must contain valid attachment ids.' };
  }
  const ids = value.map((id: string) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) return { error: 'attachmentIds must not repeat an attachment.' };
  return { ids };
}
