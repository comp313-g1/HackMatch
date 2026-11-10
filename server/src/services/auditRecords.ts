import {
  auditRecordsRepository,
  type AuditCategory,
  type AuditQueryParams,
  type AuditRecordRow,
  type IAuditRecordsRepository,
} from '../db/auditRecords.repository.js';
import { scrubPrivateAccountFields } from './accountPrivacy.js';
import { scrubPrivateModerationFields } from './moderationPrivacy.js';

/**
 * US-028 / #258 audit-record view (AC 2): record ID, actor identifier, action
 * type, target, safe state summary, reason/outcome, and UTC time. The actor is
 * identified by participant id only (never email or name), so the audit trail
 * needs no extra pseudonymization (NR-023).
 */
export interface AuditRecordView {
  id: string;
  actorId: string;
  actionType: string;
  category: AuditCategory;
  targetType: string;
  targetId: string;
  reason: string;
  outcome: string;
  safeStateSummary: Record<string, unknown>;
  createdAt: string;
}

export interface AuditQueryView {
  records: AuditRecordView[];
  hasMore: boolean;
  nextCursor: string | null;
}

export class AuditServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'AuditServiceError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function encodeAuditCursor(cursor: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url');
}

/** Private-contact keys that neither existing scrubber covers (FR-079: omit private contacts). */
const EXTRA_PRIVATE_KEY_PATTERN = /^(phone|phone_?number|mobile|mobile_?number|address)$/i;

function scrubExtraPrivateKeys<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubExtraPrivateKeys(item)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (EXTRA_PRIVATE_KEY_PATTERN.test(key)) continue;
    out[key] = scrubExtraPrivateKeys(child);
  }
  return out as T;
}

/**
 * Summaries are scrubbed again on read (defense in depth): the writer already strips
 * credentials / private contacts, but an older or directly-inserted row must not leak
 * them through the audit view. Both scrubbers run for every record because their key
 * sets differ (e.g. the account scrubber does not cover `email`), so the result never
 * depends on which action family a row belongs to.
 */
export function scrubAuditSummary(summary: Record<string, unknown> | null): Record<string, unknown> {
  return scrubExtraPrivateKeys(
    scrubPrivateAccountFields(scrubPrivateModerationFields(summary ?? {}))
  );
}

export function toAuditRecordView(row: AuditRecordRow): AuditRecordView {
  return {
    id: row.id,
    actorId: row.actorId,
    actionType: row.actionType,
    category: row.category,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    outcome: row.outcome,
    safeStateSummary: scrubAuditSummary(row.safeStateSummary),
    createdAt: row.createdAt,
  };
}

function parseDetails(err: unknown): Record<string, string> | undefined {
  const details = (err as { details?: unknown })?.details;
  if (typeof details !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      );
    }
  } catch {
    /* DETAIL was not JSON */
  }
  return undefined;
}

function toAuditServiceError(err: unknown): AuditServiceError | null {
  const message = err instanceof Error ? err.message : (err as { message?: unknown })?.message;
  if (typeof message !== 'string') return null;
  if (message.includes('FORBIDDEN_NOT_ADMIN')) {
    return new AuditServiceError(403, 'FORBIDDEN_NOT_ADMIN', 'Administrator access is required.');
  }
  if (message.includes('VALIDATION_ERROR')) {
    return new AuditServiceError(400, 'VALIDATION_ERROR', 'Validation failed.', parseDetails(err));
  }
  return null;
}

export async function queryAuditRecords(
  adminId: string,
  params: AuditQueryParams,
  repository: IAuditRecordsRepository = auditRecordsRepository
): Promise<AuditQueryView> {
  try {
    const result = await repository.query(adminId, params);
    return {
      records: (result.records ?? []).map(toAuditRecordView),
      hasMore: Boolean(result.hasMore),
      nextCursor: result.nextCursor ? encodeAuditCursor(result.nextCursor) : null,
    };
  } catch (err) {
    throw toAuditServiceError(err) ?? err;
  }
}
