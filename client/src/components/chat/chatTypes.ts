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

export interface ChatMessageView {
  id: string;
  channelId: string;
  authorId: string;
  authorHandle: string | null;
  body: string;
  createdAt: string;
}

export interface CreateChannelInput {
  title: string;
  description: string;
}

export interface SendMessageInput {
  body: string;
}

/** US-032 / #389 safe one-to-one message projection. */
export interface DirectMessageView {
  id: string;
  threadId: string;
  authorId: string;
  authorHandle: string | null;
  body: string;
  createdAt: string;
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
