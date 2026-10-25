import { describe, it, expect } from 'vitest';
import {
  CHAT_CHANNEL_DESCRIPTION_MAX_LENGTH,
  CHAT_CHANNEL_TITLE_MAX_LENGTH,
  CHAT_MESSAGE_BODY_MAX_LENGTH,
} from '../db/chatModel.js';
import {
  validateCreateChannelInput,
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
});
