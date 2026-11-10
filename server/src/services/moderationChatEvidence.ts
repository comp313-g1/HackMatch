import { moderationTargetRepository } from '../db/moderationTarget.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { scrubPrivateModerationFields } from './moderationPrivacy.js';

/** A deliberately small evidence window; the rest of the conversation is never queried. */
export const MODERATION_MESSAGE_CONTEXT_MAX_LENGTH = 500;

export interface RedactedModerationText {
  text: string;
  redacted: boolean;
  truncated: boolean;
}

interface AvailableChatChannelEvidence {
  id: string;
  availability: 'Available';
  channelType: 'public' | 'team';
  title: string;
  description: string;
  creatorHandle: string | null;
  createdAt: string;
  contentRedacted: boolean;
}

interface UnavailableChatChannelEvidence {
  id: string;
  availability: 'Unavailable';
}

interface AvailableChatMessageEvidence {
  id: string;
  availability: 'Available';
  authorHandle: string | null;
  createdAt: string;
  messageContext: RedactedModerationText;
}

interface UnavailableChatMessageEvidence {
  id: string;
  availability: 'Unavailable';
}

export interface SanitizedChatChannelTarget {
  type: 'chat_channel';
  chatChannel: AvailableChatChannelEvidence | UnavailableChatChannelEvidence;
}

export interface SanitizedChatMessageTarget {
  type: 'chat_message';
  chatMessage: AvailableChatMessageEvidence | UnavailableChatMessageEvidence;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PEM_PATTERN = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|refresh_token|id_token|token|session|otp|code|api_key)=)[^&#\s]*/gi;
const LABELED_SECRET_PATTERN =
  /\b(password|passwd|pwd|otp(?:[ _-]?(?:code|hash|token))?|passcode|token|access[ _-]?token|refresh[ _-]?token|id[ _-]?token|session(?:[ _-]?token)?|api[ _-]?key|secret|credential)(?:\s*[:=]\s*|\s+)[^\s,;]+/gi;
const SIX_DIGIT_CODE_PATTERN = /(^|\D)\d{6}(?=\D|$)/g;
const LONG_SECRET_PATTERN = /\b[A-Za-z0-9_+/-]{32,}={0,2}\b/g;

/**
 * Redacts common credential material inside user-authored chat text, then returns only a bounded
 * excerpt. This is intentionally separate from key scrubbing because secrets may occur in text.
 */
export function redactModerationText(
  value: string,
  maxLength = MODERATION_MESSAGE_CONTEXT_MAX_LENGTH
): RedactedModerationText {
  let text = value;
  let redacted = false;

  const replace = (pattern: RegExp, replacement: string | ((capture: string) => string)) => {
    text = text.replace(pattern, (_match: string, capture?: string) => {
      redacted = true;
      return typeof replacement === 'string' ? replacement : replacement(capture ?? '');
    });
  };

  replace(PEM_PATTERN, '[redacted credential]');
  replace(EMAIL_PATTERN, '[redacted email]');
  replace(BEARER_PATTERN, 'Bearer [redacted token]');
  replace(JWT_PATTERN, '[redacted token]');
  replace(SENSITIVE_QUERY_PATTERN, (prefix) => `${prefix}[redacted]`);
  replace(LABELED_SECRET_PATTERN, (label) => `${label}: [redacted]`);
  replace(SIX_DIGIT_CODE_PATTERN, (prefix) => `${prefix}[redacted code]`);
  replace(LONG_SECRET_PATTERN, '[redacted token]');

  const characters = Array.from(text);
  const truncated = characters.length > maxLength;
  if (truncated) {
    text = `${characters.slice(0, maxLength).join('')}…`;
  }

  return { text, redacted, truncated };
}

function toUtcTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('Invalid chat evidence timestamp.');
  }
  return parsed.toISOString();
}

export async function loadChatChannelEvidence(
  targetId: string
): Promise<SanitizedChatChannelTarget> {
  const record = await moderationTargetRepository.findChatChannelEvidence(targetId);
  if (!record) {
    return { type: 'chat_channel', chatChannel: { id: targetId, availability: 'Unavailable' } };
  }

  const profile = await profileRepository.findProfileByParticipantId(record.created_by);
  const title = redactModerationText(record.title, 120);
  const description = redactModerationText(record.description);

  return scrubPrivateModerationFields({
    type: 'chat_channel',
    chatChannel: {
      id: record.id,
      availability: 'Available',
      channelType: record.channel_type,
      title: title.text,
      description: description.text,
      creatorHandle: profile?.handle ?? null,
      createdAt: toUtcTimestamp(record.created_at),
      contentRedacted: title.redacted || description.redacted,
    },
  });
}

export async function loadChatMessageEvidence(
  targetId: string
): Promise<SanitizedChatMessageTarget> {
  const record = await moderationTargetRepository.findChatMessageEvidence(targetId);
  if (!record) {
    return { type: 'chat_message', chatMessage: { id: targetId, availability: 'Unavailable' } };
  }

  const profile = await profileRepository.findProfileByParticipantId(record.author_id);
  return scrubPrivateModerationFields({
    type: 'chat_message',
    chatMessage: {
      id: record.id,
      availability: 'Available',
      authorHandle: profile?.handle ?? null,
      createdAt: toUtcTimestamp(record.created_at),
      messageContext: redactModerationText(record.body),
    },
  });
}
