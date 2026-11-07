import { describe, it, expect } from 'vitest';
import {
  publicPayloadHasPrivateWorkspaceKey,
  scrubPrivateWorkspaceFields,
  sanitizeWorkspaceMarkdown,
  projectWorkspaceTeammateContact,
  resolveWorkspaceRevisionAuthor,
  WORKSPACE_PRIVACY_NOTICE,
  workspacePrivacyFlags,
} from './workspacePrivacy.js';
import type { Participant, TeamMembership } from '../db/types.js';
import type { PermittedCandidateProfileView } from './profilePrivacy.js';

describe('workspacePrivacy service (US-023 / #US-023-T7 / NR-009 / NR-023)', () => {
  const activeParticipant: Participant = {
    id: '11111111-1111-1111-1111-111111111111',
    firebase_uid: 'firebase-user-1',
    email: 'alice@example.com',
    full_name: 'Alice Developer',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    suspension_reason: null,
    is_deactivated: false,
    deactivated_at: null,
    deactivation_reason: null,
    created_at: '2026-10-25T12:00:00Z',
    updated_at: '2026-10-25T12:00:00Z',
  };

  const deactivatedParticipant: Participant = {
    ...activeParticipant,
    id: '22222222-2222-2222-2222-222222222222',
    email: 'deleted+22222222@deleted.invalid',
    firebase_uid: 'deleted:22222222-2222-2222-2222-222222222222',
    is_deactivated: true,
    deactivated_at: '2026-10-26T12:00:00Z',
  };

  const sampleProfileView: PermittedCandidateProfileView = {
    viewerCategory: 'CONFIRMED_TEAMMATE',
    displayName: 'Alice Developer',
    participantId: activeParticipant.id,
    handle: 'alicedev',
    institution: 'Centennial College',
    primaryRole: 'Frontend',
    skills: ['React', 'TypeScript'],
    skillsSelfDeclared: true,
    portfolioLinks: [
      {
        url: 'https://github.com/alice',
        label: 'GitHub',
        isSelfDeclared: true,
      },
    ],
    selfDeclaredNotice: 'Skills and links are self-declared.',
    sharedContactHandle: 'alice#1234',
    sharedContactAudienceNotice: 'Visible only to confirmed teammates.',
    experienceBadge: 'Competitor',
    experienceBadgeSelfReported: true,
    hackathonCount: 1,
    hackathonHistory: [],
  };

  const sampleMembership: TeamMembership = {
    id: 'mem-1',
    team_id: 'team-1',
    event_id: 'event-1',
    participant_id: activeParticipant.id,
    role: 'Member',
    status: 'Confirmed',
    removal_reason: null,
    joined_at: '2026-10-25T12:00:00Z',
    ended_at: null,
    created_at: '2026-10-25T12:00:00Z',
    updated_at: '2026-10-25T12:00:00Z',
  };

  describe('publicPayloadHasPrivateWorkspaceKey & scrubPrivateWorkspaceFields', () => {
    it('detects and deep-scrubs forbidden authentication and identity keys', () => {
      const payloadWithPii = {
        teamId: 'team-1',
        email: 'alice@example.com',
        firebase_uid: 'firebase-user-1',
        teammates: [
          {
            displayName: 'Alice',
            email: 'alice@example.com',
            token: 'secret-token',
            password: 'hash',
            sharedContactHandle: 'alice#1234',
          },
        ],
      };

      expect(publicPayloadHasPrivateWorkspaceKey(payloadWithPii)).toBe(true);

      const scrubbed = scrubPrivateWorkspaceFields(payloadWithPii);
      expect(publicPayloadHasPrivateWorkspaceKey(scrubbed)).toBe(false);

      expect(scrubbed).not.toHaveProperty('email');
      expect(scrubbed).not.toHaveProperty('firebase_uid');
      expect(scrubbed.teammates[0]).not.toHaveProperty('email');
      expect(scrubbed.teammates[0]).not.toHaveProperty('token');
      expect(scrubbed.teammates[0]).not.toHaveProperty('password');
      expect(scrubbed.teammates[0].sharedContactHandle).toBe('alice#1234');
    });
  });

  describe('sanitizeWorkspaceMarkdown (NR-009)', () => {
    it('strips dangerous HTML tags and event handlers', () => {
      const input =
        '# Title\n<script>alert("xss")</script><iframe src="evil.com"></iframe><img src="x" onerror="steal()" />Text';
      const output = sanitizeWorkspaceMarkdown(input);
      expect(output).not.toContain('<script');
      expect(output).not.toContain('<iframe');
      expect(output).not.toContain('onerror=');
      expect(output).toContain('# Title');
      expect(output).toContain('Text');
    });

    it('neutralizes unsafe markdown links into [unsafe link removed]', () => {
      const input =
        'Safe: [GitHub](https://github.com/myteam)\nUnsafe: [Attack](javascript:alert(1)) and [Data](data:text/html,evil)';
      const output = sanitizeWorkspaceMarkdown(input);
      expect(output).toContain('[GitHub](https://github.com/myteam)');
      expect(output).toContain('Attack [unsafe link removed]');
      expect(output).toContain('Data [unsafe link removed]');
    });
  });

  describe('projectWorkspaceTeammateContact (NR-023 / US-023 AC 2)', () => {
    it('projects active member profile without private identity fields', () => {
      const result = projectWorkspaceTeammateContact({
        participant: activeParticipant,
        projectedProfile: sampleProfileView,
        membership: sampleMembership,
      });

      expect(result.displayName).toBe('Alice Developer');
      expect(result.handle).toBe('alicedev');
      expect(result.sharedContactHandle).toBe('alice#1234');
      expect(result.isPseudonymized).toBe(false);
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('firebase_uid');
    });

    it('pseudonymizes deleted/deactivated teammate and suppresses contact details (NR-023)', () => {
      const result = projectWorkspaceTeammateContact({
        participant: deactivatedParticipant,
        projectedProfile: sampleProfileView,
        membership: {
          ...sampleMembership,
          participant_id: deactivatedParticipant.id,
        },
      });

      expect(result.displayName).toMatch(/^Former Member [0-9a-f]{8}$/);
      expect(result.handle).toBeNull();
      expect(result.institution).toBeNull();
      expect(result.primaryRole).toBeNull();
      expect(result.sharedContactHandle).toBeNull();
      expect(result.portfolioLinks).toEqual([]);
      expect(result.isPseudonymized).toBe(true);
    });
  });

  describe('resolveWorkspaceRevisionAuthor (US-023 AC 4 / NR-023)', () => {
    it('returns author display name when active', () => {
      const author = resolveWorkspaceRevisionAuthor({
        author_id: activeParticipant.id,
        author_display_name: 'alicedev',
        author_pseudonymized_at: null,
      });
      expect(author).toBe('alicedev');
    });

    it('returns pseudonym when author_pseudonymized_at is set or author_id is null', () => {
      const pseudonymized = resolveWorkspaceRevisionAuthor({
        author_id: null,
        author_display_name: 'Former Member 22222222',
        author_pseudonymized_at: '2026-10-26T12:00:00Z',
      });
      expect(pseudonymized).toBe('Former Member 22222222');

      const nullAuthor = resolveWorkspaceRevisionAuthor({
        author_id: null,
        author_display_name: '',
        author_pseudonymized_at: null,
      });
      expect(nullAuthor).toBe('Former Member');
    });
  });

  describe('workspacePrivacyFlags', () => {
    it('returns standard privacy notice and scrub verification flags', () => {
      const flags = workspacePrivacyFlags();
      expect(flags.notice).toBe(WORKSPACE_PRIVACY_NOTICE);
      expect(flags.emailsScrubbed).toBe(true);
      expect(flags.authUidsScrubbed).toBe(true);
    });
  });
});
