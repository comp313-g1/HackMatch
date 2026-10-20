import { describe, it, expect } from 'vitest';
import { toTeamView } from './teamView.js';
import type { Team, TeamVacancy } from '../db/types.js';

describe('teamView service unit tests (US-012 / #120)', () => {
  const baseTeam: Team = {
    id: 't1000000-0000-4000-8000-000000000001',
    event_id: 'e1000000-0000-4000-8000-000000000001',
    owner_participant_id: 'p1000000-0000-4000-8000-000000000001',
    name: 'ByteCrafters',
    pitch: 'Building accessible AI assistants for education',
    goal: 'Project Completion',
    commitment_hours: 15.5,
    communication_link: 'https://discord.gg/bytecrafters',
    recruitment_status: 'Open',
    disbanded_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  const baseVacancies: TeamVacancy[] = [
    {
      id: 'v1000000-0000-4000-8000-000000000001',
      team_id: baseTeam.id,
      role: 'Frontend',
      skills: ['React', 'TypeScript', 'Tailwind'],
      status: 'Open',
      removed_at: null,
      created_at: '2026-10-18T10:05:00.000Z',
      updated_at: '2026-10-18T10:05:00.000Z',
    },
    {
      id: 'v1000000-0000-4000-8000-000000000002',
      team_id: baseTeam.id,
      role: 'Backend',
      skills: ['Node.js', 'PostgreSQL'],
      status: 'Filled',
      removed_at: null,
      created_at: '2026-10-18T10:06:00.000Z',
      updated_at: '2026-10-18T10:06:00.000Z',
    },
  ];

  it('projects safe allow-list TeamView without exposing sensitive internal columns', () => {
    const parts = {
      team: baseTeam,
      event: { max_team_size: 4 },
      members: [
        {
          participant_id: 'p1000000-0000-4000-8000-000000000001',
          role: 'Owner' as const,
          joined_at: '2026-10-18T10:00:00.000Z',
          handle: 'ada_lovelace',
          full_name: 'Ada Lovelace',
        },
      ],
      vacancies: baseVacancies,
    };

    const view = toTeamView(parts);

    expect(view.id).toBe(baseTeam.id);
    expect(view.name).toBe(baseTeam.name);
    expect(view.pitch).toBe(baseTeam.pitch);
    expect(view.commitmentHours).toBe(15.5);
    expect(view.recruitmentStatus).toBe('Open');
    expect(view.members[0].displayName).toBe('ada_lovelace');
    expect(view.members[0].role).toBe('Owner');
    expect(view.vacancies).toHaveLength(2);
    expect(view.viewerRole).toBeNull();
    expect(view.canLeave).toBe(false);
    expect((view as unknown as Record<string, unknown>).owner_participant_id).toBeUndefined();
    expect((view.members[0] as unknown as Record<string, unknown>).email).toBeUndefined();
    expect((view.members[0] as unknown as Record<string, unknown>).firebase_uid).toBeUndefined();
  });

  it('marks canLeave for confirmed non-owner viewers on mutable teams (#183)', () => {
    const memberId = 'p2000000-0000-4000-8000-000000000002';
    const parts = {
      team: baseTeam,
      event: { max_team_size: 4, status: 'Published' as const, end_date: '2099-01-01T00:00:00.000Z' },
      members: [
        {
          participant_id: baseTeam.owner_participant_id,
          role: 'Owner' as const,
          joined_at: '2026-10-18T10:00:00.000Z',
          handle: 'owner',
          full_name: 'Owner',
        },
        {
          participant_id: memberId,
          role: 'Member' as const,
          joined_at: '2026-10-18T11:00:00.000Z',
          handle: 'member',
          full_name: 'Member',
        },
      ],
      vacancies: [],
    };

    const memberView = toTeamView(parts, { viewerParticipantId: memberId });
    expect(memberView.viewerRole).toBe('Member');
    expect(memberView.canLeave).toBe(true);

    const ownerView = toTeamView(parts, { viewerParticipantId: baseTeam.owner_participant_id });
    expect(ownerView.viewerRole).toBe('Owner');
    expect(ownerView.canLeave).toBe(false);
  });

  it('falls back to fullName for displayName when handle is null or whitespace', () => {
    const parts = {
      team: baseTeam,
      event: { max_team_size: 4 },
      members: [
        {
          participant_id: 'p2000000-0000-4000-8000-000000000002',
          role: 'Member' as const,
          joined_at: '2026-10-18T10:30:00.000Z',
          handle: '   ',
          full_name: 'Alan Turing',
        },
      ],
      vacancies: [],
    };

    const view = toTeamView(parts);
    expect(view.members[0].displayName).toBe('Alan Turing');
  });

  it('calculates limits correctly falling back to cap 4 when max_team_size is null', () => {
    const parts = {
      team: baseTeam,
      event: { max_team_size: null },
      members: [
        {
          participant_id: 'p1',
          role: 'Owner' as const,
          joined_at: '2026-10-18T10:00:00.000Z',
          handle: 'lead',
          full_name: 'Team Lead',
        },
      ],
      vacancies: [
        {
          id: 'v1',
          team_id: baseTeam.id,
          role: 'Frontend' as const,
          skills: [],
          status: 'Open' as const,
          removed_at: null,
          created_at: '2026-10-18T10:05:00.000Z',
          updated_at: '2026-10-18T10:05:00.000Z',
        },
      ],
    };

    const view = toTeamView(parts);
    expect(view.limits.maxTeamSize).toBeNull();
    expect(view.limits.confirmedMembers).toBe(1);
    expect(view.limits.openSlots).toBe(1);
    // 4 fallback cap - 1 confirmed - 1 open = 2
    expect(view.limits.remainingCapacity).toBe(2);
  });

  it('clamps remainingCapacity to zero and never displays negative numbers when over-allocated', () => {
    const parts = {
      team: baseTeam,
      event: { max_team_size: 2 },
      members: [
        { participant_id: 'p1', role: 'Owner' as const, joined_at: '2026-10-18T10:00:00.000Z', handle: 'm1', full_name: 'M1' },
        { participant_id: 'p2', role: 'Member' as const, joined_at: '2026-10-18T10:05:00.000Z', handle: 'm2', full_name: 'M2' },
      ],
      vacancies: [
        {
          id: 'v1',
          team_id: baseTeam.id,
          role: 'Frontend' as const,
          skills: [],
          status: 'Open' as const,
          removed_at: null,
          created_at: '2026-10-18T10:05:00.000Z',
          updated_at: '2026-10-18T10:05:00.000Z',
        },
      ],
    };

    const view = toTeamView(parts);
    expect(view.limits.confirmedMembers).toBe(2);
    expect(view.limits.openSlots).toBe(1);
    expect(view.limits.remainingCapacity).toBe(0);
  });

  it('includes derived lifecycle in TeamView', () => {
    const parts = {
      team: { ...baseTeam, recruitment_status: 'Locked' as const },
      event: {
        max_team_size: 4,
        status: 'Published' as const,
        end_date: '2099-01-01T00:00:00.000Z',
      },
      members: [],
      vacancies: [],
    };

    const view = toTeamView(parts);
    expect(view.lifecycle).toEqual({
      mutable: false,
      reason: 'Locked',
    });
  });
});

