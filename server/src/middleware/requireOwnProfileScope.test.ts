import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { OWN_PROFILE_ONLY_MESSAGE, requireOwnProfileScope } from './requireOwnProfileScope.js';
import type { Participant } from '../db/types.js';

const ME = '1111aaaa-1111-4111-8111-1111111111bb';
const OTHER = '2222cccc-2222-4222-8222-2222222222dd';
const UID = 'fb-me';

const caller = { id: ME, firebase_uid: UID } as Participant;

interface Captured {
  status: number | null;
  body: unknown;
  headers: Record<string, string>;
  nextCalled: boolean;
}

function run(parts: { query?: unknown; body?: unknown; params?: unknown; participant?: Participant | undefined } = {}): Captured {
  const captured: Captured = { status: null, body: undefined, headers: {}, nextCalled: false };
  const req = {
    query: parts.query ?? {},
    body: parts.body,
    params: parts.params ?? {},
    participant: 'participant' in parts ? parts.participant : caller,
  } as unknown as Request;
  const res = {
    setHeader: (name: string, value: string) => {
      captured.headers[name] = value;
    },
    status: (code: number) => {
      captured.status = code;
      return res;
    },
    json: (body: unknown) => {
      captured.body = body;
      return res;
    },
  } as unknown as Response;
  const next = vi.fn(() => {
    captured.nextCalled = true;
  }) as unknown as NextFunction;
  requireOwnProfileScope(req, res, next);
  return captured;
}

describe('requireOwnProfileScope (US-016 / #158)', () => {
  describe('allowed', () => {
    it('lets a request that names no identity through', () => {
      const result = run();
      expect(result.nextCalled).toBe(true);
      expect(result.status).toBeNull();
    });

    it('lets a request through when only other, unrelated fields are present', () => {
      expect(run({ query: { limit: '5', eventId: 'anything' } }).nextCalled).toBe(true);
    });

    it.each(['participantId', 'participant_id', 'userId', 'user_id', 'accountId', 'account_id', 'profileId', 'profile_id'])(
      'lets the caller name their own id as %s, in any letter case',
      (key) => {
        expect(run({ query: { [key]: ME } }).nextCalled).toBe(true);
        expect(run({ query: { [key]: ME.toUpperCase() } }).nextCalled).toBe(true);
        expect(run({ query: { [key]: `  ${ME}  ` } }).nextCalled).toBe(true);
      }
    );

    it.each(['firebaseUid', 'firebase_uid', 'uid'])('lets the caller name their own sign-in identity as %s', (key) => {
      expect(run({ query: { [key]: UID } }).nextCalled).toBe(true);
    });

    it('lets the caller name themselves in the body or the route parameters', () => {
      expect(run({ body: { participantId: ME } }).nextCalled).toBe(true);
      expect(run({ params: { participantId: ME } }).nextCalled).toBe(true);
    });

    it('ignores an absent (undefined) value', () => {
      expect(run({ query: { participantId: undefined } }).nextCalled).toBe(true);
    });

    it('copes with a body that is missing, a list or text', () => {
      expect(run({ body: undefined }).nextCalled).toBe(true);
      expect(run({ body: [] }).nextCalled).toBe(true);
      expect(run({ body: 'text' }).nextCalled).toBe(true);
    });
  });

  describe('refused: another participant (403)', () => {
    it.each(['participantId', 'participant_id', 'userId', 'user_id', 'accountId', 'account_id', 'profileId', 'profile_id'])(
      'refuses %s naming someone else',
      (key) => {
        const result = run({ query: { [key]: OTHER } });
        expect(result.nextCalled).toBe(false);
        expect(result.status).toBe(403);
        expect(result.body).toEqual({ error: OWN_PROFILE_ONLY_MESSAGE, code: 'FORBIDDEN_NOT_OWN_PROFILE' });
      }
    );

    it.each(['firebaseUid', 'firebase_uid', 'uid'])('refuses %s naming someone else', (key) => {
      const result = run({ query: { [key]: 'fb-someone-else' } });
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ code: 'FORBIDDEN_NOT_OWN_PROFILE' });
    });

    it('refuses another participant named in the body or the route parameters', () => {
      expect(run({ body: { participantId: OTHER } }).status).toBe(403);
      expect(run({ params: { participantId: OTHER } }).status).toBe(403);
    });

    it('refuses when the caller names themselves AND someone else', () => {
      expect(run({ query: { participantId: ME }, body: { userId: OTHER } }).status).toBe(403);
    });

    it('never repeats the identity that was sent and sets no-store', () => {
      const result = run({ query: { participantId: OTHER } });
      expect(JSON.stringify(result.body)).not.toContain(OTHER);
      expect(result.headers['Cache-Control']).toBe('no-store');
    });
  });

  describe('refused: malformed identity (400)', () => {
    it.each([
      ['not an id', 'someone-else'],
      ['blank', ''],
      ['only spaces', '   '],
      ['a number-like text', '12345'],
      ['an id with extra characters', `${ME}x`],
      ['an id with the wrong shape', '1111111-1111-4111-8111-111111111111'],
    ])('refuses participantId that is %s', (_label, value) => {
      const result = run({ query: { participantId: value } });
      expect(result.nextCalled).toBe(false);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: 'VALIDATION_ERROR', errors: { participantId: expect.any(String) } });
    });

    it('refuses a repeated parameter (a list) and an object', () => {
      expect(run({ query: { participantId: [ME, OTHER] } }).status).toBe(400);
      expect(run({ query: { participantId: { a: 1 } } }).status).toBe(400);
      expect(run({ body: { participantId: 5 } }).status).toBe(400);
      expect(run({ body: { participantId: null } }).status).toBe(400);
    });

    it('refuses a blank sign-in identity', () => {
      const result = run({ query: { uid: '  ' } });
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ errors: { uid: expect.any(String) } });
    });

    it('names every bad field at once', () => {
      const result = run({ query: { participantId: 'x', userId: '' } });
      expect(result.status).toBe(400);
      expect((result.body as { errors: Record<string, string> }).errors).toEqual({
        participantId: expect.any(String),
        userId: expect.any(String),
      });
    });

    it('reports a malformed identity before a mismatch (invalid input wins)', () => {
      expect(run({ query: { participantId: OTHER, userId: 'bad' } }).status).toBe(400);
    });

    it('never repeats the bad value', () => {
      const result = run({ query: { participantId: 'secret-looking-value' } });
      expect(JSON.stringify(result.body)).not.toContain('secret-looking-value');
      expect(result.headers['Cache-Control']).toBe('no-store');
    });
  });

  it('refuses with 401 if it is ever used without a verified caller', () => {
    const result = run({ participant: undefined });
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
