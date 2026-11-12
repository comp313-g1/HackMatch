/**
 * US-035 / #407 — Server-Sent Events stream of typing indicators for ONE
 * conversation the viewer was authorized to read when the stream opened.
 *
 * Reuses the notification stream's transport rules (#404 policy, section 5):
 * fetch-based SSE with a bearer token, the same heartbeat, bounded lifetime
 * (the client reconnects and re-authenticates), and per-participant cap. Typing
 * streams have their own cap so they can never use up notification streams.
 * Events carry no `id:` field and nothing is replayed after a reconnect.
 */

import type { Request, Response } from 'express';
import {
  STREAM_HEARTBEAT_MS,
  STREAM_MAX_LIFETIME_MS,
  STREAM_MAX_PER_PARTICIPANT,
  STREAM_RETRY_MS,
  formatSseEvent,
} from './notificationStream.js';
import {
  TYPING_EXPIRY_MS,
  typingHub,
  type TypingConversation,
  type TypingHub,
} from './chatTyping.js';

export interface TypingStreamOptions {
  hub?: TypingHub;
  heartbeatMs?: number;
  maxLifetimeMs?: number;
  maxPerParticipant?: number;
}

/** Returns false (after sending a 429) when the participant already has the maximum open. */
export function openTypingStream(
  req: Request,
  res: Response,
  input: {
    participantId: string;
    conversation: TypingConversation;
    authorize: () => Promise<boolean>;
  },
  options: TypingStreamOptions = {}
): boolean {
  const hub = options.hub ?? typingHub;
  const heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  const maxLifetimeMs = options.maxLifetimeMs ?? STREAM_MAX_LIFETIME_MS;
  const maxPerParticipant = options.maxPerParticipant ?? STREAM_MAX_PER_PARTICIPANT;

  if (hub.streamCount(input.participantId) >= maxPerParticipant) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(429).json({
      error: 'Too many open typing streams. Close another chat and try again.',
      code: 'TOO_MANY_STREAMS',
    });
    return false;
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(
    `retry: ${STREAM_RETRY_MS}\n${formatSseEvent('ready', {
      conversationType: input.conversation.conversationType,
      conversationId: input.conversation.conversationId.toLowerCase(),
      typingExpiryMs: TYPING_EXPIRY_MS,
    })}`
  );

  let closed = false;
  const endStream = (): void => {
    if (closed) return;
    close();
    res.end();
  };

  const unsubscribe = hub.subscribe(input.conversation, {
    participantId: input.participantId,
    deliver: (event) => {
      if (!closed) res.write(formatSseEvent('typing', event));
    },
    authorize: input.authorize,
    // Access was lost: end the stream. A reconnect runs the full guard chain again.
    close: endStream,
  });

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, heartbeatMs);

  const lifetime = setTimeout(() => {
    if (closed) return;
    res.write(formatSseEvent('reconnect', {}));
    endStream();
  }, maxLifetimeMs);

  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    unsubscribe();
  }

  req.on('close', close);
  res.on('close', close);
  res.on('error', close);
  return true;
}
