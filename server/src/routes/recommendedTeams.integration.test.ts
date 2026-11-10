/**
 * US-016 Recommended Teams — integration suite.
 *
 *   HTTP request -> real Express app -> real Firebase guards (token verification mocked)
 *   -> real controller -> real service -> REAL SQL (migrations applied to an in-process
 *   Postgres) -> JSON response.
 *
 * Two stand-ins only: Firebase token verification, and PGlite in place of Supabase. The
 * repository methods are not stubbed out — they are re-expressed as SQL against the same
 * migration files the product ships, so the join/filter behaviour is exercised for real.
 *
 * Offline by construction: no Supabase project, no Firebase credentials, no Docker.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamsRepository, type OpenTeamRecord } from '../db/teams.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import { PLATFORM_AVAILABILITY_EVENT_ID } from '../validators/availability.validator.js';
import {
  getRecommendedTeamsForParticipant,
  RECOMMENDED_TEAMS_CAP,
  RECOMMENDED_TEAMS_DEGRADED_NOTICE,
} from '../services/recommendedTeams.js';
import {
  ownerParticipant,
  validOwnerDecodedToken,
  validTokenHeader,
} from './team.testUtils.js';
import type { Participant, Team, TeamVacancy } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
  };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
/** Only the migrations US-016 reads through: participants, profile, events, teams, availability. */
const MIGRATIONS = [
  '0001_create_participants_table.sql',
  '0004_create_profile_tables.sql',
  '0005_create_pending_event_submissions.sql',
  '0007_create_events_table.sql',
  '0011_create_team_recruitment_tables.sql',
  '0016_alter_event_availability_for_platform_pool.sql',
  '0035_add_team_roster_lock_fields.sql',
];

const recPath = '/api/scoring/teams/recommendations';
const actorId = ownerParticipant.id;
const rivalId = '22222222-2222-4222-8222-222222222222';
const eventId = '55555555-5555-4555-8555-555555555555';

let db: PGlite;

const rows = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> => (await db.query(sql, params)).rows as T[];

async function resetDatabase(): Promise<void> {
  await db.exec(`
    TRUNCATE team_memberships, team_requests, team_vacancies, teams,
             event_availability, participant_skills, participant_profiles,
             participants, events
    RESTART IDENTITY CASCADE
  `);
}

async function seedBase(): Promise<void> {
  // Migration 0016 seeds this row; TRUNCATE removes it, so restore it with the fixture.
  await db.query(
    `INSERT INTO events (id, title, official_url, normalized_url, start_date, end_date, format, status)
     VALUES ($1, 'Platform Availability Pool', 'https://example.test/p', 'https://example.test/p', '2026-01-01', '2099-12-31', 'Online', 'Published')
     ON CONFLICT (id) DO NOTHING`,
    [PLATFORM_AVAILABILITY_EVENT_ID]
  );
  await db.query(
    `INSERT INTO events (id, title, official_url, normalized_url, start_date, end_date, format, status, max_team_size)
     VALUES ($1, 'Platform', 'https://example.test/e', 'https://example.test/e', '2026-01-01', '2099-01-01', 'Online', 'Published', 4)`,
    [eventId]
  );
  await db.query(
    `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
     VALUES ($1, $2, $3, $4, 'PART', true)`,
    [actorId, ownerParticipant.firebase_uid, ownerParticipant.email, ownerParticipant.full_name]
  );
  await db.query(
    `INSERT INTO participants (id, firebase_uid, email, full_name, role, is_verified)
     VALUES ($1, 'fb-rival', 'rival@example.test', 'Rival Owner', 'PART', true)`,
    [rivalId]
  );
  await db.query(
    `INSERT INTO participant_profiles (participant_id, handle, primary_role) VALUES ($1, 'owner_lead', 'Frontend')`,
    [actorId]
  );
  await db.query(
    `INSERT INTO participant_skills (participant_id, skill_name) VALUES ($1, 'React'), ($1, 'TypeScript')`,
    [actorId]
  );
  await db.query(
    `INSERT INTO event_availability (participant_id, event_id, is_looking, desired_role, commitment_hours, goal)
     VALUES ($1, $2, true, 'Frontend', 20, 'Project Completion')`,
    [actorId, PLATFORM_AVAILABILITY_EVENT_ID]
  );
}

interface TeamSeed {
  id: string;
  name: string;
  ownerId?: string;
  goal?: string;
  hours?: number;
  status?: string;
  createdAt?: string;
  role?: string;
  skills?: string[];
  joinActor?: boolean;
}

/** Deterministic, valid vacancy uuid derived from the team uuid. */
function vacancyIdFor(teamId: string): string {
  return `${teamId.slice(0, 24)}000000000001`;
}

/**
 * Each seeded team lives in its own published event: the schema allows one Confirmed
 * membership per participant per event, and this also proves the recommendation pool is
 * platform-wide rather than scoped to a single event.
 */
function eventIdFor(teamId: string): string {
  return `${teamId.slice(0, 24)}0000000000ee`;
}

async function seedTeam(seed: TeamSeed): Promise<void> {
  const ownerId = seed.ownerId ?? rivalId;
  const status = seed.status ?? 'Open';
  const teamEventId = eventIdFor(seed.id);

  await db.query(
    `INSERT INTO events (id, title, official_url, normalized_url, start_date, end_date, format, status)
     VALUES ($1, $2, $3, $3, '2026-01-01', '2099-01-01', 'Online', 'Published')
     ON CONFLICT (id) DO NOTHING`,
    [teamEventId, `Event for ${seed.name}`, `https://example.test/${seed.id}`]
  );

  await db.query(
    `INSERT INTO teams (id, event_id, owner_participant_id, name, pitch, goal, commitment_hours, recruitment_status, locked_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Pitch', $5, $6, $7, $8, $9, $9)`,
    [
      seed.id,
      teamEventId,
      ownerId,
      seed.name,
      seed.goal ?? 'Project Completion',
      seed.hours ?? 20,
      status,
      status === 'Locked' ? '2026-11-02T00:00:00.000Z' : null,
      seed.createdAt ?? '2026-11-01T00:00:00.000Z',
    ]
  );
  await db.query(
    `INSERT INTO team_vacancies (id, team_id, role, skills, status) VALUES ($1, $2, $3, $4, 'Open')`,
    [
      vacancyIdFor(seed.id),
      seed.id,
      seed.role ?? 'Frontend',
      seed.skills ?? ['React', 'TypeScript'],
    ]
  );
  await db.query(
    `INSERT INTO team_memberships (team_id, event_id, participant_id, role, status) VALUES ($1, $2, $3, 'Owner', 'Confirmed')`,
    [seed.id, teamEventId, ownerId]
  );
  if (seed.joinActor) {
    await db.query(
      `INSERT INTO team_memberships (team_id, event_id, participant_id, role, status) VALUES ($1, $2, $3, 'Member', 'Confirmed')`,
      [seed.id, teamEventId, actorId]
    );
  }
}

// ---------------------------------------------------------------------------
// Repository adapters — the production queries, expressed as SQL on PGlite
// ---------------------------------------------------------------------------

async function findOpenTeamRecords(): Promise<OpenTeamRecord[]> {
  const teamRows = await rows<Team>(
    `SELECT * FROM teams WHERE recruitment_status = 'Open' ORDER BY created_at DESC, id ASC`
  );

  const records: OpenTeamRecord[] = [];
  for (const team of teamRows) {
    const vacancies = await rows<Pick<TeamVacancy, 'id' | 'role' | 'skills'>>(
      `SELECT id, role, skills FROM team_vacancies WHERE team_id = $1 AND status = 'Open'`,
      [team.id]
    );
    if (vacancies.length === 0) continue;

    const members = await rows<{ participant_id: string; role: 'Owner' | 'Member' }>(
      `SELECT participant_id, role FROM team_memberships WHERE team_id = $1 AND status = 'Confirmed'`,
      [team.id]
    );
    const [event] = await rows<{ status: 'Published'; end_date: string }>(
      `SELECT status, end_date FROM events WHERE id = $1`,
      [team.event_id]
    );

    records.push({
      team,
      event: { status: event?.status ?? 'Published', end_date: event?.end_date },
      openVacancies: vacancies.map((v) => ({
        id: v.id,
        role: v.role,
        skills: Array.isArray(v.skills) ? v.skills : [],
      })),
      members: members.map((m) => ({
        participant_id: m.participant_id,
        role: m.role,
        full_name: null,
        handle: null,
      })),
    });
  }

  return records;
}

async function findConfirmedTeamIdsForParticipant(participantId: string): Promise<string[]> {
  const found = await rows<{ team_id: string }>(
    `SELECT team_id FROM team_memberships WHERE participant_id = $1 AND status = 'Confirmed'`,
    [participantId]
  );
  return found.map((r) => r.team_id);
}

function wireRepositoriesToSql(): void {
  vi.spyOn(participantsRepository, 'findByFirebaseUid').mockImplementation(async (uid: string) => {
    const [row] = await rows<Participant>(`SELECT * FROM participants WHERE firebase_uid = $1`, [uid]);
    return row ?? null;
  });
  vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => {
    const [row] = await rows<Participant>(`SELECT * FROM participants WHERE id = $1`, [id]);
    return row ?? null;
  });
  vi.spyOn(profileRepository, 'findProfileByParticipantId').mockImplementation(async (id: string) => {
    const [row] = await rows(`SELECT * FROM participant_profiles WHERE participant_id = $1`, [id]);
    return (row as never) ?? null;
  });
  vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockImplementation(async (id: string) => {
    const found = await rows(`SELECT * FROM participant_skills WHERE participant_id = $1`, [id]);
    return found as never;
  });
  vi.spyOn(availabilityRepository, 'findByParticipantId').mockImplementation(async (id: string) => {
    const [row] = await rows<{
      participant_id: string;
      is_looking: boolean;
      desired_role: string | null;
      commitment_hours: number | null;
      goal: string | null;
      updated_at: string;
    }>(`SELECT * FROM event_availability WHERE participant_id = $1`, [id]);
    if (!row) return null;
    return {
      participantId: row.participant_id,
      isLooking: row.is_looking,
      desiredRole: row.desired_role as never,
      commitmentHours: row.commitment_hours === null ? null : Number(row.commitment_hours),
      goal: row.goal as never,
      updatedAt: row.updated_at,
    };
  });
  vi.spyOn(teamsRepository, 'findOpenTeamRecords').mockImplementation(findOpenTeamRecords);
  vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockImplementation(
    findConfirmedTeamIdsForParticipant
  );
}

describe('US-016 recommended teams integration (PGlite)', () => {
  beforeAll(async () => {
    db = new PGlite();
    for (const file of MIGRATIONS) {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    }
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    await resetDatabase();
    await seedBase();
    wireRepositoriesToSql();
  });

  it('ranks teams end-to-end over real SQL and never leaks the ranking id', async () => {
    await seedTeam({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Strong Fit' });
    await seedTeam({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Weak Fit',
      role: 'Backend',
      skills: ['Rust'],
      goal: 'Learning',
      hours: 45,
    });

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.teams.map((t: { teamName: string }) => t.teamName)).toEqual([
      'Strong Fit',
      'Weak Fit',
    ]);
    expect(res.body.teams.map((t: { rank: number }) => t.rank)).toEqual([1, 2]);
    expect(res.body.teams[0].displayScore).toBe('100.0');
    expect(res.body.teams[0].matchedSkills).toEqual(
      expect.arrayContaining(['react', 'typescript'])
    );

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('internalId');
    // The composed ranking key (teamId:vacancyId) must not survive projection either.
    expect(serialized).not.toContain(
      `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:${vacancyIdFor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')}`
    );
  });

  it('drops the actor own team and teams they already joined', async () => {
    await seedTeam({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'My Own Team',
      ownerId: actorId,
    });
    await seedTeam({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Already Joined',
      joinActor: true,
    });
    await seedTeam({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Still Open' });

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.teams.map((t: { teamName: string }) => t.teamName)).toEqual(['Still Open']);
  });

  it('drops locked teams because recruitment is no longer mutable', async () => {
    await seedTeam({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Locked Team', status: 'Locked' });
    await seedTeam({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Still Open' });

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.body.teams.map((t: { teamName: string }) => t.teamName)).toEqual(['Still Open']);
  });

  it(`caps the response at ${RECOMMENDED_TEAMS_CAP} rows after ranking the whole pool`, async () => {
    for (let index = 0; index < RECOMMENDED_TEAMS_CAP + 2; index += 1) {
      await seedTeam({
        id: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
        name: `Team ${index}`,
        // The highest index is the worst fit, so a pre-scoring cap would return the wrong set.
        hours: 20 + index * 5,
        skills: index === RECOMMENDED_TEAMS_CAP + 1 ? ['Rust'] : ['React', 'TypeScript'],
      });
    }

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.body.teams).toHaveLength(RECOMMENDED_TEAMS_CAP);
    expect(res.body.teams[0].teamName).toBe('Team 0');
    const names = res.body.teams.map((t: { teamName: string }) => t.teamName);
    expect(names).not.toContain(`Team ${RECOMMENDED_TEAMS_CAP}`);
    expect(names).not.toContain(`Team ${RECOMMENDED_TEAMS_CAP + 1}`);
  });

  it('keeps ranking deterministic for identical scores (team name, then entry id)', async () => {
    await seedTeam({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Zulu Team' });
    await seedTeam({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Alpha Team' });

    const first = await request(app).get(recPath).set('Authorization', validTokenHeader);
    const second = await request(app).get(recPath).set('Authorization', validTokenHeader);

    const names = first.body.teams.map((t: { teamName: string }) => t.teamName);
    expect(names).toEqual(['Alpha Team', 'Zulu Team']);
    expect(first.body.teams.map((t: { rank: number }) => t.rank)).toEqual([1, 2]);
    expect(second.body.teams.map((t: { teamName: string }) => t.teamName)).toEqual(names);
  });

  it('degrades to an unranked list when scoring fails, without 500 (NR-016)', async () => {
    await seedTeam({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Strong Fit' });

    const result = await getRecommendedTeamsForParticipant(actorId, {
      computeScore: () => {
        throw new Error('scorer unavailable');
      },
    });

    expect(result.status).toBe('degraded');
    expect(result.degradedNotice).toBe(RECOMMENDED_TEAMS_DEGRADED_NOTICE);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].rank).toBeUndefined();
  });

  it('returns the empty state when nothing is recruiting', async () => {
    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(true);
    expect(res.body.teams).toEqual([]);
  });
});
