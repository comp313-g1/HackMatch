import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { chatUnreadRepository } from '../db/chatUnread.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const participant: Participant = {
  id: '10000000-0000-4000-8000-000000000001',
  firebase_uid: 'fb-unread-reader',
  email: 'reader@example.test',
  full_name: 'Unread Reader',
  role: 'PART',
  is_verified: true,
  is_suspended: false,
  is_deactivated: false,
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
};
const decoded = {
  uid: participant.firebase_uid,
  role: 'PART',
  auth_time: AUTH_TIME,
  [MFA_CLAIM]: AUTH_TIME,
} as unknown as DecodedIdToken;
const auth = { Authorization: 'Bearer valid-mfa-token' };

describe('GET /api/chat/unread-counts (US-034 / #399)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(decoded);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
    vi.spyOn(chatUnreadRepository, 'listForParticipant').mockResolvedValue([
      {
        conversation_type: 'channel',
        conversation_id: '20000000-0000-4000-8000-000000000002',
        unread_count: 3,
        unread_mention_count: 2,
      },
      {
        conversation_type: 'direct_message',
        conversation_id: '30000000-0000-4000-8000-000000000003',
        unread_count: 1,
        unread_mention_count: 1,
      },
    ]);
  });

  it('returns a no-store, count-only summary for the authenticated participant', async () => {
    const response = await request(app).get('/api/chat/unread-counts').set(auth);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      status: 'ok',
      counts: [
        {
          conversationType: 'channel',
          conversationId: '20000000-0000-4000-8000-000000000002',
          unreadCount: 3,
          unreadMentionCount: 2,
        },
        {
          conversationType: 'directMessage',
          conversationId: '30000000-0000-4000-8000-000000000003',
          unreadCount: 1,
          unreadMentionCount: 1,
        },
      ],
      totalUnreadCount: 4,
      totalUnreadMentionCount: 3,
      privacy: {
        credentialsIncluded: false,
        otpsIncluded: false,
        emailsIncluded: false,
      },
    });
    expect(chatUnreadRepository.listForParticipant).toHaveBeenCalledWith(participant.id);
    expect(JSON.stringify(response.body)).not.toMatch(
      /reader@example|message body|password|otp_hash|firebase_uid|access_token/i
    );
  });

  it('returns a clear zero-count empty state', async () => {
    vi.mocked(chatUnreadRepository.listForParticipant).mockResolvedValue([]);
    const response = await request(app).get('/api/chat/unread-counts').set(auth);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      counts: [],
      totalUnreadCount: 0,
      totalUnreadMentionCount: 0,
    });
  });

  it('denies a visitor before querying unread state', async () => {
    const response = await request(app).get('/api/chat/unread-counts');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(chatUnreadRepository.listForParticipant).not.toHaveBeenCalled();
  });

  it('denies an unverified participant before querying unread state', async () => {
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
      ...participant,
      is_verified: false,
    });
    const response = await request(app).get('/api/chat/unread-counts').set(auth);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(chatUnreadRepository.listForParticipant).not.toHaveBeenCalled();
  });

  it('denies an ADMIN without returning conversation identifiers or counts', async () => {
    mockVerifyIdToken.mockResolvedValue({ ...decoded, role: 'ADMIN' });
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
      ...participant,
      role: 'ADMIN',
    });
    const response = await request(app).get('/api/chat/unread-counts').set(auth);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_ROLE');
    expect(response.body).not.toHaveProperty('counts');
    expect(JSON.stringify(response.body)).not.toMatch(
      /20000000-0000-4000-8000-000000000002|30000000-0000-4000-8000-000000000003|reader@example/i
    );
    expect(chatUnreadRepository.listForParticipant).not.toHaveBeenCalled();
  });

  it('propagates storage failures safely without returning partial counts', async () => {
    vi.mocked(chatUnreadRepository.listForParticipant).mockRejectedValue(
      new Error('private database detail')
    );
    const response = await request(app).get('/api/chat/unread-counts').set(auth);
    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('counts');
    expect(JSON.stringify(response.body)).not.toMatch(/reader@example|message body/i);
  });
});
