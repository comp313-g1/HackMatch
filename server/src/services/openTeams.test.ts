import { describe, it, expect, vi } from 'vitest';
import {
  filterOpenTeams,
  toPartCard,
  toVisitorPreview,
  listOpenTeams,
  OPEN_TEAMS_RESPONSE_CAP,
  type OpenTeamsViewer,
} from './openTeams.js';
import type { OpenTeamRecord } from '../db/teams.repository.js';
import type { OpenTeamsQuery } from '../validators/openTeams.validator.js';

describe('openTeams service unit tests (US-013 / Task 4)', () => {
  const fixedNow = new Date('2026-10-18T12:00:00.000Z');

  const createSampleRecord = (overrides?: Partial<OpenTeamRecord>): OpenTeamRecord => {
    const defaultTeam = {
      id: 'team-001',
      event_id: 'event-001',
      owner_participant_id: 'part-owner',
      name: 'Alpha Team',
      pitch: 'Building an innovative AI tool',
      goal: 'Project Completion' as const,
      commitment_hours: 15,
      communication_link: 'https://discord.gg/secret-alpha',
      recruitment_status: 'Open' as const,
      disbanded_at: null,
      created_at: '2026-10-18T10:00:00.000Z',
      updated_at: '2026-10-18T10:00:00.000Z',
    };

    const defaultEvent = {
      status: 'Published' as const,
      end_date: '2026-10-25T12:00:00.000Z',
    };

    const defaultVacancies = [
      {
        id: 'vac-001',
        role: 'Frontend' as const,
        skills: ['React', 'TypeScript'],
      },
    ];

    const defaultMembers = [
      {
        participant_id: 'part-owner',
        role: 'Owner' as const,
        full_name: 'Alice Owner',
        handle: 'alice_dev',
      },
    ];

    return {
      team: { ...defaultTeam, ...overrides?.team },
      event: { ...defaultEvent, ...overrides?.event },
      openVacancies: overrides?.openVacancies ?? defaultVacancies,
      members: overrides?.members ?? defaultMembers,
    };
  };

  const emptyQuery: OpenTeamsQuery = {
    skills: [],
    role: null,
    goal: null,
    minSlots: 1,
  };

  describe('filterOpenTeams exclusion predicates', () => {
    it('excludes teams with recruitment_status = Locked', () => {
      const record = createSampleRecord({
        team: { ...createSampleRecord().team, recruitment_status: 'Locked' },
      });
      const result = filterOpenTeams([record], emptyQuery, fixedNow);
      expect(result).toHaveLength(0);
    });

    it('excludes teams with recruitment_status = Disbanded', () => {
      const record = createSampleRecord({
        team: { ...createSampleRecord().team, recruitment_status: 'Disbanded' },
      });
      const result = filterOpenTeams([record], emptyQuery, fixedNow);
      expect(result).toHaveLength(0);
    });

    it('excludes teams belonging to Archived or Disabled events', () => {
      const archivedRecord = createSampleRecord({
        event: { status: 'Archived', end_date: '2026-10-25T12:00:00.000Z' },
      });
      const disabledRecord = createSampleRecord({
        event: { status: 'Disabled', end_date: '2026-10-25T12:00:00.000Z' },
      });

      expect(filterOpenTeams([archivedRecord], emptyQuery, fixedNow)).toHaveLength(0);
      expect(filterOpenTeams([disabledRecord], emptyQuery, fixedNow)).toHaveLength(0);
    });

    it('excludes teams in events that have ended prior to now', () => {
      const pastEventRecord = createSampleRecord({
        event: { status: 'Published', end_date: '2026-10-18T11:59:59.000Z' },
      });
      const result = filterOpenTeams([pastEventRecord], emptyQuery, fixedNow);
      expect(result).toHaveLength(0);
    });

    it('includes teams in events where end_date equals now exactly (boundary)', () => {
      const exactNowRecord = createSampleRecord({
        event: { status: 'Published', end_date: fixedNow.toISOString() },
      });
      const result = filterOpenTeams([exactNowRecord], emptyQuery, fixedNow);
      expect(result).toHaveLength(1);
    });

    it('excludes teams with zero open vacancies', () => {
      const noVacanciesRecord = createSampleRecord({
        openVacancies: [],
      });
      const result = filterOpenTeams([noVacanciesRecord], emptyQuery, fixedNow);
      expect(result).toHaveLength(0);
    });
  });

  describe('filterOpenTeams multi-filter criteria', () => {
    it('filters by role only', () => {
      const feTeam = createSampleRecord({
        openVacancies: [{ id: 'v1', role: 'Frontend', skills: [] }],
      });
      const beTeam = createSampleRecord({
        team: { ...createSampleRecord().team, id: 'team-be' },
        openVacancies: [{ id: 'v2', role: 'Backend', skills: [] }],
      });

      const result = filterOpenTeams([feTeam, beTeam], { ...emptyQuery, role: 'Frontend' }, fixedNow);
      expect(result).toHaveLength(1);
      expect(result[0]!.team.id).toBe('team-001');
    });

    it('filters by skills only (AND logic across tags)', () => {
      const reactTsTeam = createSampleRecord({
        openVacancies: [{ id: 'v1', role: 'Frontend', skills: ['React', 'TypeScript', 'Tailwind'] }],
      });
      const reactOnlyTeam = createSampleRecord({
        team: { ...createSampleRecord().team, id: 'team-react' },
        openVacancies: [{ id: 'v2', role: 'Frontend', skills: ['React'] }],
      });

      const result = filterOpenTeams(
        [reactTsTeam, reactOnlyTeam],
        { ...emptyQuery, skills: ['react', 'typescript'] },
        fixedNow
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.team.id).toBe('team-001');
    });

    it('enforces that role and skills MUST match on the SAME vacancy (counter-example test)', () => {
      // Counter-example team: has Frontend slot without React, and Backend slot with React
      const splitTeam = createSampleRecord({
        openVacancies: [
          { id: 'v1', role: 'Frontend', skills: ['Vue', 'CSS'] },
          { id: 'v2', role: 'Backend', skills: ['Node.js', 'React'] },
        ],
      });

      // Query requires Frontend vacancy needing React
      const result = filterOpenTeams(
        [splitTeam],
        { ...emptyQuery, role: 'Frontend', skills: ['react'] },
        fixedNow
      );
      expect(result).toHaveLength(0);
    });

    it('filters by goal', () => {
      const learningTeam = createSampleRecord({
        team: { ...createSampleRecord().team, id: 'team-learn', goal: 'Learning' },
      });
      const compTeam = createSampleRecord({
        team: { ...createSampleRecord().team, id: 'team-comp', goal: 'Competitive' },
      });

      const result = filterOpenTeams([learningTeam, compTeam], { ...emptyQuery, goal: 'Learning' }, fixedNow);
      expect(result).toHaveLength(1);
      expect(result[0]!.team.id).toBe('team-learn');
    });

    it('filters by minimum open slots boundary', () => {
      const twoSlotsTeam = createSampleRecord({
        openVacancies: [
          { id: 'v1', role: 'Frontend', skills: [] },
          { id: 'v2', role: 'Backend', skills: [] },
        ],
      });

      // minSlots = 2 -> passes
      expect(filterOpenTeams([twoSlotsTeam], { ...emptyQuery, minSlots: 2 }, fixedNow)).toHaveLength(1);
      // minSlots = 3 -> fails
      expect(filterOpenTeams([twoSlotsTeam], { ...emptyQuery, minSlots: 3 }, fixedNow)).toHaveLength(0);
    });

    it('satisfies monotonic narrowing: adding any filter never increases the match set', () => {
      const t1 = createSampleRecord({
        team: { ...createSampleRecord().team, id: 't1', goal: 'Learning' },
        openVacancies: [{ id: 'v1', role: 'Frontend', skills: ['react', 'redux'] }],
      });
      const t2 = createSampleRecord({
        team: { ...createSampleRecord().team, id: 't2', goal: 'Learning' },
        openVacancies: [{ id: 'v2', role: 'Frontend', skills: ['react'] }],
      });
      const t3 = createSampleRecord({
        team: { ...createSampleRecord().team, id: 't3', goal: 'Competitive' },
        openVacancies: [{ id: 'v3', role: 'Backend', skills: ['python'] }],
      });

      const all = [t1, t2, t3];
      const res0 = filterOpenTeams(all, emptyQuery, fixedNow);
      const resGoal = filterOpenTeams(all, { ...emptyQuery, goal: 'Learning' }, fixedNow);
      const resGoalRole = filterOpenTeams(all, { ...emptyQuery, goal: 'Learning', role: 'Frontend' }, fixedNow);
      const resGoalRoleSkill = filterOpenTeams(
        all,
        { ...emptyQuery, goal: 'Learning', role: 'Frontend', skills: ['react', 'redux'] },
        fixedNow
      );

      expect(res0.length).toBe(3);
      expect(resGoal.length).toBeLessThanOrEqual(res0.length);
      expect(resGoalRole.length).toBeLessThanOrEqual(resGoal.length);
      expect(resGoalRoleSkill.length).toBeLessThanOrEqual(resGoalRoleSkill.length);
      expect(resGoalRoleSkill.length).toBe(1);
    });

    it('combines all 4 filters simultaneously', () => {
      const matchingTeam = createSampleRecord({
        team: { ...createSampleRecord().team, id: 'match', goal: 'Competitive' },
        openVacancies: [
          { id: 'v1', role: 'AI/ML', skills: ['Python', 'PyTorch'] },
          { id: 'v2', role: 'Backend', skills: ['Go'] },
        ],
      });
      const nonMatchingTeam = createSampleRecord({
        team: { ...createSampleRecord().team, id: 'no-match', goal: 'Competitive' },
        openVacancies: [
          { id: 'v3', role: 'AI/ML', skills: ['TensorFlow'] },
        ],
      });

      const result = filterOpenTeams(
        [matchingTeam, nonMatchingTeam],
        {
          skills: ['python', 'pytorch'],
          role: 'AI/ML',
          goal: 'Competitive',
          minSlots: 2,
        },
        fixedNow
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.team.id).toBe('match');
    });
  });

  describe('sorting, response capping, and input immutability', () => {
    it('orders by created_at desc with id asc tie-break and does not mutate input', () => {
      const tOlder = createSampleRecord({
        team: { ...createSampleRecord().team, id: 't-old', created_at: '2026-10-18T08:00:00.000Z' },
      });
      const tNewerA = createSampleRecord({
        team: { ...createSampleRecord().team, id: 't-new-a', created_at: '2026-10-18T10:00:00.000Z' },
      });
      const tNewerB = createSampleRecord({
        team: { ...createSampleRecord().team, id: 't-new-b', created_at: '2026-10-18T10:00:00.000Z' },
      });

      const input = [tOlder, tNewerB, tNewerA];
      const inputCopy = [...input];

      const sorted = filterOpenTeams(input, emptyQuery, fixedNow);

      expect(sorted[0]!.team.id).toBe('t-new-a');
      expect(sorted[1]!.team.id).toBe('t-new-b');
      expect(sorted[2]!.team.id).toBe('t-old');

      // Check input array not mutated
      expect(input).toEqual(inputCopy);
    });

    it('reports accurate total and slices to response cap in listOpenTeams', async () => {
      const records: OpenTeamRecord[] = [];
      for (let i = 1; i <= 55; i++) {
        records.push(
          createSampleRecord({
            team: {
              ...createSampleRecord().team,
              id: `team-${String(i).padStart(3, '0')}`,
              created_at: new Date(Date.parse('2026-10-18T00:00:00.000Z') + i * 1000).toISOString(),
            },
          })
        );
      }

      const mockRepo = {
        findOpenTeamRecords: vi.fn().mockResolvedValue(records),
      };

      const viewer: OpenTeamsViewer = { category: 'PART', participantId: 'part-viewer' };
      const res = await listOpenTeams(emptyQuery, viewer, { repo: mockRepo }, fixedNow);

      expect(res.total).toBe(55);
      expect(res.teams).toHaveLength(OPEN_TEAMS_RESPONSE_CAP);
      expect(res.viewer).toBe('PART');
    });
  });

  describe('field projection and privacy enforcement', () => {
    it('toVisitorPreview adheres strictly to the allow-list and excludes all private data', () => {
      const record = createSampleRecord({
        team: {
          ...createSampleRecord().team,
          id: 'secret-team-id',
          name: 'Secret Super Team',
          pitch: 'Confidential pitch details',
          communication_link: 'https://discord.gg/secret-invite',
        },
        members: [
          {
            participant_id: 'secret-p-1',
            role: 'Owner',
            full_name: 'John Doe',
            handle: 'johndoe',
          },
        ],
      });

      const preview = toVisitorPreview(record);
      const keys = Object.keys(preview).sort();
      expect(keys).toEqual([
        'commitmentHours',
        'confirmedMembers',
        'displayLabel',
        'goal',
        'openSlots',
        'vacancies',
      ]);

      const serialized = JSON.stringify(preview);
      expect(serialized).not.toContain('secret-team-id');
      expect(serialized).not.toContain('Secret Super Team');
      expect(serialized).not.toContain('Confidential pitch details');
      expect(serialized).not.toContain('discord.gg');
      expect(serialized).not.toContain('John Doe');
      expect(serialized).not.toContain('johndoe');
      expect(serialized).not.toContain('secret-p-1');
      expect(preview.displayLabel).toBe('Recruiting team');
    });

    it('toPartCard projects allowed PART fields and excludes communicationLink and internal IDs', () => {
      const record = createSampleRecord();
      const card = toPartCard(record, 'part-owner');

      const keys = Object.keys(card).sort();
      expect(keys).toEqual([
        'commitmentHours',
        'confirmedMembers',
        'createdAt',
        'goal',
        'id',
        'isViewerMember',
        'members',
        'name',
        'openSlots',
        'pitch',
        'vacancies',
      ]);

      expect(card.id).toBe(record.team.id);
      expect(card.name).toBe(record.team.name);
      expect(card.pitch).toBe(record.team.pitch);
      expect(card.isViewerMember).toBe(true);
      expect((card as unknown as Record<string, unknown>).communicationLink).toBeUndefined();
      expect((card as unknown as Record<string, unknown>).communication_link).toBeUndefined();
      expect((card as unknown as Record<string, unknown>).eventId).toBeUndefined();
      expect((card as unknown as Record<string, unknown>).event_id).toBeUndefined();
    });

    it('toPartCard falls back member displayName: handle -> full_name -> Participant', () => {
      const r1 = createSampleRecord({
        members: [{ participant_id: 'p1', role: 'Owner', full_name: 'Jane Doe', handle: 'janedoe' }],
      });
      const r2 = createSampleRecord({
        members: [{ participant_id: 'p2', role: 'Member', full_name: 'Bob Smith', handle: '  ' }],
      });
      const r3 = createSampleRecord({
        members: [{ participant_id: 'p3', role: 'Member', full_name: '', handle: null }],
      });

      expect(toPartCard(r1, 'other').members[0]!.displayName).toBe('janedoe');
      expect(toPartCard(r2, 'other').members[0]!.displayName).toBe('Bob Smith');
      expect(toPartCard(r3, 'other').members[0]!.displayName).toBe('Participant');
    });

    it('listOpenTeams calls repository with withMemberIdentities: false for visitors and true for PART', async () => {
      const mockRepo = {
        findOpenTeamRecords: vi.fn().mockResolvedValue([]),
      };

      await listOpenTeams(emptyQuery, { category: 'VISITOR' }, { repo: mockRepo }, fixedNow);
      expect(mockRepo.findOpenTeamRecords).toHaveBeenCalledWith({ withMemberIdentities: false });

      mockRepo.findOpenTeamRecords.mockClear();

      await listOpenTeams(emptyQuery, { category: 'PART', participantId: 'p-1' }, { repo: mockRepo }, fixedNow);
      expect(mockRepo.findOpenTeamRecords).toHaveBeenCalledWith({ withMemberIdentities: true });
    });
  });
});
