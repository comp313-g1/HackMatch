import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { createChatReactionDb } from './chatReactions.testUtils.js';

/**
 * US-035 / #409 test fixture: the #405 chat fixture (real chat, DM, block, cursor,
 * unread, mention, and reaction migrations) plus the real 0052 team-channel
 * lifecycle guards and the 0068 attachment migration. PGlite has no `storage`
 * schema, so 0068's bucket step is skipped exactly as written.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');
export const ATTACHMENT_MIGRATION = '0068_create_chat_message_attachments.sql';
export const attachmentMigrationSql = (): string => fs.readFileSync(path.join(MIGRATIONS, ATTACHMENT_MIGRATION), 'utf8');

export async function createChatAttachmentDb(): Promise<PGlite> {
  const db = await createChatReactionDb();
  await db.exec(fs.readFileSync(path.join(MIGRATIONS, '0052_enforce_team_channel_lifecycle.sql'), 'utf8'));
  await db.exec(attachmentMigrationSql());
  return db;
}

const bytes = (...parts: Array<number[] | string>): Uint8Array =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)));

/** Minimal byte samples whose leading bytes carry each approved signature. */
export const SAMPLE_FILES = {
  png: { name: 'photo.png', bytes: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13]) },
  jpeg: { name: 'photo.jpg', bytes: bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF') },
  gif: { name: 'anim.gif', bytes: bytes('GIF89a', [1, 0, 1, 0]) },
  webp: { name: 'pic.webp', bytes: bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ') },
  pdf: { name: 'brief.pdf', bytes: bytes('%PDF-1.7\n') },
  text: { name: 'notes.txt', bytes: new TextEncoder().encode('plain notes\n') },
} as const;
