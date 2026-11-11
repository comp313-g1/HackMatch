import { createContext, useContext } from 'react';

/**
 * #432 — lets any screen start a direct message without knowing how the chat panel is opened.
 *
 * The app provides it; a "Message" button calls `openDirectMessage(participantId)`, and the app
 * then opens the chat panel on the Direct messages tab and opens (or continues) that conversation.
 * Outside a provider the hook returns null, and screens simply do not show the button.
 */
export interface DirectMessageLauncher {
  openDirectMessage: (participantId: string) => void;
}

/** One request to open a conversation. `requestId` changes on every click, even for the same person. */
export interface DirectMessageOpenRequest {
  participantId: string;
  requestId: number;
}

const DirectMessageLauncherContext = createContext<DirectMessageLauncher | null>(null);

export const DirectMessageLauncherProvider = DirectMessageLauncherContext.Provider;

export function useDirectMessageLauncher(): DirectMessageLauncher | null {
  return useContext(DirectMessageLauncherContext);
}

/** Short, friendly text for a failed attempt to open a conversation. Never says why a person is unavailable. */
export function friendlyOpenConversationError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  const code = (error as { code?: string } | null)?.code;
  if (code === 'CANNOT_MESSAGE_SELF') return 'You cannot send a direct message to yourself.';
  if (code === 'PEER_NOT_AVAILABLE' || status === 404) {
    return 'You cannot message this participant right now.';
  }
  if (status === 401 || status === 403) return 'Please sign in again to use direct messages.';
  return 'Could not open the conversation. Please try again.';
}
