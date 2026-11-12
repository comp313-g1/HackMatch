import React, { useEffect, useRef, useState } from 'react';
import { fetchAttachmentContentBlob, requestChatAttachmentAccess } from './chatApi';
import {
  blockedScanReason,
  describeAttachmentError,
  formatByteSize,
  isDownloadableScanStatus,
  isRasterAttachmentMime,
  mimeBadgeLabel,
  scanBadgeLabel,
} from './chatAttachmentDisplay';
import { useChatCapabilities } from './ChatCapabilitiesContext';
import type { ChatAttachmentView, ChatConversationTarget } from './chatTypes';

/**
 * US-035 / #410 — authorized attachment list, raster image preview, and download
 * controls for one chat message (#409 API).
 *
 *  - Rendered filenames strictly as text nodes (never dangerouslySetInnerHTML).
 *  - `not_scanned` attachments always display an explicit "Not scanned for malware" badge.
 *  - Only downloadable raster images (`isRasterAttachmentMime`) may preview inline as an `<img>`
 *    fetched via the 60s `/api/chat/attachments/content?token=...` endpoint; PDF and TXT are
 *    download-only.
 *  - Object URLs created for previews are tracked and revoked on hide or unmount.
 */
export interface MessageAttachmentsProps {
  target: ChatConversationTarget;
  attachments?: ChatAttachmentView[];
}

export function MessageAttachments({
  target,
  attachments,
}: MessageAttachmentsProps): React.JSX.Element | null {
  const capability = useChatCapabilities();
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [errorsById, setErrorsById] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  const activeUrls = useRef<string[]>([]);

  useEffect(() => {
    mounted.current = true;
    const urls = activeUrls.current;
    return () => {
      mounted.current = false;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.length = 0;
    };
  }, []);

  if (!capability.attachmentsEnabled || !attachments || attachments.length === 0) {
    return null;
  }

  const clearError = (attachmentId: string): void => {
    setErrorsById((prev) => {
      if (!prev[attachmentId]) return prev;
      const next = { ...prev };
      delete next[attachmentId];
      return next;
    });
  };

  const handleTogglePreview = async (attachment: ChatAttachmentView): Promise<void> => {
    const existingUrl = previewUrls[attachment.id];
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl);
      activeUrls.current = activeUrls.current.filter((u) => u !== existingUrl);
      setPreviewUrls((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
      return;
    }

    clearError(attachment.id);
    setLoadingPreviewId(attachment.id);
    try {
      const access = await requestChatAttachmentAccess(target, attachment.id);
      const blob = await fetchAttachmentContentBlob(access.url);
      const objectUrl = URL.createObjectURL(blob);
      if (!mounted.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      activeUrls.current.push(objectUrl);
      setPreviewUrls((prev) => ({ ...prev, [attachment.id]: objectUrl }));
    } catch (err: unknown) {
      if (!mounted.current) return;
      const msg = describeAttachmentError(err, capability.markAttachmentsUnavailable, 'download');
      if (msg) {
        setErrorsById((prev) => ({ ...prev, [attachment.id]: msg }));
      }
    } finally {
      if (mounted.current) {
        setLoadingPreviewId((current) => (current === attachment.id ? null : current));
      }
    }
  };

  const handleDownload = async (attachment: ChatAttachmentView): Promise<void> => {
    clearError(attachment.id);
    setDownloadingId(attachment.id);
    try {
      const access = await requestChatAttachmentAccess(target, attachment.id);
      const blob = await fetchAttachmentContentBlob(access.url);
      if (!mounted.current) return;
      const objectUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = attachment.filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (err: unknown) {
      if (!mounted.current) return;
      const msg = describeAttachmentError(err, capability.markAttachmentsUnavailable, 'download');
      if (msg) {
        setErrorsById((prev) => ({ ...prev, [attachment.id]: msg }));
      }
    } finally {
      if (mounted.current) {
        setDownloadingId((current) => (current === attachment.id ? null : current));
      }
    }
  };

  return (
    <ul
      aria-label="Message attachments"
      data-testid="message-attachments"
      className="mt-2 space-y-2"
    >
      {attachments.map((attachment) => {
        const allowedToDownload =
          attachment.downloadable && isDownloadableScanStatus(attachment.scanStatus);
        const canPreview = allowedToDownload && isRasterAttachmentMime(attachment.mimeType);
        const previewUrl = previewUrls[attachment.id];
        const previewBusy = loadingPreviewId === attachment.id;
        const downloadBusy = downloadingId === attachment.id;
        const itemError = errorsById[attachment.id];
        const scanLabel = scanBadgeLabel(attachment.scanStatus);
        const blockedText = blockedScanReason(attachment.scanStatus);

        return (
          <li
            key={attachment.id}
            data-testid="message-attachment-item"
            className="rounded-md border border-cream-200 bg-white p-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="max-w-[16rem] truncate font-semibold text-forest-900">
                  {attachment.filename}
                </span>
                <span className="rounded border border-cream-200 bg-cream-50 px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
                  {mimeBadgeLabel(attachment.mimeType)}
                </span>
                <span className="text-ink-muted">{formatByteSize(attachment.sizeBytes)}</span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                    attachment.scanStatus === 'infected' || attachment.scanStatus === 'scan_failed'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {scanLabel}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {canPreview && (
                  <button
                    type="button"
                    aria-label={
                      previewUrl
                        ? `Hide preview of ${attachment.filename}`
                        : `Preview ${attachment.filename}`
                    }
                    aria-pressed={Boolean(previewUrl)}
                    disabled={previewBusy || downloadBusy}
                    onClick={() => void handleTogglePreview(attachment)}
                    className="rounded border border-cream-300 bg-white px-2 py-1 text-[11px] font-semibold text-forest-800 hover:bg-cream-50 disabled:opacity-50"
                  >
                    {previewBusy ? 'Loading…' : previewUrl ? 'Hide preview' : 'Preview'}
                  </button>
                )}

                <button
                  type="button"
                  aria-label={`Download ${attachment.filename}`}
                  aria-disabled={!allowedToDownload || downloadBusy || undefined}
                  disabled={!allowedToDownload || downloadBusy}
                  onClick={() => {
                    if (!allowedToDownload || downloadBusy) return;
                    void handleDownload(attachment);
                  }}
                  className="rounded border border-forest-200 bg-forest-50 px-2 py-1 text-[11px] font-semibold text-forest-900 hover:bg-forest-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloadBusy ? 'Downloading…' : 'Download'}
                </button>
              </div>
            </div>

            {blockedText && (
              <p className="mt-1.5 text-[11px] text-red-700" data-testid="attachment-scan-blocked">
                {blockedText}
              </p>
            )}

            {previewUrl && (
              <div className="mt-2">
                <img
                  src={previewUrl}
                  alt={attachment.filename}
                  className="max-h-48 max-w-full rounded border border-cream-200 object-contain"
                />
              </div>
            )}

            {itemError && (
              <p role="alert" className="mt-1.5 text-[11px] text-red-700">
                {itemError}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
