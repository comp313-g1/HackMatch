import { describe, it, expect } from 'vitest';
import {
  validateWorkspaceLinksInput,
  validateWorkspaceNoteInput,
} from './teamWorkspace.validator.js';

describe('teamWorkspace.validator (US-023 / #US-023-T3 / FR-069)', () => {
  describe('validateWorkspaceLinksInput', () => {
    it('rejects non-object bodies, null, undefined, and arrays', () => {
      expect(validateWorkspaceLinksInput(null).ok).toBe(false);
      expect(validateWorkspaceLinksInput(undefined).ok).toBe(false);
      expect(validateWorkspaceLinksInput('string').ok).toBe(false);
      expect(validateWorkspaceLinksInput(42).ok).toBe(false);
      expect(validateWorkspaceLinksInput([]).ok).toBe(false);
    });

    it('rejects unknown top-level properties', () => {
      const res = validateWorkspaceLinksInput({
        links: [],
        note: 'malicious payload',
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.body).toContain('Only "links" is allowed');
      }
    });

    it('rejects non-array links property', () => {
      const res = validateWorkspaceLinksInput({ links: 'not an array' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.links).toContain('must be an array');
      }
    });

    it('rejects more than 10 links (WORKSPACE_MAX_LINKS cap)', () => {
      const elevenLinks = Array.from({ length: 11 }, (_, i) => ({
        label: `Link ${i}`,
        url: `https://example${i}.com/tool`,
      }));
      const res = validateWorkspaceLinksInput({ links: elevenLinks });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors.links).toContain('At most 10 external tool links');
      }
    });

    it('allows an empty links array (clearing links)', () => {
      const res = validateWorkspaceLinksInput({ links: [] });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.links).toEqual([]);
      }
    });

    it('rejects non-object link items', () => {
      const res = validateWorkspaceLinksInput({
        links: ['https://github.com/myteam'],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors['links[0]']).toContain('must be an object');
      }
    });

    it('rejects forbidden privilege escalation properties on link items', () => {
      const res = validateWorkspaceLinksInput({
        links: [
          {
            label: 'GitHub',
            url: 'https://github.com/team',
            teamId: 'injected-team-id',
          },
        ],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors['links[0]']).toContain('Property "teamId" is not permitted');
      }
    });

    it('rejects unknown properties on link items', () => {
      const res = validateWorkspaceLinksInput({
        links: [
          {
            label: 'GitHub',
            url: 'https://github.com/team',
            extraSecret: 'attack',
          },
        ],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors['links[0]']).toContain('Unknown property "extraSecret"');
      }
    });

    it('validates link labels (must be non-empty and <= 80 characters)', () => {
      const emptyLabelRes = validateWorkspaceLinksInput({
        links: [{ label: '   ', url: 'https://github.com/team' }],
      });
      expect(emptyLabelRes.ok).toBe(false);
      if (!emptyLabelRes.ok) {
        expect(emptyLabelRes.errors['links[0].label']).toContain('cannot be empty');
      }

      const longLabelRes = validateWorkspaceLinksInput({
        links: [{ label: 'a'.repeat(81), url: 'https://github.com/team' }],
      });
      expect(longLabelRes.ok).toBe(false);
      if (!longLabelRes.ok) {
        expect(longLabelRes.errors['links[0].label']).toContain('cannot exceed 80 characters');
      }
    });

    it('validates link URLs (must be secure HTTPS, rejecting HTTP and unsafe schemes)', () => {
      const insecureHttp = validateWorkspaceLinksInput({
        links: [{ label: 'HTTP Link', url: 'http://insecure.example.com' }],
      });
      expect(insecureHttp.ok).toBe(false);
      if (!insecureHttp.ok) {
        expect(insecureHttp.errors['links[0].url']).toContain('valid HTTPS link');
      }

      const xssRes = validateWorkspaceLinksInput({
        links: [{ label: 'XSS', url: 'javascript:alert(1)' }],
      });
      expect(xssRes.ok).toBe(false);

      const credentialRes = validateWorkspaceLinksInput({
        links: [{ label: 'Creds', url: 'https://user:pass@example.com/team' }],
      });
      expect(credentialRes.ok).toBe(false);
    });

    it('rejects duplicate URLs within the same submission (case-insensitive)', () => {
      const res = validateWorkspaceLinksInput({
        links: [
          { label: 'Figma 1', url: 'https://figma.com/file/abc' },
          { label: 'Figma 2', url: 'HTTPS://FIGMA.COM/file/abc' },
        ],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors['links[1].url']).toContain('Duplicate link URL');
      }
    });

    it('normalizes valid links and accepts valid HTTPS links', () => {
      const res = validateWorkspaceLinksInput({
        links: [
          {
            label: '  Sprint   Board  ',
            url: '  https://trello.com/b/123/sprint  ',
            display_order: 0,
          },
          {
            label: 'GitHub Repo',
            url: 'https://github.com/org/repo',
            display_order: 1,
          },
        ],
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.links).toEqual([
          {
            label: 'Sprint Board',
            url: 'https://trello.com/b/123/sprint',
            display_order: 0,
          },
          {
            label: 'GitHub Repo',
            url: 'https://github.com/org/repo',
            display_order: 1,
          },
        ]);
      }
    });
  });

  describe('validateWorkspaceNoteInput (US-023 / #US-023-T4 / FR-070)', () => {
    it('rejects non-object bodies, null, undefined, and arrays', () => {
      expect(validateWorkspaceNoteInput(null).ok).toBe(false);
      expect(validateWorkspaceNoteInput(undefined).ok).toBe(false);
      expect(validateWorkspaceNoteInput('hello').ok).toBe(false);
      expect(validateWorkspaceNoteInput(123).ok).toBe(false);
      expect(validateWorkspaceNoteInput([]).ok).toBe(false);
    });

    it('rejects unknown or forbidden tampering properties', () => {
      const versionAttack = validateWorkspaceNoteInput({
        content: '# Concept',
        expectedVersion: 1,
        version: 5,
      });
      expect(versionAttack.ok).toBe(false);
      if (!versionAttack.ok) {
        expect(versionAttack.errors.body).toContain('Property "version" is not permitted');
      }

      const authorAttack = validateWorkspaceNoteInput({
        content: '# Concept',
        expectedVersion: 1,
        authorId: 'fake-id',
      });
      expect(authorAttack.ok).toBe(false);

      const unknownProp = validateWorkspaceNoteInput({
        content: '# Concept',
        expectedVersion: 1,
        injected: 'hack',
      });
      expect(unknownProp.ok).toBe(false);
      if (!unknownProp.ok) {
        expect(unknownProp.errors.body).toContain('Only "content" and "expectedVersion" are permitted');
      }
    });

    it('validates note content (must be non-empty string <= 10,000 chars)', () => {
      const missingContent = validateWorkspaceNoteInput({ expectedVersion: 0 });
      expect(missingContent.ok).toBe(false);
      if (!missingContent.ok) {
        expect(missingContent.errors.content).toContain('Note content is required');
      }

      const emptyContent = validateWorkspaceNoteInput({
        content: '   \n\t  ',
        expectedVersion: 0,
      });
      expect(emptyContent.ok).toBe(false);
      if (!emptyContent.ok) {
        expect(emptyContent.errors.content).toContain('cannot be empty');
      }

      const excessiveContent = validateWorkspaceNoteInput({
        content: 'a'.repeat(10001),
        expectedVersion: 0,
      });
      expect(excessiveContent.ok).toBe(false);
      if (!excessiveContent.ok) {
        expect(excessiveContent.errors.content).toContain('cannot exceed 10000 characters');
      }
    });

    it('validates expectedVersion (must be integer >= 0)', () => {
      const missingVersion = validateWorkspaceNoteInput({ content: '# Architecture' });
      expect(missingVersion.ok).toBe(false);
      if (!missingVersion.ok) {
        expect(missingVersion.errors.expectedVersion).toContain('expectedVersion is required');
      }

      const negativeVersion = validateWorkspaceNoteInput({
        content: '# Architecture',
        expectedVersion: -1,
      });
      expect(negativeVersion.ok).toBe(false);
      if (!negativeVersion.ok) {
        expect(negativeVersion.errors.expectedVersion).toContain('must be a non-negative integer');
      }

      const floatVersion = validateWorkspaceNoteInput({
        content: '# Architecture',
        expectedVersion: 1.5,
      });
      expect(floatVersion.ok).toBe(false);

      const stringVersion = validateWorkspaceNoteInput({
        content: '# Architecture',
        expectedVersion: '0',
      });
      expect(stringVersion.ok).toBe(false);
    });

    it('normalizes carriage returns and trims outer whitespace for valid payload', () => {
      const res = validateWorkspaceNoteInput({
        content: '  # HackMatch Architecture\r\n\r\n- Step 1: Design\r\n- Step 2: Implement  ',
        expectedVersion: 2,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.sanitized).toEqual({
          content: '# HackMatch Architecture\n\n- Step 1: Design\n- Step 2: Implement',
          expectedVersion: 2,
        });
      }
    });
  });
});
