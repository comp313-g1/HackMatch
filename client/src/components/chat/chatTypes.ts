/** US-030 / #346 chat client types (FR-086–FR-089). */

export const PRESENCE_STATUSES = [
  'Online',
  'Idle',
  'Do Not Disturb',
  'Invisible',
] as const;

export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export interface PresenceView {
  presenceStatus: PresenceStatus;
  updatedAt: string;
}

export interface ChatChannelView {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** US-031 / #383 private channel projection returned only after team-member authorization. */
export interface TeamChatChannelView extends ChatChannelView {
  channelType: 'team';
  teamId: string;
}

/**
 * US-035 / #405–#406 approved reaction codes, in the canonical display order
 * (docs/04_requirements/us035_rich_chat_policy.md, section 4).
 */
export const CHAT_REACTION_CODES = [
  'thumbs_up',
  'heart',
  'laugh',
  'party',
  'surprised',
  'sad',
  'eyes',
  'check',
] as const;

export type ChatReactionCode = (typeof CHAT_REACTION_CODES)[number];

/** Safe server aggregate for one reaction on one message. Never identifies who reacted. */
export interface ChatReactionSummary {
  reaction: ChatReactionCode;
  count: number;
  reactedByMe: boolean;
}

/** US-035 / #405: what the server currently offers (GET /api/chat/capabilities). */
export interface RichChatCapabilities {
  reactions: { enabled: boolean; allowedReactions: ChatReactionCode[] };
  typing: { enabled: boolean };
  attachments: { enabled: false };
  voiceVideo: false;
}

/** Which conversation a reacted message belongs to; selects the #405 route family. */
export type ChatReactionTarget =
  | { kind: 'channel'; channelId: string }
  | { kind: 'team'; teamId: string }
  | { kind: 'directMessage'; threadId: string };

/** The conversation a typing signal or typing stream belongs to (US-035 / #408). */
export type ChatConversationTarget = ChatReactionTarget;

/** US-035 / #407 typing stream event. The handle is display data only, never an authority. */
export interface ChatTypingEvent {
  conversationType: ChatConversationTarget['kind'];
  conversationId: string;
  typist: { handle: string | null };
  typing: boolean;
  expiresAt?: string;
}

export interface ChatReactionMutationResult {
  messageId: string;
  reaction: ChatReactionCode;
  reactedByMe: boolean;
  changed: boolean;
  reactions: ChatReactionSummary[];
}

export interface ChatMessageView {
  id: string;
  channelId: string;
  authorId: string;
  authorHandle: string | null;
  body: string;
  createdAt: string;
  /** US-035 / #405: present only while the server's reaction feature is on. */
  reactions?: ChatReactionSummary[];
}

export interface CreateChannelInput {
  title: string;
  description: string;
}

export interface SendMessageInput {
  body: string;
}

/**
 * US-032 / #389 safe one-to-one message projection. The server never sends the author's account id;
 * it sends `fromMe` (#434) so the thread can show which messages are yours.
 */
export interface DirectMessageView {
  id: string;
  threadId: string;
  fromMe: boolean;
  authorHandle: string | null;
  body: string;
  createdAt: string;
  /** US-035 / #405: present only while the server's reaction feature is on. */
  reactions?: ChatReactionSummary[];
}

/** US-032 / #389 safe inbox/thread projection. Participant IDs are never rendered by the UI. */
export interface DirectMessageThreadView {
  id: string;
  peer: {
    id: string;
    handle: string | null;
  };
  createdAt: string;
  updatedAt: string;
  lastMessage?: DirectMessageView | null;
  lastMessageAt?: string | null;
  /**
   * #433: true when YOU have blocked the other participant. It only ever describes your own block;
   * the server never says whether the other person blocked you. Present on the single-conversation view.
   */
  youBlockedPeer?: boolean;
}

export interface DirectMessageThreadDetail {
  thread: DirectMessageThreadView;
  messages: DirectMessageView[];
  isEmpty: boolean;
}

export interface ChatFieldErrors {
  title?: string;
  description?: string;
  body?: string;
  presenceStatus?: string;
  channelId?: string;
  _form?: string;
  [key: string]: string | undefined;
}

export interface ChatPrivacyFlags {
  credentialsIncluded: false;
  otpsIncluded: false;
  emailsIncluded: false;
  notice: string;
}

/** US-034 / #399 participant-safe activity count for one authorized conversation. */
export type ChatUnreadConversationType = 'channel' | 'directMessage';

export interface ChatUnreadCountView {
  conversationType: ChatUnreadConversationType;
  conversationId: string;
  unreadCount: number;
  unreadMentionCount: number;
}

export interface ChatUnreadSummary {
  counts: ChatUnreadCountView[];
  totalUnreadCount: number;
  totalUnreadMentionCount: number;
}

export interface MarkChatConversationReadInput {
  conversationType: ChatUnreadConversationType;
  conversationId: string;
  messageId: string;
}

export interface MarkChatConversationReadResult {
  conversationType: ChatUnreadConversationType;
  conversationId: string;
  readCursor: {
    messageId: string;
    createdAt: string;
  };
  advanced: boolean;
  unreadCount: number;
  unreadMentionCount: number;
}
