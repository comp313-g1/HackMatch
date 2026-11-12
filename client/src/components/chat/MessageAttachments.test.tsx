/**
 * US-035 / #411 — MessageAttachments component tests: capability gating,
 * explicit "Not scanned for malware" labeling, raster-only preview lifecycle
 * and object-URL revocation, PDF/TXT download-only controls, scan-block states,
 * and inline error recovery.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as chatApi from './chatApi';
import { ChatApiError } from './chatApi';
import { ChatCapabilitiesProvider } from './ChatCapabilitiesContext';
import { MessageAttachments } from './MessageAttachments';
import { CHAT_ATTACHMENT_MIME_TYPES, type ChatAttachmentView, type ChatConversationTarget } from './chatTypes';

vi.mock('./chatApi', async () => {
  const actual = await vi.importActual<typeof import('./chatApi')>('./chatApi');
  return {
    ...actual,
    fetchChatCapabilities: vi.fn(),
    requestChatAttachmentAccess: vi.fn(),
    fetchAttachmentContentBlob: vi.fn(),
  };
});

const TARGET: ChatConversationTarget = { kind: 'channel', channelId: '11111111-1111-4111-8111-111111111111' };

function capabilities(enabled: boolean) {
  return {
    reactions: { enabled: false as const, allowedReactions: [] },
    typing: { enabled: false as const },
    attachments: enabled
      ? {
          enabled: true as const,
          limits: {
            maxBytes: 10_485_760,
            maxPerMessage: 5,
            allowedTypes: [...CHAT_ATTACHMENT_MIME_TYPES],
            malwareScanning: 'not_available' as const,
          },
        }
      : { enabled: false as const },
    voiceVideo: false as const,
  };
}

function makeAttachment(overrides: Partial<ChatAttachmentView> = {}): ChatAttachmentView {
  return {
    id: 'att-1',
    filename: 'diagram.png',
    mimeType: 'image/png',
    sizeBytes: 2048,
    scanStatus: 'not_scanned',
    status: 'attached',
    downloadable: true,
    ...overrides,
  };
}

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const createObjectUrlSpy = vi.fn();
const revokeObjectUrlSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  createObjectUrlSpy.mockReset().mockReturnValue('blob:http://localhost/preview-1');
  revokeObjectUrlSpy.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectUrlSpy });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectUrlSpy });

  vi.mocked(chatApi.fetchChatCapabilities).mockResolvedValue(capabilities(true));
  vi.mocked(chatApi.requestChatAttachmentAccess).mockResolvedValue({
    url: '/api/chat/attachments/content?token=valid-token',
    expiresAt: '2026-11-12T12:01:00.000Z',
  });
  vi.mocked(chatApi.fetchAttachmentContentBlob).mockResolvedValue(new Blob(['bytes'], { type: 'image/png' }));
});

afterEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectUrl });
});

function renderAttachments(attachments: ChatAttachmentView[], enabled = true) {
  return render(
    <ChatCapabilitiesProvider sessionKey="uid-1" enabled={enabled}>
      <MessageAttachments target={TARGET} attachments={attachments} />
    </ChatCapabilitiesProvider>
  );
}

describe('MessageAttachments capability gate and scan labeling', () => {
  it('renders nothing when attachments capability is disabled or session is inactive', async () => {
    vi.mocked(chatApi.fetchChatCapabilities).mockResolvedValue(capabilities(false));
    renderAttachments([makeAttachment()]);
    await waitFor(() => expect(chatApi.fetchChatCapabilities).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('message-attachments')).not.toBeInTheDocument();

    render(
      <ChatCapabilitiesProvider sessionKey="uid-admin" enabled={false}>
        <MessageAttachments target={TARGET} attachments={[makeAttachment()]} />
      </ChatCapabilitiesProvider>
    );
    expect(screen.queryByTestId('message-attachments')).not.toBeInTheDocument();
  });

  it('always labels not_scanned files explicitly as "Not scanned for malware"', async () => {
    renderAttachments([makeAttachment({ filename: 'architecture.pdf', mimeType: 'application/pdf' })]);
    expect(await screen.findByText('Not scanned for malware')).toBeInTheDocument();
    expect(screen.getByText('architecture.pdf')).toBeInTheDocument();
  });

  it.each(['pending', 'infected', 'scan_failed'] as const)(
    'blocks %s attachments from previewing or downloading with accessible feedback',
    async (scanStatus) => {
      renderAttachments([
        makeAttachment({
          id: `att-${scanStatus}`,
          filename: 'photo.png',
          mimeType: 'image/png',
          scanStatus,
          downloadable: false,
        }),
      ]);

      const downloadBtn = await screen.findByRole('button', { name: 'Download photo.png' });
      expect(downloadBtn).toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByRole('button', { name: 'Preview photo.png' })).not.toBeInTheDocument();
      expect(screen.getByTestId('attachment-scan-blocked')).toBeInTheDocument();

      fireEvent.click(downloadBtn);
      expect(chatApi.requestChatAttachmentAccess).not.toHaveBeenCalled();
    }
  );
});

describe('MessageAttachments preview and download behavior', () => {
  it('toggles raster image previews using safe alt text and revokes object URLs on hide and unmount', async () => {
    const view = renderAttachments([makeAttachment({ id: 'img-1', filename: 'wireframe.png', mimeType: 'image/png' })]);

    const previewBtn = await screen.findByRole('button', { name: 'Preview wireframe.png' });
    fireEvent.click(previewBtn);

    const img = await screen.findByRole('img', { name: 'wireframe.png' });
    expect(img).toHaveAttribute('src', 'blob:http://localhost/preview-1');
    expect(chatApi.requestChatAttachmentAccess).toHaveBeenCalledWith(TARGET, 'img-1');
    expect(chatApi.fetchAttachmentContentBlob).toHaveBeenCalledWith('/api/chat/attachments/content?token=valid-token');

    const hideBtn = screen.getByRole('button', { name: 'Hide preview of wireframe.png' });
    expect(hideBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hideBtn);

    expect(screen.queryByRole('img', { name: 'wireframe.png' })).not.toBeInTheDocument();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:http://localhost/preview-1');

    view.unmount();

    createObjectUrlSpy.mockReturnValueOnce('blob:http://localhost/preview-2');
    const secondView = renderAttachments([makeAttachment({ id: 'img-2', filename: 'second.png', mimeType: 'image/png' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview second.png' }));
    await screen.findByRole('img', { name: 'second.png' });

    secondView.unmount();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:http://localhost/preview-2');
  });

  it('offers download-only (never inline preview) for PDF and plain-text attachments', async () => {
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      renderAttachments([
        makeAttachment({ id: 'pdf-1', filename: 'spec.pdf', mimeType: 'application/pdf' }),
        makeAttachment({ id: 'txt-1', filename: 'notes.txt', mimeType: 'text/plain' }),
      ]);

      expect(await screen.findByRole('button', { name: 'Download spec.pdf' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download notes.txt' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Preview/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Download spec.pdf' }));
      await waitFor(() => expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:http://localhost/preview-1'));
      expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    } finally {
      anchorClickSpy.mockRestore();
    }
  });

  it('surfaces inline role="alert" recovery when storage is unavailable and degrades on FEATURE_DISABLED', async () => {
    vi.mocked(chatApi.requestChatAttachmentAccess).mockRejectedValueOnce(
      new ChatApiError(503, 'ATTACHMENT_STORAGE_UNAVAILABLE', { _form: 'Down' })
    );

    renderAttachments([makeAttachment({ id: 'img-err', filename: 'screen.png', mimeType: 'image/png' })]);

    fireEvent.click(await screen.findByRole('button', { name: 'Download screen.png' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent(/^$/);

    vi.mocked(chatApi.requestChatAttachmentAccess).mockResolvedValueOnce({
      url: '/api/chat/attachments/content?token=retry-ok',
      expiresAt: '2026-11-12T12:02:00.000Z',
    });
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Download screen.png' }));
      await waitFor(() => expect(anchorClickSpy).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      anchorClickSpy.mockRestore();
    }

    vi.mocked(chatApi.requestChatAttachmentAccess).mockRejectedValueOnce(
      new ChatApiError(404, 'FEATURE_DISABLED', { _form: 'Disabled' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview screen.png' }));
    await waitFor(() => expect(screen.queryByTestId('message-attachments')).not.toBeInTheDocument());
  });
});
