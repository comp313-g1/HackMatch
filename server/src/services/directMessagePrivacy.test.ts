import { describe, it, expect } from 'vitest';
import type { DirectMessage, DirectMessageThread } from '../db/directMessage.repository.js';
import {
  DIRECT_MESSAGE_PRIVACY_NOTICE,
  buildDirectMessageSuccessPayload,
  directMessagePayloadHasPrivateKey,
  directMessagePrivacyFlags,
  isPrivateDirectMessageKey,
  sanitizeSubmittedDirectMessageDraft,
  scrubDirectMessageFields,
  toDirectInboxItemView,
  toDirectMessageView,
  toDirectThreadView,
} from './directMessagePrivacy.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Rows as the database returns them, deliberately padded with columns that must never leak. */
const thread = {
  id: '44444444-4444-4444-8444-444444444444',
  participant_low_id: A,
  participant_high_id: B,
  last_message_at: '2026-11-09T10:05:00.000Z',
  created_at: '2026-11-09T10:00:00.000Z',
  updated_at: '2026-11-09T10:05:00.000Z',
  email: 'leak@example.com',
  firebase_uid: 'fb-secret',
  presence_status: 'Invisible',
} as unknown as DirectMessageThread;

const message = {
  id: '55555555-5555-4555-8555-555555555555',
  thread_id: thread.id,
  author_id: A,
  body: 'hello there',
  created_at: '2026-11-09T10:05:00.000Z',
  email: 'leak@example.com',
  password: 'hunter2',
  otp_hash: 'abc',
  shared_contact_handle: '@secret',
} as unknown as DirectMessage;

const FORBIDDEN_TEXT = /leak@example\.com|fb-secret|Invisible|hunter2|otp_hash|@secret|participant_low_id|participant_high_id|firebase|password/i;

describe('toDirectThreadView (US-032 / #390)', () => {
  it('returns exactly the allowlisted fields, whichever side is the caller', () => {
    const forA = toDirectThreadView(thread, A, 'bea');
    expect(forA).toEqual({
      id: thread.id,
      peer: { id: B, handle: 'bea' },
      lastMessageAt: thread.last_message_at,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
    });
    expect(toDirectThreadView(thread, B, 'ann').peer).toEqual({ id: A, handle: 'ann' });
    expect(toDirectThreadView(thread, A.toUpperCase(), 'bea').peer.id).toBe(B);
  });

  it('never exposes the raw low/high columns, email, uid, or presence from the row', () => {
    expect(JSON.stringify(toDirectThreadView(thread, A, null))).not.toMatch(FORBIDDEN_TEXT);
  });

  it('keeps a missing handle as null instead of inventing one from other data', () => {
    expect(toDirectThreadView(thread, A, null).peer.handle).toBeNull();
  });

  it('copes with a thread that has no activity timestamp', () => {
    const noActivity = { ...thread, last_message_at: undefined } as unknown as DirectMessageThread;
    expect(toDirectThreadView(noActivity, A, null).lastMessageAt).toBeNull();
  });
});

describe('toDirectMessageView (US-032 / #390)', () => {
  it('returns exactly the allowlisted fields and marks who wrote it from the caller point of view', () => {
    expect(toDirectMessageView(message, A, 'ann')).toEqual({
      id: message.id,
      threadId: thread.id,
      fromMe: true,
      authorHandle: 'ann',
      body: 'hello there',
      createdAt: message.created_at,
    });
    expect(toDirectMessageView(message, B, 'ann').fromMe).toBe(false);
    expect(toDirectMessageView(message, A.toUpperCase(), 'ann').fromMe).toBe(true);
  });

  it('does not expose the author account id, email, password, otp or contact handle', () => {
    const view = toDirectMessageView(message, B, 'ann');
    expect(view).not.toHaveProperty('authorId');
    expect(view).not.toHaveProperty('author_id');
    expect(JSON.stringify(view)).not.toMatch(FORBIDDEN_TEXT);
    expect(JSON.stringify(view)).not.toContain(A);
  });

  it('keeps the message text exactly as written (user content is not rewritten)', () => {
    const typed = { ...message, body: 'mail me at someone@elsewhere.org' } as DirectMessage;
    expect(toDirectMessageView(typed, A, null).body).toBe('mail me at someone@elsewhere.org');
  });
});

describe('toDirectInboxItemView (US-032 / #390)', () => {
  it('combines the safe thread and the safe last message', () => {
    const item = toDirectInboxItemView(thread, A, 'bea', { message, authorHandle: 'ann' });
    expect(item.lastMessage).toMatchObject({ body: 'hello there', fromMe: true, authorHandle: 'ann' });
    expect(item.peer).toEqual({ id: B, handle: 'bea' });
    expect(JSON.stringify(item)).not.toMatch(FORBIDDEN_TEXT);
  });

  it('shows an empty thread with lastMessage null', () => {
    expect(toDirectInboxItemView(thread, A, 'bea', null).lastMessage).toBeNull();
  });
});

describe('scrubDirectMessageFields / key rules (US-032 / #390)', () => {
  const sensitive = [
    'email', 'e-mail', 'password', 'otp', 'otpHash', 'otp_code', 'token', 'idToken', 'firebase_uid', 'firebaseUid',
    'shared_contact_handle', 'secret', 'credentials',
    'presence', 'presence_status', 'presenceStatus', 'last_seen', 'lastSeenAt', 'online',
    'full_name', 'fullName', 'institution', 'phone', 'contact', 'contactHandle', 'role',
    'is_verified', 'isSuspended', 'is_deactivated', 'suspended_at', 'suspension_reason', 'deactivation_reason',
    'participant_low_id', 'participantHighId', 'low_id', 'created_by',
    'blocked', 'blockedByMe', 'blocked_by_them', 'blocker_id', 'blocked_id', 'block_state',
  ];

  it.each(sensitive)('treats "%s" as private', (key) => {
    expect(isPrivateDirectMessageKey(key)).toBe(true);
    expect(scrubDirectMessageFields({ [key]: 'x', keep: 'ok' })).toEqual({ keep: 'ok' });
  });

  it.each(['id', 'threadId', 'body', 'handle', 'peer', 'authorHandle', 'fromMe', 'createdAt', 'lastMessageAt', 'lastMessage', 'messages', 'thread', 'threads', 'status'])(
    'keeps the legitimate key "%s"',
    (key) => {
      expect(isPrivateDirectMessageKey(key)).toBe(false);
    }
  );

  it('scrubs nested objects and arrays', () => {
    const out = scrubDirectMessageFields({
      messages: [{ id: 1, body: 'x', presence_status: 'Online', peer: { handle: 'h', email: 'e', blockedByMe: true } }],
    });
    expect(out).toEqual({ messages: [{ id: 1, body: 'x', peer: { handle: 'h' } }] });
    expect(directMessagePayloadHasPrivateKey(out)).toBe(false);
  });

  it('detects a private key anywhere in a payload', () => {
    expect(directMessagePayloadHasPrivateKey({ a: [{ b: { presence: 'x' } }] })).toBe(true);
    expect(directMessagePayloadHasPrivateKey({ a: [{ b: { handle: 'x' } }] })).toBe(false);
    expect(directMessagePayloadHasPrivateKey(null)).toBe(false);
  });

  it('passes primitives through unchanged', () => {
    expect(scrubDirectMessageFields('text')).toBe('text');
    expect(scrubDirectMessageFields(5)).toBe(5);
    expect(scrubDirectMessageFields(null)).toBeNull();
  });
});

describe('buildDirectMessageSuccessPayload (US-032 / #390)', () => {
  it('adds the privacy flags and scrubs anything private that slipped into the data', () => {
    const out = buildDirectMessageSuccessPayload({
      status: 'ok',
      thread: { ...toDirectThreadView(thread, A, 'bea'), presence_status: 'Online', email: 'x@y.z' },
    });
    expect(out.privacy).toEqual({
      credentialsIncluded: false,
      otpsIncluded: false,
      emailsIncluded: false,
      presenceIncluded: false,
      contactDetailsIncluded: false,
      notice: DIRECT_MESSAGE_PRIVACY_NOTICE,
    });
    expect(directMessagePayloadHasPrivateKey({ ...out, privacy: undefined })).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/Online|x@y\.z/);
  });

  it('privacy flags are fresh objects each call', () => {
    expect(directMessagePrivacyFlags()).not.toBe(directMessagePrivacyFlags());
  });

  it('the notice names what is excluded', () => {
    for (const word of ['handles', 'Credentials', 'OTPs', 'emails', 'presence', 'contact']) {
      expect(DIRECT_MESSAGE_PRIVACY_NOTICE).toContain(word);
    }
  });
});

describe('sanitizeSubmittedDirectMessageDraft (US-032 / #390 / NR-017)', () => {
  it('keeps the typed draft but redacts private keys', () => {
    expect(
      sanitizeSubmittedDirectMessageDraft({ body: 'hello', participantId: A, email: 'a@b.c', presence_status: 'Online', password: 'pw' })
    ).toEqual({ body: 'hello', participantId: A, email: '[redacted]', presence_status: '[redacted]', password: '[redacted]' });
  });

  it('passes non-objects through unchanged', () => {
    expect(sanitizeSubmittedDirectMessageDraft(null)).toBeNull();
    expect(sanitizeSubmittedDirectMessageDraft('x')).toBe('x');
    expect(sanitizeSubmittedDirectMessageDraft([1])).toEqual([1]);
  });
});

describe('the viewer\'s own block state (#433)', () => {
  const aThread = {
    id: '44444444-4444-4444-8444-444444444444',
    participant_low_id: A,
    participant_high_id: B,
    last_message_at: '2026-11-09T10:05:00.000Z',
    created_at: '2026-11-09T10:00:00.000Z',
    updated_at: '2026-11-09T10:05:00.000Z',
  } as unknown as DirectMessageThread;

  it('reports youBlockedPeer on the single-conversation view, true or false', () => {
    expect(toDirectInboxItemView(aThread, A, 'bea', null, true).youBlockedPeer).toBe(true);
    expect(toDirectInboxItemView(aThread, A, 'bea', null, false).youBlockedPeer).toBe(false);
  });

  it('leaves it out when it is not given (inbox list, open-thread answers)', () => {
    expect(toDirectInboxItemView(aThread, A, 'bea', null)).not.toHaveProperty('youBlockedPeer');
    expect(toDirectThreadView(aThread, A, 'bea')).not.toHaveProperty('youBlockedPeer');
  });

  it('the new key survives the safety scrub', () => {
    expect(scrubDirectMessageFields({ youBlockedPeer: true })).toEqual({ youBlockedPeer: true });
    expect(isPrivateDirectMessageKey('youBlockedPeer')).toBe(false);
  });

  it('every other way of naming block state is still scrubbed, so the peer\'s block cannot leak', () => {
    for (const key of ['blocked', 'blockedByMe', 'blockedByThem', 'blocked_by_them', 'blocker_id', 'blocked_id', 'block_state']) {
      expect(scrubDirectMessageFields({ [key]: true, keep: 1 })).toEqual({ keep: 1 });
    }
  });
});
