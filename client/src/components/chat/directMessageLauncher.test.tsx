import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DirectMessageLauncherProvider,
  friendlyOpenConversationError,
  useDirectMessageLauncher,
} from './directMessageLauncher';
import { ChatApiError } from './chatApi';

function Probe(): React.JSX.Element {
  const launcher = useDirectMessageLauncher();
  return launcher ? (
    <button type="button" onClick={() => launcher.openDirectMessage('peer-1')}>
      launch
    </button>
  ) : (
    <p>no launcher</p>
  );
}

describe('direct message launcher (#432)', () => {
  it('is absent outside a provider, so screens can hide the Message button', () => {
    render(<Probe />);
    expect(screen.getByText('no launcher')).toBeInTheDocument();
  });

  it('hands the participant id to the provider', () => {
    const openDirectMessage = vi.fn();
    render(
      <DirectMessageLauncherProvider value={{ openDirectMessage }}>
        <Probe />
      </DirectMessageLauncherProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'launch' }));
    expect(openDirectMessage).toHaveBeenCalledWith('peer-1');
  });
});

describe('friendlyOpenConversationError (#432)', () => {
  const err = (status: number, code: string) => new ChatApiError(status, code, undefined, undefined, 'raw server text');

  it('says the person cannot be messaged, without saying why, for the "not available" answer', () => {
    const text = friendlyOpenConversationError(err(404, 'PEER_NOT_AVAILABLE'));
    expect(text).toBe('You cannot message this participant right now.');
    expect(text).not.toMatch(/block|suspend|verif|exist/i);
  });

  it('treats any 404 the same way', () => {
    expect(friendlyOpenConversationError(err(404, 'SOMETHING_ELSE'))).toBe('You cannot message this participant right now.');
  });

  it('explains messaging yourself', () => {
    expect(friendlyOpenConversationError(err(400, 'CANNOT_MESSAGE_SELF'))).toBe('You cannot send a direct message to yourself.');
  });

  it.each([401, 403])('asks the person to sign in again for %i', (status) => {
    expect(friendlyOpenConversationError(err(status, 'X'))).toBe('Please sign in again to use direct messages.');
  });

  it('falls back to a generic retry message for anything else', () => {
    expect(friendlyOpenConversationError(err(500, 'BOOM'))).toBe('Could not open the conversation. Please try again.');
    expect(friendlyOpenConversationError(new Error('network'))).toBe('Could not open the conversation. Please try again.');
    expect(friendlyOpenConversationError(null)).toBe('Could not open the conversation. Please try again.');
  });
});
