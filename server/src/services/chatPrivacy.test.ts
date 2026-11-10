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

  describe('team-chat privacy scrubbing (US-031 / #384 / FR-089 & FR-090)', () => {
    it.each([
      'shared_contact_handle',
      'sharedContactHandle',
      'private_note',
      'workspace_notes',
      'workspaceNote',
      'team_notes',
      'teamNotes',
      'mfa_secret',
      'recovery_codes',
      'api_key',
    ])('identifies %s as a private chat key that must never leak', (key) => {
      expect(isPrivateChatKey(key)).toBe(true);
    });

    it.each(['teamId', 'channelType', 'channelId', 'authorId', 'authorHandle', 'body', 'createdAt'])(
      'permits safe team-chat projection field %s',
      (key) => {
        expect(isPrivateChatKey(key)).toBe(false);
      }
    );

    it('scrubs poisoned team channel and message payloads while keeping team linkage and author handles', () => {
      const poisonedPayload = {
        status: 'ok',
        channel: {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Team: Alpha Squad',
          description: 'Private team coordination channel',
          createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          channelType: 'team',
          teamId: '22222222-2222-4222-8222-222222222222',
          createdAt: '2026-11-09T20:00:00.000Z',
          updatedAt: '2026-11-09T20:00:00.000Z',
          email: 'owner@example.com',
          shared_contact_handle: '@secret_discord',
          workspace_notes: 'Internal note',
        },
        messages: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            channelId: '11111111-1111-4111-8111-111111111111',
            authorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            authorHandle: 'alpha_lead',
            body: 'Sprint tasks assigned',
            createdAt: '2026-11-09T20:05:00.000Z',
            email: 'owner@example.com',
            firebase_uid: 'fb-owner',
            password: 'HashPassword123',
            otp_hash: '998877',
            mfa_secret: 'totp-secret',
          },
        ],
      };

      expect(publicPayloadHasPrivateChatKey(poisonedPayload)).toBe(true);

      const safePayload = buildChatSuccessPayload(poisonedPayload);

      expect(publicPayloadHasPrivateChatKey(safePayload)).toBe(false);
      expect(safePayload.channel).toEqual({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Team: Alpha Squad',
        description: 'Private team coordination channel',
        createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        channelType: 'team',
        teamId: '22222222-2222-4222-8222-222222222222',
        createdAt: '2026-11-09T20:00:00.000Z',
        updatedAt: '2026-11-09T20:00:00.000Z',
      });
      expect(safePayload.messages).toEqual([
        {
          id: '33333333-3333-4333-8333-333333333333',
          channelId: '11111111-1111-4111-8111-111111111111',
          authorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          authorHandle: 'alpha_lead',
          body: 'Sprint tasks assigned',
          createdAt: '2026-11-09T20:05:00.000Z',
        },
      ]);
      expect(JSON.stringify(safePayload)).not.toMatch(
        /owner@example\.com|@secret_discord|Internal note|fb-owner|HashPassword123|998877|totp-secret/
      );
    });
  });
});
