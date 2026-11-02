import { describe, it, expect } from 'vitest';
import {
  resolveProfileViewerCategory,
  projectProfileForViewer,
} from './profilePrivacy.js';
import type { Participant } from '../db/types.js';
import type { FullParticipantProfileRecord } from '../db/profile.repository.js';

describe('profilePrivacy service (US-006 / #67 / FR-014)', () => {
  const sampleParticipant: Participant = {
    id: 'part-secret-uuid-999',
    firebase_uid: 'fb-secret-uid-999',
    email: 'private.email@example.com',
    full_name: 'Maya Lin',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
  };

  const sampleRecord: FullParticipantProfileRecord = {
    profile: {
      participant_id: 'part-secret-uuid-999',
      handle: 'maya_ml',
      primary_role: 'AI/ML',
      institution: 'Centennial College',
      shared_contact_handle: '@maya_private_discord',
      created_at: '2026-10-17T00:00:00.000Z',
      updated_at: '2026-10-17T00:00:00.000Z',
    },
    skills: [
      {
        id: 'sk-1',
        participant_id: 'part-secret-uuid-999',
        skill_name: 'PyTorch',
        created_at: '2026-10-17T00:00:00.000Z',
      },
      {
        id: 'sk-2',
        participant_id: 'part-secret-uuid-999',
        skill_name: 'TypeScript',
        created_at: '2026-10-17T00:00:00.000Z',
      },
    ],
    portfolios: [
      {
        id: 'pf-1',
        participant_id: 'part-secret-uuid-999',
        url: 'https://github.com/maya_ml',
        label: 'GitHub',
        created_at: '2026-10-17T00:00:00.000Z',
        updated_at: '2026-10-17T00:00:00.000Z',
      },
    ],
  };

  it('resolves VISITOR, PART, CONFIRMED_TEAMMATE, and OWNER viewer categories accurately', () => {
    expect(
      resolveProfileViewerCategory({
        viewerParticipantId: null,
        viewerRole: null,
        targetParticipantId: 'part-secret-uuid-999',
        isConfirmedTeammate: false,
      })
    ).toBe('VISITOR');

    expect(
      resolveProfileViewerCategory({
        viewerParticipantId: 'part-other-1',
        viewerRole: 'PART',
        targetParticipantId: 'part-secret-uuid-999',
        isConfirmedTeammate: false,
      })
    ).toBe('PART');

    expect(
      resolveProfileViewerCategory({
        viewerParticipantId: 'part-teammate-2',
        viewerRole: 'PART',
        targetParticipantId: 'part-secret-uuid-999',
        isConfirmedTeammate: true,
      })
    ).toBe('CONFIRMED_TEAMMATE');

    expect(
      resolveProfileViewerCategory({
        viewerParticipantId: 'part-secret-uuid-999',
        viewerRole: 'PART',
        targetParticipantId: 'part-secret-uuid-999',
        isConfirmedTeammate: false,
      })
    ).toBe('OWNER');
  });

  it('VISITOR projection returns anonymized preview only without handle, name, portfolio links, contact, or email (US-006 AC 3 / T3)', () => {
    const projected = projectProfileForViewer(
      sampleParticipant,
      sampleRecord,
      'VISITOR'
    ) as unknown as Record<string, unknown>;

    expect(projected.viewerCategory).toBe('VISITOR');
    expect(projected.isAnonymized).toBe(true);
    expect(projected.primaryRole).toBe('AI/ML');
    expect(projected.skillCount).toBe(2);
    expect(projected.handle).toBeUndefined();
    expect(projected.displayName).toBeUndefined();
    expect(projected.institution).toBeUndefined();
    expect(projected.portfolioLinks).toBeUndefined();
    expect(projected.sharedContactHandle).toBeUndefined();
    expect(projected.email).toBeUndefined();
    expect(projected.participantId).toBeUndefined();
    expect(projected.firebase_uid).toBeUndefined();
    expect(projected.hackathonHistory).toBeUndefined();
    expect(projected.experienceBadge).toBeUndefined();
    expect(projected.hackathonCount).toBeUndefined();
  });

  it('PART projection includes permitted profile fields and self-declared links while hiding sharedContactHandle, email, and internal IDs (US-006 AC 3, AC 4 / T4)', () => {
    const projected = projectProfileForViewer(
      sampleParticipant,
      sampleRecord,
      'PART'
    ) as unknown as Record<string, unknown>;

    expect(projected.viewerCategory).toBe('PART');
    expect(projected.displayName).toBe('Maya Lin');
    expect(projected.handle).toBe('maya_ml');
    expect(projected.primaryRole).toBe('AI/ML');
    expect(projected.institution).toBe('Centennial College');
    expect(projected.skills).toEqual(['PyTorch', 'TypeScript']);
    expect(projected.skillsSelfDeclared).toBe(true);
    expect(projected.portfolioLinks).toEqual([
      {
        url: 'https://github.com/maya_ml',
        label: 'GitHub',
        isSelfDeclared: true,
      },
    ]);
    expect(projected.sharedContactHandle).toBeUndefined();
    expect(projected.email).toBeUndefined();
    expect(projected.participantId).toBeUndefined();
    expect(projected.firebase_uid).toBeUndefined();
    expect(projected.hackathonHistory).toEqual([]);
    expect(projected.experienceBadge).toBe('Beginner');
    expect(projected.hackathonCount).toBe(0);
  });

  it('CONFIRMED_TEAMMATE projection includes sharedContactHandle and audience notice while keeping email and internal IDs private (US-006 AC 4 / T5)', () => {
    const projected = projectProfileForViewer(
      sampleParticipant,
      sampleRecord,
      'CONFIRMED_TEAMMATE'
    ) as unknown as Record<string, unknown>;

    expect(projected.viewerCategory).toBe('CONFIRMED_TEAMMATE');
    expect(projected.sharedContactHandle).toBe('@maya_private_discord');
    expect(String(projected.sharedContactAudienceNotice)).toContain('confirmed teammates');
    expect(projected.email).toBeUndefined();
    expect(projected.participantId).toBeUndefined();
    expect(projected.firebase_uid).toBeUndefined();
  });

  it('computes experienceBadge and projects hackathonHistory for authenticated PART viewers (US-007 AC 2, AC 3 / FR-016)', () => {
    const recordWithHistory: FullParticipantProfileRecord = {
      ...sampleRecord,
      history: [
        {
          id: 'hist-1',
          participant_id: 'part-secret-uuid-999',
          event_name: 'Hack The North 2024',
          event_date: '2024-09-15',
          team_role: 'AI/ML',
          project_title: 'VisionAssist',
          project_url: 'https://github.com/maya_ml/vision',
          created_at: '2024-09-16T00:00:00.000Z',
          updated_at: '2024-09-16T00:00:00.000Z',
        },
        {
          id: 'hist-2',
          participant_id: 'part-secret-uuid-999',
          event_name: 'UofTHacks XI',
          event_date: '2024-01-20',
          team_role: 'Backend',
          project_title: 'TransitPulse',
          project_url: 'https://github.com/maya_ml/transit',
          created_at: '2024-01-21T00:00:00.000Z',
          updated_at: '2024-01-21T00:00:00.000Z',
        },
      ],
    };

    const projected = projectProfileForViewer(
      sampleParticipant,
      recordWithHistory,
      'PART'
    ) as unknown as Record<string, unknown>;

    expect(projected.hackathonCount).toBe(2);
    expect(projected.experienceBadge).toBe('Competitor');
    expect(projected.experienceBadgeSelfReported).toBe(true);
    expect(projected.hackathonHistory).toEqual([
      {
        id: 'hist-1',
        eventName: 'Hack The North 2024',
        eventDate: '2024-09-15',
        teamRole: 'AI/ML',
        projectTitle: 'VisionAssist',
        projectUrl: 'https://github.com/maya_ml/vision',
      },
      {
        id: 'hist-2',
        eventName: 'UofTHacks XI',
        eventDate: '2024-01-20',
        teamRole: 'Backend',
        projectTitle: 'TransitPulse',
        projectUrl: 'https://github.com/maya_ml/transit',
      },
    ]);
  });

  it('computes Veteran experienceBadge for 4 or more records', () => {
    const recordWithFour: FullParticipantProfileRecord = {
      ...sampleRecord,
      history: Array(4).fill({
        id: 'hist-x',
        participant_id: 'part-secret-uuid-999',
        event_name: 'Hack',
        event_date: '2024-01-01',
        team_role: 'Frontend',
        project_title: 'App',
        project_url: 'https://example.com',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }),
    };

    const projected = projectProfileForViewer(
      sampleParticipant,
      recordWithFour,
      'OWNER'
    ) as unknown as Record<string, unknown>;

    expect(projected.hackathonCount).toBe(4);
    expect(projected.experienceBadge).toBe('Veteran');
    expect(projected.experienceBadgeSelfReported).toBe(true);
  });
});
