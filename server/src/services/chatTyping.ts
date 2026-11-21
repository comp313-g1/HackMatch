/**
 * US-035 / #407 — ephemeral typing indicators (#404 policy, section 5).
 *
 * Everything here lives in this process's memory only: nothing is written to
 * PostgreSQL, notification rows, files, or logs, and no draft or message text is
 * ever accepted. A typing signal means "the authenticated participant is typing
 * in this conversation right now"; it expires TYPING_EXPIRY_MS after the last
 * signal whether or not a stop ever arrives.
 *
 * Delivery is scoped on the server. A viewer receives events for a conversation
 * only through a stream it opened for that conversation, after passing that
 * conversation's read guard. Before EVERY event is delivered, that viewer's read
 * access to the conversation is checked again; a viewer who lost access gets
 * nothing and is disconnected. The sender never receives their own events. There is no event
 * history: a new stream never receives earlier typing state.
 */

import { config } from '../config/index.js';

/** #404: the server expires an indicator 6 s after the last signal. */
export const TYPING_EXPIRY_MS = 6_000;

export type TypingConversationType = 'channel' | 'team' | 'directMessage';

export interface TypingConversation {
  conversationType: TypingConversationType;
  /** channelId (public), teamId (team chat), or threadId (direct messages). */
  conversationId: string;
}

/** The SSE `typing` event payload. Only the handle already shown on that conversation's messages. */
export interface TypingEvent {
  conversationType: TypingConversationType;
  conversationId: string;
  typist: { handle: string | null };
  typing: boolean;
  /** Present when typing is true: when this indicator expires unless refreshed. */
  expiresAt?: string;
}

export interface TypingSubscriber {
  participantId: string;
  deliver: (event: TypingEvent) => void;
  /** Re-runs this viewer's read check for the conversation. */
  authorize: () => Promise<boolean>;
  /** Ends the viewer's stream (used when access is lost). */
  close: () => void;
}

type SubscriberEntry = TypingSubscriber;

interface ActiveTypist {
  handle: string | null;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export function isChatTypingEnabled(): boolean {
  return config.richChat.typingEnabled === true;
}

export function typingConversationKey(conversation: TypingConversation): string {
  return `${conversation.conversationType}:${conversation.conversationId.toLowerCase()}`;
}

export class TypingHub {
  private readonly subscribers = new Map<string, Set<SubscriberEntry>>();
  private readonly streamsByParticipant = new Map<string, number>();
  private readonly active = new Map<string, Map<string, ActiveTypist>>();

  constructor(
    private readonly options: { expiryMs?: number; now?: () => number } = {}
  ) {}

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private get expiryMs(): number {
    return this.options.expiryMs ?? TYPING_EXPIRY_MS;
  }

  /** Registers an already-authorized viewer. Returns an idempotent unsubscribe. */
  subscribe(conversation: TypingConversation, subscriber: TypingSubscriber): () => void {
    const key = typingConversationKey(conversation);
    const participantId = subscriber.participantId.toLowerCase();
    const entry: SubscriberEntry = { ...subscriber, participantId };
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(entry);
    this.streamsByParticipant.set(participantId, (this.streamsByParticipant.get(participantId) ?? 0) + 1);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const current = this.subscribers.get(key);
      current?.delete(entry);
      if (current && current.size === 0) this.subscribers.delete(key);
      const count = (this.streamsByParticipant.get(participantId) ?? 1) - 1;
      if (count <= 0) this.streamsByParticipant.delete(participantId);
      else this.streamsByParticipant.set(participantId, count);
    };
  }

  /** Open typing streams for this participant, across all conversations. */
  streamCount(participantId: string): number {
    return this.streamsByParticipant.get(participantId.toLowerCase()) ?? 0;
  }

  subscriberCount(conversation: TypingConversation): number {
    return this.subscribers.get(typingConversationKey(conversation))?.size ?? 0;
  }

  /** Current (unexpired) typists, for diagnostics and tests. No history is kept. */
  activeTypists(conversation: TypingConversation): Array<{ participantId: string; expiresAt: number }> {
    const typists = this.active.get(typingConversationKey(conversation));
    if (!typists) return [];
    return [...typists.entries()].map(([participantId, typist]) => ({ participantId, expiresAt: typist.expiresAt }));
  }

  /**
   * Applies one signal from the authenticated sender. `typing: true` starts or refreshes
   * this sender's indicator; `typing: false` clears it. Resolves once delivery is attempted.
   */
  async signal(input: {
    conversation: TypingConversation;
    participantId: string;
    handle: string | null;
    typing: boolean;
  }): Promise<void> {
    if (!isChatTypingEnabled()) return;
    const key = typingConversationKey(input.conversation);
    const participantId = input.participantId.toLowerCase();

    if (!input.typing) {
      if (this.clear(key, participantId)) {
        await this.publish(key, participantId, this.event(input.conversation, input.handle, false));
      }
      return;
    }

    let typists = this.active.get(key);
    if (!typists) {
      typists = new Map();
      this.active.set(key, typists);
    }
    const previous = typists.get(participantId);
    if (previous) clearTimeout(previous.timer);

    const expiresAt = this.now() + this.expiryMs;
    const timer = setTimeout(() => {
      // Expiry is authoritative: no stop signal is needed for the indicator to disappear.
      if (this.active.get(key)?.get(participantId)?.timer !== timer) return;
      this.clear(key, participantId);
      if (isChatTypingEnabled()) {
        void this.publish(key, participantId, this.event(input.conversation, input.handle, false));
      }
    }, this.expiryMs);
    (timer as { unref?: () => void }).unref?.();
    typists.set(participantId, { handle: input.handle, expiresAt, timer });

    await this.publish(
      key,
      participantId,
      this.event(input.conversation, input.handle, true, new Date(expiresAt).toISOString())
    );
  }

  private event(
    conversation: TypingConversation,
    handle: string | null,
    typing: boolean,
    expiresAt?: string
  ): TypingEvent {
    return {
      conversationType: conversation.conversationType,
      conversationId: conversation.conversationId.toLowerCase(),
      typist: { handle },
      typing,
      ...(typing && expiresAt ? { expiresAt } : {}),
    };
  }

  private clear(key: string, participantId: string): boolean {
    const typists = this.active.get(key);
    const typist = typists?.get(participantId);
    if (!typists || !typist) return false;
    clearTimeout(typist.timer);
    typists.delete(participantId);
    if (typists.size === 0) this.active.delete(key);
    return true;
  }

  private async publish(key: string, senderId: string, event: TypingEvent): Promise<void> {
    const recipients = [...(this.subscribers.get(key) ?? [])].filter((entry) => entry.participantId !== senderId);
    await Promise.all(
      recipients.map(async (entry) => {
        try {
          // No cached result: access is confirmed for this event, right before it is sent.
          const allowed = await entry.authorize().catch(() => false);
          if (!allowed) {
            entry.close();
            return;
          }
          entry.deliver(event);
        } catch {
          // One broken viewer connection must not block the others or the sender.
        }
      })
    );
  }

  /** Drops all state (tests only). */
  _reset(): void {
    for (const typists of this.active.values()) for (const typist of typists.values()) clearTimeout(typist.timer);
    this.active.clear();
    this.subscribers.clear();
    this.streamsByParticipant.clear();
  }
}

export const typingHub = new TypingHub();
