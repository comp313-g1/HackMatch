import React, { useEffect, useId, useRef, useState } from 'react';
import { uploadChatAttachment } from './chatApi';
import {
  ATTACHMENT_ACCEPT_ATTR,
  describeAttachmentError,
  formatByteSize,
  mimeBadgeLabel,
  scanBadgeLabel,
  validateAttachmentBeforeUpload,
} from './chatAttachmentDisplay';
import { useChatCapabilities } from './ChatCapabilitiesContext';
import {
  DEFAULT_CHAT_ATTACHMENT_LIMITS,
  type ChatAttachmentView,
  type ChatConversationTarget,
} from './chatTypes';

/**
 * US-035 / #410 — attachment composer for public forums, team chat, and DMs (#409 API).
 *
 *  - Hidden completely unless the server capability reports attachments enabled.
 *  - Enforces client pre-checks while preserving the caller's text draft and already-staged
 *    attachments on every validation, rate-limit, quota, or 503 storage error.
 *  - Every staged file explicitly states "Not scanned for malware" (`not_scanned`).
 */
export interface AttachmentComposerProps {
  target: ChatConversationTarget;
  pendingAttachments: ChatAttachmentView[];
  onPendingAttachmentsChange: React.Dispatch<React.SetStateAction<ChatAttachmentView[]>>;
  disabled?: boolean;
}

export function AttachmentComposer({
  target,
  pendingAttachments,
  onPendingAttachmentsChange,
  disabled = false,
}: AttachmentComposerProps): React.JSX.Element | null {
  const capability = useChatCapabilities();
  const inputId = useId();
  const policyNoteId = useId();
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const targetKey =
    target.kind === 'channel'
      ? `channel:${target.channelId}`
      : target.kind === 'team'
        ? `team:${target.teamId}`
        : `dm:${target.threadId}`;
  const activeTargetKey = useRef(targetKey);
  activeTargetKey.current = targetKey;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reset transient upload state when navigating to a different conversation.
  useEffect(() => {
    setUploadingName(null);
    setError(null);
  }, [targetKey]);

  if (!capability.attachmentsEnabled) return null;

  const limits = capability.attachmentLimits ?? DEFAULT_CHAT_ATTACHMENT_LIMITS;
  const maxReached = pendingAttachments.length >= limits.maxPerMessage;
  const busy = uploadingName !== null;
  const inputDisabled = disabled || busy || maxReached;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const selectedFiles = event.target.files ? Array.from(event.target.files) : [];
    // Clear the native input value immediately so re-selecting a fixed/removed file triggers onChange.
    event.target.value = '';
    if (selectedFiles.length === 0 || disabled || busy) return;

    setError(null);
    const runTargetKey = targetKey;
    let currentCount = pendingAttachments.length;

    for (const file of selectedFiles) {
      const localError = validateAttachmentBeforeUpload(file, currentCount, limits);
      if (localError) {
        setError(localError);
        break;
      }

      setUploadingName(file.name);
      try {
        const uploaded = await uploadChatAttachment(target, file);
        if (!mounted.current || activeTargetKey.current !== runTargetKey) return;
        currentCount += 1;
        onPendingAttachmentsChange((prev) =>
          prev.some((item) => item.id === uploaded.id) ? prev : [...prev, uploaded]
        );
      } catch (err: unknown) {
        if (!mounted.current || activeTargetKey.current !== runTargetKey) return;
        const message = describeAttachmentError(err, capability.markAttachmentsUnavailable, 'upload');
        if (message) setError(message);
        break;
      }
    }

    if (mounted.current && activeTargetKey.current === runTargetKey) {
      setUploadingName(null);
    }
  };

  const handleRemove = (attachmentId: string): void => {
    setError(null);
    onPendingAttachmentsChange((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  return (
    <div className="space-y-2" data-testid="attachment-composer">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className={`inline-flex items-center rounded-md border border-cream-300 bg-white px-3 py-1.5 text-xs font-semibold text-forest-800 shadow-sm focus-within:ring-2 focus-within:ring-forest ${
            inputDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-cream-50'
          }`}
        >
          Attach file
        </label>
        <input
          id={inputId}
          type="file"
          accept={ATTACHMENT_ACCEPT_ATTR}
          multiple
          disabled={inputDisabled}
          aria-describedby={policyNoteId}
          onChange={(event) => void handleFileChange(event)}
          className="sr-only"
          data-testid="attachment-file-input"
        />
        <span className="text-xs text-ink-muted">
          {pendingAttachments.length}/{limits.maxPerMessage} attached
        </span>
      </div>

      <p id={policyNoteId} className="text-xs text-ink-muted">
        Up to {limits.maxPerMessage} files (max {formatByteSize(limits.maxBytes)} each;
        PNG, JPEG, GIF, WebP, PDF, or UTF-8 TXT). Uploaded files are not scanned for malware.
      </p>

      {uploadingName && (
        <p
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-testid="attachment-upload-status"
          className="text-xs font-medium text-forest-800"
        >
          Uploading {uploadingName}…
        </p>
      )}

      {error && (
        <p role="alert" data-testid="attachment-upload-error" className="text-xs text-red-700">
          {error}
        </p>
      )}

      {pendingAttachments.length > 0 && (
        <ul
          aria-label="Pending attachments"
          data-testid="pending-attachments-list"
          className="space-y-1.5"
        >
          {pendingAttachments.map((attachment) => (
            <li
              key={attachment.id}
              data-testid="pending-attachment-item"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-cream-200 bg-cream-50 px-2.5 py-1.5 text-xs"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="max-w-[16rem] truncate font-medium text-forest-900">
                  {attachment.filename}
                </span>
                <span className="rounded border border-cream-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
                  {mimeBadgeLabel(attachment.mimeType)}
                </span>
                <span className="text-ink-muted">{formatByteSize(attachment.sizeBytes)}</span>
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                  {scanBadgeLabel(attachment.scanStatus)}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Remove ${attachment.filename}`}
                disabled={disabled || busy}
                onClick={() => handleRemove(attachment.id)}
                className="rounded border border-cream-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
