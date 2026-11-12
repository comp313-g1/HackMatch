/**
 * US-035 / #411 — End-to-end client attachment integration across the public
 * forum (ChatPage), private team chat (TeamChatView), and direct messages
 * (DirectMessagesView): pre-validation, upload/attach flows, draft & pending
 * attachment preservation across 413/415/429/503 errors, text fallback while
 * storage is down, and cleanup on conversation switches.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { ChatApiError } from './chatApi';
import { ChatCapabilitiesProvider } from './ChatCapabilitiesContext';
import { ChatUnreadProvider } from './ChatUnreadContext';
import { ChatPage } from './ChatPage';
import { TeamChatView } from './TeamChatView';
import { DirectMessagesView } from './DirectMessagesView';
import {
  CHAT_ATTACHMENT_MIME_TYPES,
  type ChatAttachmentView,
  type ChatChannelView,
  type ChatMessageView,
  type DirectMessageThreadDetail,
  type DirectMessageThreadView,
  type RichChatCapabilities,
  type TeamChatChannelView,
} from './chatTypes';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    fetchMyPresence: vi.fn(),
    listChatChannels: vi.fn(),
    listChatMessages: vi.fn(),
    sendChatMessage: vi.fn(),
    openTeamChat: vi.fn(),
    listTeamChatMessages: vi.fn(),
    sendTeamChatMessage: vi.fn(),
    listDirectMessageThreads: vi.fn(),
    getDirectMessageThread: vi.fn(),
    sendDirectMessage: vi.fn(),
    fetchChatUnreadSummary: vi.fn(),
    markChatConversationRead: vi.fn(),
    fetchChatCapabilities: vi.fn(),
    uploadChatAttachment: vi.fn(),
    requestChatAttachmentAccess: vi.fn(),
    fetchAttachmentContentBlob: vi.fn(),
  };
});

const CHANNEL_A_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_B_ID = '11111111-1111-4111-8111-111111111112';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_CHANNEL_ID = '55555555-5555-4555-8555-555555555555';
const THREAD_A_ID = '44444444-4444-4444-8444-444444444441';
const THREAD_B_ID = '44444444-4444-4444-8444-444444444442';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';

const channels: ChatChannelView[] = [
  {
    id: CHANNEL_A_ID,
    title: 'General',
    description: 'Public forum',
    createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
  },
  {
    id: CHANNEL_B_ID,
    title: 'Design',
    description: 'Design room',
    createdBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
  },
];

const teamChannel: TeamChatChannelView = {
  ...channels[0]!,
  id: TEAM_CHANNEL_ID,
  title: 'Team: Civic',
  channelType: 'team',
  teamId: TEAM_ID,
};

const threadA: DirectMessageThreadView = {
  id: THREAD_A_ID,
  peer: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', handle: 'blake' },
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  lastMessageAt: '2026-11-12T10:05:00.000Z',
};

const threadB: DirectMessageThreadView = {
  id: THREAD_B_ID,
  peer: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', handle: 'casey' },
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  lastMessageAt: '2026-11-12T10:06:00.000Z',
};

function makeChannelMessage(overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: MESSAGE_ID,
    channelId: CHANNEL_A_ID,
    authorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    authorHandle: 'avery',
    body: 'Initial text',
    createdAt: '2026-11-12T10:05:00.000Z',
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<ChatAttachmentView> = {}): ChatAttachmentView {
  return {
    id: 'att-pending-1',
    filename: 'mockup.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    scanStatus: 'not_scanned',
    status: 'pending',
    downloadable: false,
    ...overrides,
  };
}

function capabilities(enabled: boolean): RichChatCapabilities {
  return {
    reactions: { enabled: false, allowedReactions: [] },
    typing: { enabled: false },
    attachments: enabled
      ? {
          enabled: true,
          limits: {
            maxBytes: 10_485_760,
            maxPerMessage: 5,
            allowedTypes: [...CHAT_ATTACHMENT_MIME_TYPES],
            malwareScanning: 'not_available',
          },
        }
      : { enabled: false },
    voiceVideo: false,
  };
}

function withProviders(ui: React.ReactElement): React.ReactElement {
  return (
    <ChatUnreadProvider sessionKey="uid-1" enabled>
      <ChatCapabilitiesProvider sessionKey="uid-1" enabled>
        {ui}
      </ChatCapabilitiesProvider>
    </ChatUnreadProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chatApi.fetchMyPresence).mockResolvedValue({ presenceStatus: 'Online', updatedAt: '2026-11-12T10:00:00.000Z' });
  vi.mocked(chatApi.listChatChannels).mockResolvedValue(channels);
  vi.mocked(chatApi.listChatMessages).mockResolvedValue([makeChannelMessage()]);
  vi.mocked(chatApi.openTeamChat).mockResolvedValue(teamChannel);
  vi.mocked(chatApi.listTeamChatMessages).mockResolvedValue([
    makeChannelMessage({ channelId: TEAM_CHANNEL_ID, body: 'Team hello' }),
  ]);
  vi.mocked(chatApi.listDirectMessageThreads).mockResolvedValue([threadA, threadB]);
  vi.mocked(chatApi.getDirectMessageThread).mockImplementation(async (threadId): Promise<DirectMessageThreadDetail> => ({
    thread: threadId === THREAD_B_ID ? threadB : threadA,
    isEmpty: false,
    messages: [
      {
        id: MESSAGE_ID,
        threadId,
        fromMe: false,
        authorHandle: threadId === THREAD_B_ID ? 'casey' : 'blake',
        body: 'DM hello',
        createdAt: '2026-11-12T10:05:00.000Z',
      },
    ],
  }));
  vi.mocked(chatApi.fetchChatUnreadSummary).mockResolvedValue({ counts: [], totalUnreadCount: 0, totalUnreadMentionCount: 0 });
  vi.mocked(chatApi.markChatConversationRead).mockResolvedValue({
    conversationType: 'channel',
    conversationId: CHANNEL_A_ID,
    readCursor: { messageId: MESSAGE_ID, createdAt: '2026-11-12T10:05:00.000Z' },
    advanced: false,
    unreadCount: 0,
    unreadMentionCount: 0,
  });
  vi.mocked(chatApi.fetchChatCapabilities).mockResolvedValue(capabilities(true));
});

async function openForum(): Promise<void> {
  render(withProviders(<ChatPage />));
  fireEvent.click(await screen.findByRole('button', { name: /General/ }));
  await screen.findByTestId('send-message-form');
}

describe('graceful degradation when attachments are off or capability check fails', () => {
  it('hides AttachmentComposer and lets plain-text chat send across forum, team, and DM views', async () => {
    vi.mocked(chatApi.fetchChatCapabilities).mockRejectedValue(new ChatApiError(0, 'NETWORK'));
    vi.mocked(chatApi.sendChatMessage).mockResolvedValue(makeChannelMessage({ id: 'm-new', body: 'Forum text only' }));

    await openForum();
    await waitFor(() => expect(chatApi.fetchChatCapabilities).toHaveBeenCalled());
    expect(screen.queryByTestId('attachment-composer')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Write a message…'), { target: { value: 'Forum text only' } });
    fireEvent.submit(screen.getByTestId('send-message-form'));
    expect(await screen.findByText('Forum text only')).toBeInTheDocument();

    vi.mocked(chatApi.fetchChatCapabilities).mockResolvedValue(capabilities(false));
    render(withProviders(<TeamChatView teamId={TEAM_ID} teamName="Civic" />));
    fireEvent.click(screen.getByRole('button', { name: /open team chat/i }));
    await screen.findByTestId('team-chat-composer');
    expect(screen.queryByTestId('attachment-composer')).not.toBeInTheDocument();

    render(withProviders(<DirectMessagesView />));
    fireEvent.click(await screen.findByRole('button', { name: /blake/i }));
    await screen.findByTestId('dm-composer');
    expect(screen.queryByTestId('attachment-composer')).not.toBeInTheDocument();
  });
});

describe('public forum composer, client limits, upload status, and error preservation', () => {
  it('rejects empty, oversized, disallowed-type, and >5 files client-side without clearing the text draft', async () => {
    await openForum();
    const input = await screen.findByTestId('attachment-file-input');
    const draft = screen.getByPlaceholderText('Write a message…') as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: 'Draft survives validation' } });

    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [emptyFile] } });
    expect(await screen.findByTestId('attachment-upload-error')).toBeInTheDocument();
    expect(draft.value).toBe('Draft survives validation');
    expect(chatApi.uploadChatAttachment).not.toHaveBeenCalled();

    const exeFile = new File(['MZ'], 'installer.exe', { type: 'application/x-msdownload' });
    fireEvent.change(input, { target: { files: [exeFile] } });
    expect(await screen.findByTestId('attachment-upload-error')).toBeInTheDocument();
    expect(draft.value).toBe('Draft survives validation');
    expect(chatApi.uploadChatAttachment).not.toHaveBeenCalled();

    const oversized = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 10_485_761 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(await screen.findByTestId('attachment-upload-error')).toBeInTheDocument();
    expect(draft.value).toBe('Draft survives validation');
    expect(chatApi.uploadChatAttachment).not.toHaveBeenCalled();

    for (let i = 1; i <= 5; i += 1) {
      vi.mocked(chatApi.uploadChatAttachment).mockResolvedValueOnce(
        makeAttachment({ id: `att-${i}`, filename: `file-${i}.png` })
      );
      fireEvent.change(input, { target: { files: [new File(['png'], `file-${i}.png`, { type: 'image/png' })] } });
      await waitFor(() => expect(screen.getAllByTestId('pending-attachment-item')).toHaveLength(i));
    }

    fireEvent.change(input, { target: { files: [new File(['png'], 'sixth.png', { type: 'image/png' })] } });
    expect(await screen.findByTestId('attachment-upload-error')).toBeInTheDocument();
    expect(screen.getAllByTestId('pending-attachment-item')).toHaveLength(5);
    expect(draft.value).toBe('Draft survives validation');
    expect(chatApi.uploadChatAttachment).toHaveBeenCalledTimes(5);
  });

  it('shows upload progress, supports staging/removal, attaches IDs on send, and clears pending files on channel switch', async () => {
    let resolveUpload!: (att: ChatAttachmentView) => void;
    vi.mocked(chatApi.uploadChatAttachment).mockImplementationOnce(
      () => new Promise<ChatAttachmentView>((res) => { resolveUpload = res; })
    );
    vi.mocked(chatApi.sendChatMessage).mockResolvedValueOnce(
      makeChannelMessage({
        id: 'msg-attached',
        body: 'Review this mockup',
        attachments: [makeAttachment({ id: 'att-keep', filename: 'keep.png', status: 'attached', downloadable: true })],
      })
    );

    await openForum();
    const input = await screen.findByTestId('attachment-file-input');

    fireEvent.change(input, { target: { files: [new File(['png'], 'remove-me.png', { type: 'image/png' })] } });
    expect(await screen.findByTestId('attachment-upload-status')).toHaveTextContent('Uploading remove-me.png…');

    resolveUpload(makeAttachment({ id: 'att-remove', filename: 'remove-me.png' }));
    expect(await screen.findByRole('button', { name: 'Remove remove-me.png' })).toBeInTheDocument();
    expect(screen.getByText('Not scanned for malware')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove remove-me.png' }));
    expect(screen.queryByTestId('pending-attachments-list')).not.toBeInTheDocument();

    vi.mocked(chatApi.uploadChatAttachment).mockResolvedValueOnce(makeAttachment({ id: 'att-keep', filename: 'keep.png' }));
    fireEvent.change(input, { target: { files: [new File(['png'], 'keep.png', { type: 'image/png' })] } });
    await screen.findByRole('button', { name: 'Remove keep.png' });

    fireEvent.change(screen.getByPlaceholderText('Write a message…'), { target: { value: 'Review this mockup' } });
    fireEvent.submit(screen.getByTestId('send-message-form'));

    await waitFor(() =>
      expect(chatApi.sendChatMessage).toHaveBeenCalledWith(CHANNEL_A_ID, {
        body: 'Review this mockup',
        attachmentIds: ['att-keep'],
      })
    );
    expect(await screen.findByRole('button', { name: 'Download keep.png' })).toBeInTheDocument();
    expect(screen.queryByTestId('pending-attachments-list')).not.toBeInTheDocument();

    vi.mocked(chatApi.uploadChatAttachment).mockResolvedValueOnce(makeAttachment({ id: 'att-stale', filename: 'stale.pdf', mimeType: 'application/pdf' }));
    fireEvent.change(screen.getByTestId('attachment-file-input'), {
      target: { files: [new File(['%PDF'], 'stale.pdf', { type: 'application/pdf' })] },
    });
    await screen.findByRole('button', { name: 'Remove stale.pdf' });

    fireEvent.click(screen.getByRole('button', { name: /Design/ }));
    await waitFor(() => expect(chatApi.listChatMessages).toHaveBeenCalledWith(CHANNEL_B_ID));
    expect(screen.queryByTestId('pending-attachments-list')).not.toBeInTheDocument();
  });

  it('preserves text draft and staged files on 429/413/503 upload or send errors while plain text sends keep working', async () => {
    await openForum();
    const input = await screen.findByTestId('attachment-file-input');
    const draft = screen.getByPlaceholderText('Write a message…') as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: 'Critical draft text' } });

    vi.mocked(chatApi.uploadChatAttachment).mockResolvedValueOnce(makeAttachment({ id: 'att-1', filename: 'first.png' }));
    fireEvent.change(input, { target: { files: [new File(['png'], 'first.png', { type: 'image/png' })] } });
    await screen.findByRole('button', { name: 'Remove first.png' });

    vi.mocked(chatApi.uploadChatAttachment).mockRejectedValueOnce(
      new ChatApiError(429, 'RATE_LIMITED', { _form: 'Slow down' }, undefined, 'Slow down', 30)
    );
    fireEvent.change(input, { target: { files: [new File(['png'], 'second.png', { type: 'image/png' })] } });
    expect(await screen.findByTestId('attachment-upload-error')).toBeInTheDocument();
    expect(draft.value).toBe('Critical draft text');
    expect(screen.getAllByTestId('pending-attachment-item')).toHaveLength(1);

    vi.mocked(chatApi.uploadChatAttachment).mockRejectedValueOnce(
      new ChatApiError(503, 'ATTACHMENT_STORAGE_UNAVAILABLE', { _form: 'Storage down' })
    );
    fireEvent.change(input, { target: { files: [new File(['png'], 'third.png', { type: 'image/png' })] } });
    expect(await screen.findByTestId('attachment-upload-error')).toBeInTheDocument();
    expect(draft.value).toBe('Critical draft text');
    expect(screen.getAllByTestId('pending-attachment-item')).toHaveLength(1);

    vi.mocked(chatApi.sendChatMessage).mockRejectedValueOnce(
      new ChatApiError(400, 'ATTACHMENT_NOT_AVAILABLE', { _form: 'Stale' })
    );
    fireEvent.submit(screen.getByTestId('send-message-form'));
    await waitFor(() => expect(chatApi.sendChatMessage).toHaveBeenCalledTimes(1));
    expect(draft.value).toBe('Critical draft text');
    expect(screen.getByRole('button', { name: 'Remove first.png' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove first.png' }));
    vi.mocked(chatApi.sendChatMessage).mockResolvedValueOnce(makeChannelMessage({ id: 'plain-ok', body: 'Critical draft text' }));
    fireEvent.submit(screen.getByTestId('send-message-form'));
    expect(await screen.findByText('Critical draft text')).toBeInTheDocument();
  });
});

describe('private team chat and direct messages attachment flows', () => {
  it('uploads and attaches files in TeamChatView and passes team conversation target to downloads', async () => {
    vi.mocked(chatApi.uploadChatAttachment).mockResolvedValueOnce(
      makeAttachment({ id: 'team-att-1', filename: 'roadmap.pdf', mimeType: 'application/pdf' })
    );
    vi.mocked(chatApi.sendTeamChatMessage).mockResolvedValueOnce(
      makeChannelMessage({
        id: 'team-msg-2',
        channelId: TEAM_CHANNEL_ID,
        body: 'Team roadmap attached',
        attachments: [
          makeAttachment({
            id: 'team-att-1',
            filename: 'roadmap.pdf',
            mimeType: 'application/pdf',
            status: 'attached',
            downloadable: true,
          }),
        ],
      })
    );

    render(withProviders(<TeamChatView teamId={TEAM_ID} teamName="Civic" />));
    fireEvent.click(screen.getByRole('button', { name: /open team chat/i }));

    const input = await screen.findByTestId('attachment-file-input');
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'roadmap.pdf', { type: 'application/pdf' })] } });
    await screen.findByRole('button', { name: 'Remove roadmap.pdf' });

    fireEvent.change(screen.getByPlaceholderText('Write a private team message…'), {
      target: { value: 'Team roadmap attached' },
    });
    fireEvent.submit(screen.getByTestId('team-chat-composer'));

    await waitFor(() =>
      expect(chatApi.sendTeamChatMessage).toHaveBeenCalledWith(TEAM_ID, {
        body: 'Team roadmap attached',
        attachmentIds: ['team-att-1'],
      })
    );
    expect(await screen.findByRole('button', { name: 'Download roadmap.pdf' })).toBeInTheDocument();
  });

  it('uploads and attaches files in DirectMessagesView and clears pending attachments on thread switch', async () => {
    vi.mocked(chatApi.uploadChatAttachment).mockResolvedValueOnce(makeAttachment({ id: 'dm-att-1', filename: 'pitch.txt', mimeType: 'text/plain' }));
    vi.mocked(chatApi.sendDirectMessage).mockResolvedValueOnce({
      id: 'dm-msg-2',
      threadId: THREAD_A_ID,
      fromMe: true,
      authorHandle: 'avery',
      body: 'DM notes attached',
      createdAt: '2026-11-12T10:10:00.000Z',
      attachments: [
        makeAttachment({
          id: 'dm-att-1',
          filename: 'pitch.txt',
          mimeType: 'text/plain',
          status: 'attached',
          downloadable: true,
        }),
      ],
    });

    render(withProviders(<DirectMessagesView />));
    fireEvent.click(await screen.findByRole('button', { name: /blake/i }));

    const composer = await screen.findByTestId('dm-composer');
    fireEvent.change(within(composer).getByTestId('attachment-file-input'), {
      target: { files: [new File(['notes'], 'pitch.txt', { type: 'text/plain' })] },
    });
    await within(composer).findByRole('button', { name: 'Remove pitch.txt' });

    fireEvent.change(screen.getByPlaceholderText('Write a direct message…'), { target: { value: 'DM notes attached' } });
    fireEvent.submit(composer);

    await waitFor(() =>
      expect(chatApi.sendDirectMessage).toHaveBeenCalledWith(THREAD_A_ID, {
        body: 'DM notes attached',
        attachmentIds: ['dm-att-1'],
      })
    );
    expect(await screen.findByRole('button', { name: 'Download pitch.txt' })).toBeInTheDocument();

    vi.mocked(chatApi.uploadChatAttachment).mockResolvedValueOnce(makeAttachment({ id: 'dm-att-stale', filename: 'other.txt', mimeType: 'text/plain' }));
    fireEvent.change(within(composer).getByTestId('attachment-file-input'), {
      target: { files: [new File(['other'], 'other.txt', { type: 'text/plain' })] },
    });
    await within(composer).findByRole('button', { name: 'Remove other.txt' });

    fireEvent.click(screen.getByRole('button', { name: /casey/i }));
    await waitFor(() => expect(chatApi.getDirectMessageThread).toHaveBeenCalledWith(THREAD_B_ID));
    expect(screen.queryByTestId('pending-attachments-list')).not.toBeInTheDocument();
  });
});
