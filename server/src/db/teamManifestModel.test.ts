import { describe, it, expect } from 'vitest';
import {
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_RECORDED_BY_LABEL,
  MANIFEST_INTEGRITY_NOTICE,
  MANIFEST_PRIVACY_EXCLUSION_NOTICE,
  buildCanonicalRosterSnapshot,
  serializeCanonicalRosterSnapshot,
  type BuildCanonicalRosterSnapshotInput,
} from './teamManifestModel.js';

describe('teamManifestModel (US-024-T1 / #223 / FR-071 & FR-072)', () => {
  const sampleInput: BuildCanonicalRosterSnapshotInput = {
    teamId: 'TEAM-123',
    teamName: '  HackMatch   Innovators  ',
    eventId: 'EVENT-456',
    eventTitle: '  Global   Hackathon  2026 ',
    lockedAt: '2026-11-05T20:30:00.000Z',
    members: [
      {
        participantId: 'p-member-b',
        displayName: 'Bob   Smith',
        handle: '@bobcodes',
        teamRole: 'Member',
        primaryRole: 'Backend',
        institution: 'Centennial   College',
        portfolioLinks: [
          { label: 'LinkedIn', url: 'https://linkedin.com/in/bob' },
          { label: 'GitHub', url: 'https://github.com/bob' },
          { label: 'Invalid Link', url: 'http://insecure.com' },
        ],
        joinedAt: '2026-11-04T12:00:00.000Z',
      },
      {
        participantId: 'p-owner-a',
        displayName: 'Alice   Wonderland',
        handle: 'alicew',
        teamRole: 'Owner',
        primaryRole: 'Frontend',
        institution: 'University of Toronto',
        portfolioLinks: [
          { label: 'Personal', url: 'https://alice.dev' },
        ],
        joinedAt: '2026-11-01T10:00:00.000Z',
      },
      {
        participantId: 'p-member-a',
        displayName: 'Charlie   Brown',
        handle: null,
        teamRole: 'Member',
        primaryRole: 'UI/UX',
        institution: null,
        portfolioLinks: [],
        joinedAt: '2026-11-03T15:00:00.000Z',
        isPseudonymized: false,
      },
    ],
  };

  it('exports required metadata constants matching story criteria and FR-071/FR-072', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe('1.0');
    expect(MANIFEST_RECORDED_BY_LABEL).toContain('HackMatch server');
    expect(MANIFEST_INTEGRITY_NOTICE).toContain('integrity comparison with the stored server snapshot');
    expect(MANIFEST_PRIVACY_EXCLUSION_NOTICE).toContain('Account email addresses');
  });

  it('normalizes identifiers, whitespaces, and timestamp formatting into canonical ISO UTC', () => {
    const snapshot = buildCanonicalRosterSnapshot(sampleInput);

    expect(snapshot.schemaVersion).toBe('1.0');
    expect(snapshot.teamId).toBe('team-123');
    expect(snapshot.teamName).toBe('HackMatch Innovators');
    expect(snapshot.eventId).toBe('event-456');
    expect(snapshot.eventTitle).toBe('Global Hackathon 2026');
    expect(snapshot.lockedAt).toBe('2026-11-05T20:30:00.000Z');
    expect(snapshot.memberCount).toBe(3);
  });

  it('sorts members deterministically: Owner first, then participantId ascending', () => {
    const snapshot = buildCanonicalRosterSnapshot(sampleInput);

    expect(snapshot.members).toHaveLength(3);
    // Owner is first regardless of ID order
    expect(snapshot.members[0].participantId).toBe('p-owner-a');
    expect(snapshot.members[0].teamRole).toBe('Owner');
    expect(snapshot.members[0].handle).toBe('alicew');

    // Remaining members sorted by participantId ASC ('p-member-a' < 'p-member-b')
    expect(snapshot.members[1].participantId).toBe('p-member-a');
    expect(snapshot.members[1].teamRole).toBe('Member');

    expect(snapshot.members[2].participantId).toBe('p-member-b');
    expect(snapshot.members[2].teamRole).toBe('Member');
    expect(snapshot.members[2].handle).toBe('bobcodes');
  });

  it('filters portfolio links to HTTPS only, deduplicates, and sorts them by url then label', () => {
    const snapshot = buildCanonicalRosterSnapshot(sampleInput);
    const bob = snapshot.members.find((m) => m.participantId === 'p-member-b');

    expect(bob).toBeDefined();
    // Insecure link ('http://insecure.com') was scrubbed
    expect(bob!.portfolioLinks).toHaveLength(2);
    expect(bob!.portfolioLinks[0].url).toBe('https://github.com/bob');
    expect(bob!.portfolioLinks[1].url).toBe('https://linkedin.com/in/bob');
  });

  it('produces identical serialized canonical JSON across reversed input member permutations', () => {
    const permutedInput: BuildCanonicalRosterSnapshotInput = {
      ...sampleInput,
      members: [...sampleInput.members].reverse(),
    };

    const snapshot1 = buildCanonicalRosterSnapshot(sampleInput);
    const snapshot2 = buildCanonicalRosterSnapshot(permutedInput);

    const json1 = serializeCanonicalRosterSnapshot(snapshot1);
    const json2 = serializeCanonicalRosterSnapshot(snapshot2);

    expect(json1).toBe(json2);
    expect(typeof json1).toBe('string');

    const parsed = JSON.parse(json1);
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'teamId',
      'teamName',
      'eventId',
      'eventTitle',
      'lockedAt',
      'memberCount',
      'members',
    ]);
  });
});
