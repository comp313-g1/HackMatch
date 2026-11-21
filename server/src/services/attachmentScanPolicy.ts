import { config } from '../config/index.js';
import type { AttachmentScanStatus } from '../db/chatAttachmentModel.js';

/**
 * US-035 / #409 — malware-scanning reality and the gate it imposes
 * (#404 policy, section 6, "Malware scanning decision").
 *
 * HackMatch has NO malware scanner. Byte-signature type checks, the type
 * allowlist, size limits, and forced download headers reduce risk, but they are
 * NOT malware scanning, and nothing here ever reports a file as scanned or clean.
 *
 * Consequences while no scanner exists:
 *  - every upload is stored with scan_status 'not_scanned' (shown to people as
 *    "Not scanned for malware");
 *  - attachments are usable only outside production (local, test, or a
 *    synthetic-data demo run with NODE_ENV other than 'production'). With
 *    NODE_ENV=production the feature stays off even if RICH_CHAT_ATTACHMENTS_ENABLED
 *    is true, because policy requires an approved scanner before real
 *    participants' files are stored.
 *
 * When a real scanner is integrated, SCANNER_AVAILABLE becomes true, uploads start
 * 'pending', and only 'clean' files are downloadable. That path is deliberately not
 * implemented: there is nothing to call.
 */

/** No approved scanner integration exists in this repository. */
export const SCANNER_AVAILABLE: boolean = false;

export function isAttachmentFlagOn(): boolean {
  return config.richChat.attachmentsEnabled === true;
}

/** The feature is usable only when the flag is on AND the malware policy allows it. */
export function areAttachmentsUsable(): boolean {
  if (!isAttachmentFlagOn()) return false;
  if (SCANNER_AVAILABLE) return true;
  return config.nodeEnv !== 'production';
}

export function initialScanStatus(): AttachmentScanStatus {
  return SCANNER_AVAILABLE ? 'pending' : 'not_scanned';
}

/**
 * Whether a stored file may be served. 'pending', 'infected', and 'scan_failed'
 * never are. 'not_scanned' is served only while the unscanned (non-production)
 * mode applies; 'clean' only exists if a real scanner produced it.
 */
export function isScanStatusDownloadable(status: AttachmentScanStatus): boolean {
  if (!areAttachmentsUsable()) return false;
  if (status === 'clean') return SCANNER_AVAILABLE;
  return status === 'not_scanned' && !SCANNER_AVAILABLE;
}
