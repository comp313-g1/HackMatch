import type { NextFunction, Request, Response } from 'express';
import Busboy from 'busboy';
import { ATTACHMENT_MAX_BYTES } from '../db/chatAttachmentModel.js';
import { areAttachmentsUsable } from '../services/attachmentScanPolicy.js';
import {
  AttachmentRateLimitError,
  issueAttachmentAccess,
  maybeRunAttachmentMaintenance,
  precheckAttachmentUpload,
  uploadAttachment,
  type AttachmentConversation,
} from '../services/chatAttachments.js';
import { UUID_REGEX } from '../validators/team.validator.js';
import { ChatServiceError } from '../services/chat.js';

/**
 * US-035 / #409 — request gates for attachment routes. They run after the PART
 * auth chain, so `req.participant` is the authenticated caller.
 */

function deny(res: Response, status: number, code: string, error: string, extra: Record<string, unknown> = {}): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ error, code, ...extra });
}

/**
 * Off unless RICH_CHAT_ATTACHMENTS_ENABLED is on AND the malware policy allows the
 * feature (no scanner exists, so never under NODE_ENV=production).
 */
export function requireAttachmentsUsable(_req: Request, res: Response, next: NextFunction): void {
  if (!areAttachmentsUsable()) {
    deny(res, 404, 'FEATURE_DISABLED', 'This chat feature is not available.');
    return;
  }
  next();
}

/** Message sends that reference attachments are refused while the feature is off. */
export function rejectAttachmentIdsWhenUnavailable(req: Request, res: Response, next: NextFunction): void {
  const ids = (req.body as { attachmentIds?: unknown } | undefined)?.attachmentIds;
  if (Array.isArray(ids) && ids.length > 0 && !areAttachmentsUsable()) {
    deny(res, 404, 'FEATURE_DISABLED', 'This chat feature is not available.');
    return;
  }
  next();
}

/**
 * Refuses unsupported transports and callers that are already over their hourly
 * or storage limits before parsing the multipart body. The authoritative quota
 * check still happens under the database participant lock when the file is
 * reserved because multipart Content-Length includes framing bytes.
 */
export async function precheckAttachmentRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.is('multipart/form-data')) {
    deny(res, 400, 'VALIDATION_ERROR', 'Send one file as multipart form data.', {
      errors: { file: 'Send one file in the multipart field named file.' },
    });
    return;
  }
  try {
    await precheckAttachmentUpload(req.participant!.id, null);
  } catch (err) {
    if (err instanceof AttachmentRateLimitError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
      res.setHeader('Connection', 'close');
      deny(res, 429, err.code, err.message, { retryAfterSeconds: err.retryAfterSeconds });
      req.resume();
      return;
    }
    if (err instanceof ChatServiceError) {
      res.setHeader('Connection', 'close');
      deny(res, err.status, err.code, err.message);
      req.resume();
      return;
    }
    next(err);
    return;
  }
  next();
}

/**
 * Parses exactly one multipart `file` part and counts bytes as they arrive. Busboy
 * stops retaining file content at the 10 MB boundary and reports truncation for
 * the first excess byte. Bytes and the untrusted display filename live only in
 * res.locals; neither is copied into req.body or structured request logs.
 */
export function readAttachmentBody(req: Request, res: Response, next: NextFunction): void {
  const chunks: Buffer[] = [];
  let total = 0;
  let filename: string | null = null;
  let fileCount = 0;
  let rejected = false;
  let parser: ReturnType<typeof Busboy>;

  const fail = (status: number, code: string, message: string, fieldMessage?: string): void => {
    if (rejected) return;
    rejected = true;
    chunks.length = 0;
    deny(res, status, code, message, fieldMessage ? { errors: { file: fieldMessage } } : {});
  };

  try {
    parser = Busboy({
      headers: req.headers,
      // Busboy's limit event fires when the configured value is reached. Read at
      // most the first excess byte so an exact 10 MB file remains valid.
      limits: { fileSize: ATTACHMENT_MAX_BYTES + 1, files: 2, fields: 1, parts: 2 },
    });
  } catch {
    fail(400, 'VALIDATION_ERROR', 'The multipart upload is invalid.', 'Send one file in the multipart field named file.');
    req.resume();
    return;
  }

  parser.on('file', (fieldName, stream, info) => {
    fileCount += 1;
    if (fieldName !== 'file' || fileCount > 1) {
      stream.resume();
      fail(
        400,
        'VALIDATION_ERROR',
        'The multipart upload is invalid.',
        fieldName !== 'file' ? 'Use the multipart field named file.' : 'Only one file is allowed per request.'
      );
      return;
    }
    filename = info.filename || null;
    stream.on('data', (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > ATTACHMENT_MAX_BYTES) {
        fail(413, 'ATTACHMENT_TOO_LARGE', 'Files can be at most 10 MB.');
        return;
      }
      chunks.push(chunk);
    });
    stream.once('limit', () => {
      fail(413, 'ATTACHMENT_TOO_LARGE', 'Files can be at most 10 MB.');
    });
    stream.once('error', () => {
      fail(400, 'VALIDATION_ERROR', 'The multipart upload could not be read.');
    });
  });
  parser.on('field', () => {
    fail(400, 'VALIDATION_ERROR', 'The multipart upload is invalid.', 'Only the file field is allowed.');
  });
  parser.once('filesLimit', () => {
    fail(400, 'VALIDATION_ERROR', 'Upload exactly one file.', 'Only one file is allowed per request.');
  });
  parser.once('fieldsLimit', () => {
    fail(400, 'VALIDATION_ERROR', 'The multipart upload is invalid.', 'Only the file field is allowed.');
  });
  parser.once('partsLimit', () => {
    fail(400, 'VALIDATION_ERROR', 'Upload exactly one file.', 'Only one file is allowed per request.');
  });
  parser.once('error', () => {
    fail(400, 'VALIDATION_ERROR', 'The multipart upload could not be read.');
  });
  parser.once('close', () => {
    if (rejected) return;
    if (fileCount !== 1 || !filename) {
      fail(400, 'VALIDATION_ERROR', 'A file is required.', 'Send one file in the multipart field named file.');
      return;
    }
    res.locals.attachmentFilename = filename;
    res.locals.attachmentBytes = new Uint8Array(Buffer.concat(chunks, total));
    next();
  });
  req.once('aborted', () => {
    rejected = true;
    chunks.length = 0;
    parser.destroy();
  });
  req.pipe(parser);
}

/** Runs bounded storage cleanup after the response, at most every few minutes. */
export function scheduleAttachmentMaintenance(_req: Request, res: Response, next: NextFunction): void {
  res.once('finish', () => void maybeRunAttachmentMaintenance());
  next();
}

// ---------------------------------------------------------------------------
// Shared route pieces for the public, team, and DM attachment routes
// ---------------------------------------------------------------------------

/** The `:attachmentId` path parameter must be a UUID. */
export function validateAttachmentIdParam(req: Request, res: Response, next: NextFunction): void {
  const raw = req.params.attachmentId;
  if (typeof raw !== 'string' || !UUID_REGEX.test(raw)) {
    deny(res, 400, 'VALIDATION_ERROR', 'Validation failed.', {
      errors: { attachmentId: 'attachmentId must be a valid UUID.' },
    });
    return;
  }
  next();
}

/**
 * Resolves (and send-checks) the target conversation BEFORE any byte is read, so a
 * missing or read-only conversation is refused without accepting the upload.
 */
export function resolveAttachmentConversation(
  resolve: (req: Request) => Promise<AttachmentConversation>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.locals.attachmentConversation = await resolve(req);
      next();
    } catch (err) {
      if (err instanceof ChatServiceError) {
        res.setHeader('Connection', 'close');
        deny(res, err.status, err.code, err.message);
        req.resume();
        return;
      }
      next(err);
    }
  };
}

/** Stores the streamed bytes for the caller and answers with the safe attachment view. */
export function attachmentUploadHandler(buildPayload: (data: Record<string, unknown>) => Record<string, unknown>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const attachment = await uploadAttachment({
        uploader: req.participant!,
        conversation: res.locals.attachmentConversation as AttachmentConversation,
        rawFilename: res.locals.attachmentFilename as string,
        bytes: res.locals.attachmentBytes as Uint8Array,
      });
      res.status(201).json(buildPayload({ status: 'ok', attachment }));
    } catch (err) {
      if (err instanceof AttachmentRateLimitError) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
        deny(res, 429, err.code, err.message, { retryAfterSeconds: err.retryAfterSeconds });
        return;
      }
      if (err instanceof ChatServiceError) {
        deny(res, err.status, err.code, err.message);
        return;
      }
      next(err);
    }
  };
}

/** Issues a 60-second download link after the route's READ guard and conversation check. */
export function attachmentAccessHandler(
  resolve: (req: Request) => Promise<AttachmentConversation>,
  buildPayload: (data: Record<string, unknown>) => Record<string, unknown>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const access = await issueAttachmentAccess({
        viewer: req.participant!,
        conversation: await resolve(req),
        attachmentId: String(req.params.attachmentId).toLowerCase(),
      });
      res.status(200).json(buildPayload({ status: 'ok', access }));
    } catch (err) {
      if (err instanceof ChatServiceError) {
        deny(res, err.status, err.code, err.message);
        return;
      }
      next(err);
    }
  };
}
