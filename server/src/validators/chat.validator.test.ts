import { describe, it, expect } from 'vitest';
import {
  CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH,
  CHAT_CHANNEL_TITLE_MAX_LENGTH,
  CHAT_MESSAGE_BODY_MAX_LENGTH,
} from '../db/chatModel.js';
import {
  validateCreateChannelInput,
  validateMarkConversationReadInput,
  validateSendMessageInput,
} from './chat.validator.js';

describe('chat.validator (US-030 / #344 / #347 / FR-087–FR-088)', () => {
  it('accepts a valid create-channel payload', () => {
    const result = validateCreateChannelInput({
      title: '  General  ',
      description: '  Open forum  ',
    });
    expect(result.errors).toEqual({});
    expect(result.sanitized).toEqual({
      title: 'General',
      description: 'Open forum',
    });
  });

  it('rejects blank title/description and echoes submitted draft', () => {
    const body = { title: '   ', description: '' };
    const result = validateCreateChannelInput(body);
    expect(result.sanitized).toBeNull();
    expect(result.errors.title).toBeTruthy();
    expect(result.errors.description).toBeTruthy();
    expect(result.submitted).toEqual(body);
  });

  it('rejects over-long title/description while keeping submitted draft', () => {
    const body = {
      title: 'a'.repeat(CHAT_CHANNEL_TITLE_MAX_LENGTH + 1),
      description: 'b'.repeat(CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH + 1),
    };
    const result = validateCreateChannelInput(body);
    expect(result.sanitized).toBeNull();
    expect(result.errors.title).toMatch(/at most/i);
    expect(result.errors.description).toMatch(/at most/i);
    expect(result.submitted).toEqual(body);
  });

  it('accepts a valid send-message payload', () => {
    const result = validateSendMessageInput({ body: '  hello  ' });
    expect(result.sanitized).toEqual({ body: 'hello' });
  });

  it('rejects blank message body and echoes submitted draft', () => {
    const body = { body: '   ' };
    const result = validateSendMessageInput(body);
    expect(result.sanitized).toBeNull();
    expect(result.errors.body).toBeTruthy();
    expect(result.submitted).toEqual(body);
  });

  it('rejects over-long message body while keeping submitted draft', () => {
    const body = { body: 'c'.repeat(CHAT_MESSAGE_BODY_MAX_LENGTH + 1) };
    const result = validateSendMessageInput(body);
    expect(result.sanitized).toBeNull();
    expect(result.errors.body).toMatch(/at most/i);
    expect(result.submitted).toEqual(body);
  });

  it('accepts the canonical mark-read conversation types and UUIDs', () => {
    expect(
      validateMarkConversationReadInput({
        conversationType: 'channel',
        conversationId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
        messageId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
      })
    ).toEqual({
      errors: {},
      sanitized: {
        conversationType: 'channel',
        conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        messageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    });
    expect(
      validateMarkConversationReadInput({
        conversationType: 'directMessage',
        conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        messageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }).errors
    ).toEqual({});
  });

  it('rejects malformed, unsupported, missing, and extra mark-read fields', () => {
    const result = validateMarkConversationReadInput({
      conversationType: 'team',
      conversationId: 'not-a-uuid',
      extra: true,
    });
    expect(result.sanitized).toBeNull();
    expect(result.errors).toMatchObject({
      conversationType: expect.any(String),
      conversationId: expect.any(String),
      messageId: expect.any(String),
      extra: expect.any(String),
    });
  });
});
