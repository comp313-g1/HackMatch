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
});
