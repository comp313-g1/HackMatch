import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { chatRepository } from '../db/chat.repository.js';
import { chatReadRepository } from '../db/chatRead.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

const mockVerifyIdToken = vi.fn();
vi.mock('../config/firebase.js', () => {
  const authMock = { verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

const participant: Participant = {
  id: '10000000-0000-4000-8000-000000000001',
  firebase_uid: 'fb-reader',
  email: 'reader@example.test',
  full_name: 'Reader',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
};
const channelId = '20000000-0000-4000-8000-000000000002';
const messageId = '30000000-0000-4000-8000-000000000003';
const authTime = Math.floor(Date.now() / 1000) - 30;
const auth = { Authorization: 'Bearer valid-mfa-token' };

describe('POST /api/chat/read (US-034 / #401)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      uid: participant.firebase_uid,
      role: 'PART',
      auth_time: authTime,
      [MFA_CLAIM]: authTime,
    } as unknown as DecodedIdToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
    vi.spyOn(chatRepository, 'findChannelById').mockResolvedValue({
      id: channelId,
      title: 'General',
      description: 'Public forum',
      created_by: participant.id,
      channel_type: 'public',
      team_id: null,
      created_at: '2026-11-10T10:00:00.000Z',
      updated_at: '2026-11-10T10:00:00.000Z',
    });
    vi.spyOn(chatReadRepository, 'markRead').mockResolvedValue({
      conversation_type: 'channel',
      conversation_id: channelId,
      last_read_message_id: messageId,
      last_read_message_created_at: '2026-11-10T12:00:00.000Z',
      advanced: true,
      unread_count: 1,
      unread_mention_count: 0,
    });
  });

  it('returns a no-store privacy-safe cursor and fresh counts', async () => {
    const response = await request(app).post('/api/chat/read').set(auth).send({
      conversationType: 'channel',
      conversationId: channelId,
      messageId,
    });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      status: 'ok',
      conversationType: 'channel',
      conversationId: channelId,
      readCursor: { messageId, createdAt: '2026-11-10T12:00:00.000Z' },
      advanced: true,
      unreadCount: 1,
      unreadMentionCount: 0,
      privacy: {
        credentialsIncluded: false,
        otpsIncluded: false,
        emailsIncluded: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/reader@example|message body|token/i);
  });

  it('rejects malformed input before authorization or persistence', async () => {
    const response = await request(app).post('/api/chat/read').set(auth).send({
      conversationType: 'unknown',
      conversationId: 'bad',
      messageId: 'bad',
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(chatRepository.findChannelById).not.toHaveBeenCalled();
    expect(chatReadRepository.markRead).not.toHaveBeenCalled();
  });

  it('denies visitors before reading conversation or cursor state', async () => {
    const response = await request(app).post('/api/chat/read').send({
      conversationType: 'channel',
      conversationId: channelId,
      messageId,
    });
    expect(response.status).toBe(401);
    expect(chatRepository.findChannelById).not.toHaveBeenCalled();
    expect(chatReadRepository.markRead).not.toHaveBeenCalled();
  });

  it('returns safe stale-position errors without leaking storage details', async () => {
    vi.mocked(chatReadRepository.markRead).mockRejectedValue(
      new Error('CHAT_MARK_READ_POSITION_NOT_FOUND private row detail')
    );
    const response = await request(app).post('/api/chat/read').set(auth).send({
      conversationType: 'channel',
      conversationId: channelId,
      messageId,
    });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'The requested read position is unavailable.',
      code: 'CHAT_READ_POSITION_NOT_FOUND',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/private row|reader@example/i);
  });
});
