import { describe, expect, it } from 'vitest';
import {
  isWorkspaceLinkLabelTooLong,
  isWorkspaceLinkUrlTooLong,
  isWorkspaceNoteTooLong,
  isValidExpectedVersion,
  isValidWorkspaceLinkCount,
  normalizeWorkspaceAuthorDisplayName,
  normalizeWorkspaceLinkLabel,
  normalizeWorkspaceLinkUrl,
  normalizeWorkspaceNoteContent,
  WORKSPACE_AUTHOR_DISPLAY_MAX_LENGTH,
  WORKSPACE_LINK_LABEL_MAX_LENGTH,
  WORKSPACE_LINK_URL_MAX_LENGTH,
  WORKSPACE_MAX_LINKS,
  WORKSPACE_NOTE_MAX_LENGTH,
} from './teamWorkspaceModel.js';

describe('teamWorkspaceModel constants and validators (US-023 / #US-023-T1)', () => {
  it('defines boundary constants correctly', () => {
    expect(WORKSPACE_LINK_LABEL_MAX_LENGTH).toBe(80);
    expect(WORKSPACE_LINK_URL_MAX_LENGTH).toBe(2048);
    expect(WORKSPACE_MAX_LINKS).toBe(10);
    expect(WORKSPACE_NOTE_MAX_LENGTH).toBe(10000);
    expect(WORKSPACE_AUTHOR_DISPLAY_MAX_LENGTH).toBe(120);
  });

  describe('normalizeWorkspaceLinkLabel & isWorkspaceLinkLabelTooLong', () => {
    it('returns null for null, undefined, and whitespace-only labels', () => {
      expect(normalizeWorkspaceLinkLabel(null)).toBeNull();
      expect(normalizeWorkspaceLinkLabel(undefined)).toBeNull();
      expect(normalizeWorkspaceLinkLabel('')).toBeNull();
      expect(normalizeWorkspaceLinkLabel('   \t\n  ')).toBeNull();
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeWorkspaceLinkLabel('  Figma Board  ')).toBe('Figma Board');
    });

    it('checks length constraints against WORKSPACE_LINK_LABEL_MAX_LENGTH (80)', () => {
      const valid80 = 'a'.repeat(80);
      const invalid81 = 'a'.repeat(81);
      expect(isWorkspaceLinkLabelTooLong(valid80)).toBe(false);
      expect(isWorkspaceLinkLabelTooLong(invalid81)).toBe(true);
      expect(isWorkspaceLinkLabelTooLong(null)).toBe(false);
    });
  });

  describe('normalizeWorkspaceLinkUrl & isWorkspaceLinkUrlTooLong', () => {
    it('accepts valid HTTPS URLs and returns normalized string', () => {
      expect(normalizeWorkspaceLinkUrl('https://github.com/org/repo')).toBe(
        'https://github.com/org/repo'
      );
      expect(normalizeWorkspaceLinkUrl('  https://trello.com/b/123/sprint  ')).toBe(
        'https://trello.com/b/123/sprint'
      );
      expect(normalizeWorkspaceLinkUrl('https://figma.com/@team/design')).toBe(
        'https://figma.com/@team/design'
      );
    });

    it('strictly rejects non-HTTPS schemes (FR-069, US-023 AC 3)', () => {
      expect(normalizeWorkspaceLinkUrl('http://insecure.example.com')).toBeNull();
      expect(normalizeWorkspaceLinkUrl('javascript:alert(1)')).toBeNull();
      expect(normalizeWorkspaceLinkUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
      expect(normalizeWorkspaceLinkUrl('ftp://ftp.example.com')).toBeNull();
      expect(normalizeWorkspaceLinkUrl('mailto:user@example.com')).toBeNull();
      expect(normalizeWorkspaceLinkUrl('file:///etc/passwd')).toBeNull();
    });

    it('rejects malformed or too short URLs', () => {
      expect(normalizeWorkspaceLinkUrl('https://')).toBeNull();
      expect(normalizeWorkspaceLinkUrl('https://a')).toBe('https://a/');
      expect(normalizeWorkspaceLinkUrl('not a url')).toBeNull();
      expect(normalizeWorkspaceLinkUrl(null)).toBeNull();
      expect(normalizeWorkspaceLinkUrl(undefined)).toBeNull();
    });

    it('enforces maximum length (2048)', () => {
      const longPath = 'a'.repeat(2048);
      const invalidUrl = `https://example.com/${longPath}`;
      expect(normalizeWorkspaceLinkUrl(invalidUrl)).toBeNull();
      expect(isWorkspaceLinkUrlTooLong(invalidUrl)).toBe(true);

      const validUrl = 'https://example.com/ok';
      expect(isWorkspaceLinkUrlTooLong(validUrl)).toBe(false);
      expect(isWorkspaceLinkUrlTooLong(null)).toBe(false);
    });
  });

  describe('normalizeWorkspaceAuthorDisplayName', () => {
    it('trims author display name and returns null for empty', () => {
      expect(normalizeWorkspaceAuthorDisplayName(null)).toBeNull();
      expect(normalizeWorkspaceAuthorDisplayName(undefined)).toBeNull();
      expect(normalizeWorkspaceAuthorDisplayName('   ')).toBeNull();
      expect(normalizeWorkspaceAuthorDisplayName(' Alice Johnson ')).toBe('Alice Johnson');
    });
  });

  describe('normalizeWorkspaceNoteContent & isWorkspaceNoteTooLong', () => {
    it('returns null for empty or whitespace-only content', () => {
      expect(normalizeWorkspaceNoteContent(null)).toBeNull();
      expect(normalizeWorkspaceNoteContent(undefined)).toBeNull();
      expect(normalizeWorkspaceNoteContent('')).toBeNull();
      expect(normalizeWorkspaceNoteContent('   \n\t  ')).toBeNull();
    });

    it('preserves multi-line markdown notes when valid', () => {
      const note = '# Architecture Plan\n\n- Step 1: Design\n- Step 2: Implement';
      expect(normalizeWorkspaceNoteContent(note)).toBe(note);
    });

    it('enforces maximum note length (10,000 characters)', () => {
      const valid10k = 'x'.repeat(10000);
      const invalid10kPlus = 'x'.repeat(10001);
      expect(isWorkspaceNoteTooLong(valid10k)).toBe(false);
      expect(isWorkspaceNoteTooLong(invalid10kPlus)).toBe(true);
      expect(isWorkspaceNoteTooLong(null)).toBe(false);
    });
  });

  describe('isValidExpectedVersion', () => {
    it('returns true for non-negative integers', () => {
      expect(isValidExpectedVersion(0)).toBe(true);
      expect(isValidExpectedVersion(1)).toBe(true);
      expect(isValidExpectedVersion(42)).toBe(true);
    });

    it('returns false for negative numbers, decimals, non-numbers, or NaN', () => {
      expect(isValidExpectedVersion(-1)).toBe(false);
      expect(isValidExpectedVersion(1.5)).toBe(false);
      expect(isValidExpectedVersion('0')).toBe(false);
      expect(isValidExpectedVersion(null)).toBe(false);
      expect(isValidExpectedVersion(undefined)).toBe(false);
      expect(isValidExpectedVersion(NaN)).toBe(false);
    });
  });

  describe('isValidWorkspaceLinkCount', () => {
    it('returns true when array length <= 10', () => {
      expect(isValidWorkspaceLinkCount([])).toBe(true);
      expect(isValidWorkspaceLinkCount(new Array(10).fill({}))).toBe(true);
    });

    it('returns false when array length > 10 or not an array', () => {
      expect(isValidWorkspaceLinkCount(new Array(11).fill({}))).toBe(false);
      expect(isValidWorkspaceLinkCount(null)).toBe(false);
      expect(isValidWorkspaceLinkCount({})).toBe(false);
    });
  });
});
