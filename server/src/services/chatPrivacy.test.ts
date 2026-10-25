import { describe, it, expect } from 'vitest';
import {
  CHAT_PRIVACY_NOTICE,
  buildChatSuccessPayload,
  chatPrivacyFlags,
  isPrivateChatKey,
  publicPayloadHasPrivateChatKey,
  sanitizeSubmittedChatDraft,
  scrubPrivateChatFields,
} from './chatPrivacy.js';

describe('chatPrivacy (US-030 / #345 / FR-089)', () => {
  it('flags credentials, OTPs, emails, and firebase uid keys', () => {
    expect(isPrivateChatKey('password')).toBe(true);
    expect(isPrivateChatKey('otp_hash')).toBe(true);
    expect(isPrivateChatKey('otpCode')).toBe(true);
    expect(isPrivateChatKey('email')).toBe(true);
    expect(isPrivateChatKey('firebase_uid')).toBe(true);
    expect(isPrivateChatKey('firebaseUid')).toBe(true);
    expect(isPrivateChatKey('credentials')).toBe(true);
    expect(isPrivateChatKey('authorHandle')).toBe(false);
    expect(isPrivateChatKey('body')).toBe(false);
    expect(isPrivateChatKey('title')).toBe(false);
  });

  it('scrubs nested private fields while preserving handles and message content', () => {
    const scrubbed = scrubPrivateChatFields({
      status: 'ok',
      message: {
        id: '22222222-2222-4222-8222-222222222222',
        authorHandle: 'hacker1',
        body: 'Hello team',
        email: 'part@example.com',
        password: 'secret',
        otp_hash: 'abc',
        firebase_uid: 'fb-1',
      },
      author: {
        handle: 'hacker1',
        email: 'part@example.com',
        otpCode: '123456',
      },
    });

    expect(scrubbed).toEqual({
      status: 'ok',
      message: {
        id: '22222222-2222-4222-8222-222222222222',
        authorHandle: 'hacker1',
        body: 'Hello team',
      },
      author: {
        handle: 'hacker1',
      },
    });
    expect(publicPayloadHasPrivateChatKey(scrubbed)).toBe(false);
  });

  it('redacts sensitive keys from submitted chat drafts', () => {
    expect(
      sanitizeSubmittedChatDraft({
        title: 'General',
        description: 'Forum',
        email: 'part@example.com',
        password: 'Password123!',
        otp: '123456',
      })
    ).toEqual({
      title: 'General',
      description: 'Forum',
      email: '[redacted]',
      password: '[redacted]',
      otp: '[redacted]',
    });
  });

  it('builds success payloads with privacy flags and scrubbed data', () => {
    const payload = buildChatSuccessPayload({
      status: 'ok',
      channel: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'General',
        email: 'leak@example.com',
      },
    });

    expect(payload.privacy).toEqual(chatPrivacyFlags());
    expect(payload.privacy.notice).toBe(CHAT_PRIVACY_NOTICE);
    expect(payload.privacy.emailsIncluded).toBe(false);
    expect(payload.privacy.credentialsIncluded).toBe(false);
    expect(payload.privacy.otpsIncluded).toBe(false);
    expect(payload.channel).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'General',
    });
    expect(publicPayloadHasPrivateChatKey(payload)).toBe(false);
  });
});
