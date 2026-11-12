import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * US-035 / #405 test fixture: a PGlite database with the REAL chat, DM, block,
 * read-cursor, unread, mention, and reaction migrations, seeded with one public
 * forum, two team channels, and two DM threads. Teams and memberships use a
 * minimal stand-in table with the columns these migrations and repositories read.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');
const sqlOf = (file: string): string => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');

export const REACTION_MIGRATION = '0067_create_chat_message_reactions.sql';
export const reactionMigrationSql = (): string => sqlOf(REACTION_MIGRATION);

export const reactionIds = {
  reader: '10000000-0000-4000-8000-000000000001',
  peer: '20000000-0000-4000-8000-000000000002',
  outsider: '30000000-0000-4000-8000-000000000003',
  admin: '40000000-0000-4000-8000-000000000004',
  lurker: '50000000-0000-4000-8000-000000000005',
  publicChannel: '60000000-0000-4000-8000-000000000001',
  team: '61000000-0000-4000-8000-000000000001',
  otherTeam: '61000000-0000-4000-8000-000000000002',
  teamChannel: '62000000-0000-4000-8000-000000000001',
  otherTeamChannel: '62000000-0000-4000-8000-000000000002',
  dm: '70000000-0000-4000-8000-000000000001',
  otherDm: '70000000-0000-4000-8000-000000000002',
  pub1: '80000000-0000-4000-8000-000000000001',
  pub2: '80000000-0000-4000-8000-000000000002',
  team1: '81000000-0000-4000-8000-000000000001',
  other1: '81000000-0000-4000-8000-000000000002',
  dm1: '90000000-0000-4000-8000-000000000001',
  otherDm1: '90000000-0000-4000-8000-000000000002',
  missing: '99999999-0000-4000-8000-000000000009',
} as const;

export async function createChatReactionDb(): Promise<PGlite> {
  const ids = reactionIds;
  const db = new PGlite();
  await db.exec(
    'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
  );
  for (const file of [
    '0001_create_participants_table.sql',
    '0010_add_participant_suspension.sql',
    '0039_account_enforcement_models.sql',
    '0004_create_profile_tables.sql',
    '0041_create_chat_channel_message_models.sql',
  ]) {
    await db.exec(sqlOf(file));
  }
  await db.exec(
    `CREATE TABLE teams (
       id UUID PRIMARY KEY,
       recruitment_status VARCHAR(20) NOT NULL DEFAULT 'Open'
     );
     CREATE TABLE team_memberships (
       team_id UUID NOT NULL REFERENCES teams(id),
       participant_id UUID NOT NULL REFERENCES participants(id),
       status VARCHAR(20) NOT NULL,
       joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (team_id, participant_id)
     );`
  );
  for (const file of [
    '0051_add_team_channel_linkage_to_chat_channels.sql',
    '0053_create_direct_message_threads.sql',
    '0054_create_participant_blocks.sql',
    '0055_create_direct_messages.sql',
    '0058_create_chat_read_cursors.sql',
    '0059_create_chat_unread_count_query.sql',
  ]) {
    await db.exec(sqlOf(file));
  }
  await db.exec(
    "ALTER TABLE participant_profiles ADD COLUMN moderation_status VARCHAR(30) NOT NULL DEFAULT 'None'"
  );
  await db.exec(sqlOf('0060_create_chat_message_mentions.sql'));
  await db.exec(sqlOf('0061_create_atomic_chat_mark_read.sql'));
  await db.exec(reactionMigrationSql());

  for (const [id, key, role] of [
    [ids.reader, 'reader', 'PART'],
    [ids.peer, 'peer', 'PART'],
    [ids.outsider, 'outsider', 'PART'],
    [ids.admin, 'admin', 'ADMIN'],
    [ids.lurker, 'lurker', 'PART'],
  ] as const) {
    await db.query(
      `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [id, `fb-${key}`, `${key}@example.test`, `Full ${key}`, role]
    );
    if (role === 'PART') {
      // ADMIN accounts cannot have a participant profile (0004 trigger).
      await db.query(
        "INSERT INTO participant_profiles (participant_id, handle, moderation_status) VALUES ($1, $2, 'None')",
        [id, `${key}_1`]
      );
    }
  }

  await db.query('INSERT INTO teams (id) VALUES ($1), ($2)', [ids.team, ids.otherTeam]);
  await db.query(
    `INSERT INTO team_memberships (team_id, participant_id, status) VALUES
       ($1, $3, 'Confirmed'), ($1, $4, 'Confirmed'), ($1, $5, 'Removed'),
       ($2, $5, 'Confirmed')`,
    [ids.team, ids.otherTeam, ids.reader, ids.peer, ids.outsider]
  );
  await db.query(
    `INSERT INTO chat_channels (id, title, description, created_by, channel_type, team_id) VALUES
       ($1, 'General', 'Public forum', $4, 'public', NULL),
       ($2, 'Team', 'Private team channel', $4, 'team', $5),
       ($3, 'Other team', 'Private team channel', $7, 'team', $6)`,
    [ids.publicChannel, ids.teamChannel, ids.otherTeamChannel, ids.peer, ids.team, ids.otherTeam, ids.outsider]
  );
  await db.query(
    `INSERT INTO direct_message_threads (id, participant_low_id, participant_high_id)
     VALUES ($1, $3, $4), ($2, $4, $5)`,
    [ids.dm, ids.otherDm, ids.reader, ids.peer, ids.outsider]
  );
  await db.query(
    `INSERT INTO chat_messages (id, channel_id, author_id, body, created_at) VALUES
       ($1, $5, $8, 'hello @reader_1', '2026-11-10T12:00:00Z'),
       ($2, $5, $8, 'second public', '2026-11-10T12:01:00Z'),
       ($3, $6, $8, 'team only', '2026-11-10T12:02:00Z'),
       ($4, $7, $9, 'other team only', '2026-11-10T12:03:00Z')`,
    [ids.pub1, ids.pub2, ids.team1, ids.other1, ids.publicChannel, ids.teamChannel, ids.otherTeamChannel, ids.peer, ids.outsider]
  );
  await db.query(
    `INSERT INTO direct_messages (id, thread_id, author_id, body, created_at) VALUES
       ($1, $3, $5, 'dm hello', '2026-11-10T13:00:00Z'),
       ($2, $4, $6, 'unrelated dm', '2026-11-10T13:01:00Z')`,
    [ids.dm1, ids.otherDm1, ids.dm, ids.otherDm, ids.peer, ids.outsider]
  );
  return db;
}

/** Marks a participant suspended in a way that satisfies the 0039 field constraints. */
export async function suspendParticipant(db: PGlite, participantId: string): Promise<void> {
  await db.query(
    `UPDATE participants
     SET is_suspended = TRUE, suspended_at = NOW(), suspended_by = $2, suspension_reason = 'test'
     WHERE id = $1`,
    [participantId, reactionIds.admin]
  );
}

export async function unsuspendParticipant(db: PGlite, participantId: string): Promise<void> {
  await db.query(
    `UPDATE participants
     SET is_suspended = FALSE, suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL
     WHERE id = $1`,
    [participantId]
  );
}
