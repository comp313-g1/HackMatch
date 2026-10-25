import { describe, it, expect } from 'vitest';
import {
  CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH,
  CHAT_CHANNEL_TITLE_MAX_LENGTH,
  CHAT_MESSAGE_BODY_MAX_LENGTH,
  isChatDescriptionTooLong,
  isChatMessageBodyTooLong,
  isChatTitleTooLong,
  normalizeChatDescription,
  normalizeChatMessageBody,
  normalizeChatTitle,
} from './chatModel.js';

describe('chatModel (US-030 / #342)', () => {
  it('normalizes blank title/description/body to null', () => {
    expect(normalizeChatTitle('   ')).toBeNull();
    expect(normalizeChatDescription('\n\t')).toBeNull();
    expect(normalizeChatMessageBody('')).toBeNull();
  });

  it('trims valid title, description, and body', () => {
    expect(normalizeChatTitle('  General  ')).toBe('General');
    expect(normalizeChatDescription('  Team sync notes  ')).toBe('Team sync notes');
    expect(normalizeChatMessageBody('  hello  ')).toBe('hello');
  });

  it('rejects over-length title, description, and body', () => {
    expect(isChatTitleTooLong('a'.repeat(CHAT_CHANNEL_TITLE_MAX_LENGTH + 1))).toBe(
      true
    );
    expect(
      isChatDescriptionTooLong('b'.repeat(CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH + 1))
    ).toBe(true);
    expect(
      isChatMessageBodyTooLong('c'.repeat(CHAT_MESSAGE_BODY_MAX_LENGTH + 1))
    ).toBe(true);
  });

  it('accepts max-length fields', () => {
    expect(isChatTitleTooLong('a'.repeat(CHAT_CHANNEL_TITLE_MAX_LENGTH))).toBe(false);
    expect(
      isChatDescriptionTooLong('b'.repeat(CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH))
    ).toBe(false);
    expect(isChatMessageBodyTooLong('c'.repeat(CHAT_MESSAGE_BODY_MAX_LENGTH))).toBe(
      false
    );
  });
});
