import { describe, it, expect } from 'vitest';
import {
  CHAT_CHANNEL_TYPES,
  isChatChannelType,
  isPublicChatChannel,
  validateChatChannelLinkage,
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

describe('chat channel linkage (US-031 / #378)', () => {
  const TEAM = '123e4567-e89b-42d3-a456-426614174000';

  it('knows exactly two channel types', () => {
    expect([...CHAT_CHANNEL_TYPES]).toEqual(['public', 'team']);
    expect(isChatChannelType('public')).toBe(true);
    expect(isChatChannelType('team')).toBe(true);
  });

  it.each(['private', 'PUBLIC', 'Team', '', ' team', null, undefined, 1, {}])('rejects channel type %j', (value) => {
    expect(isChatChannelType(value)).toBe(false);
  });

  describe('validateChatChannelLinkage mirrors the database rule', () => {
    it('accepts a public channel with no team', () => {
      expect(validateChatChannelLinkage({ channelType: 'public' })).toBeNull();
      expect(validateChatChannelLinkage({ channelType: 'public', teamId: null })).toBeNull();
    });

    it('accepts a team channel with a valid team id', () => {
      expect(validateChatChannelLinkage({ channelType: 'team', teamId: TEAM })).toBeNull();
      expect(validateChatChannelLinkage({ channelType: 'team', teamId: TEAM.toUpperCase() })).toBeNull();
    });

    it.each([undefined, null])('requires a team id for a team channel (%j)', (teamId) => {
      expect(validateChatChannelLinkage({ channelType: 'team', teamId })).toBe('TEAM_ID_REQUIRED');
    });

    it('refuses a team id on a public channel', () => {
      expect(validateChatChannelLinkage({ channelType: 'public', teamId: TEAM })).toBe('TEAM_ID_NOT_ALLOWED');
    });

    it.each(['', 'not-a-uuid', '123', TEAM.slice(0, -1), `${TEAM}0`, '00000000-0000-0000-0000-000000000000', ' ' + TEAM])(
      'refuses a malformed team id %j',
      (teamId) => {
        expect(validateChatChannelLinkage({ channelType: 'team', teamId })).toBe('INVALID_TEAM_ID');
      }
    );

    it.each(['private', '', null, undefined, 'TEAM'])('refuses an unknown channel type %j', (channelType) => {
      expect(validateChatChannelLinkage({ channelType, teamId: TEAM })).toBe('INVALID_CHANNEL_TYPE');
      expect(validateChatChannelLinkage({ channelType })).toBe('INVALID_CHANNEL_TYPE');
    });
  });

  describe('isPublicChatChannel fails closed', () => {
    it('is true only for an explicit public channel', () => {
      expect(isPublicChatChannel({ channel_type: 'public' })).toBe(true);
    });

    it.each(['team', 'private', '', null, undefined, 'PUBLIC'])('is false for %j', (channel_type) => {
      expect(isPublicChatChannel({ channel_type })).toBe(false);
    });

    it('is false for a row that has no channel_type at all', () => {
      expect(isPublicChatChannel({})).toBe(false);
    });
  });
});
