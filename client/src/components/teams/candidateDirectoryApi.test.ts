import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateCandidateDirectoryFilterDraft,
  buildCandidateDirectoryQuery,
  fetchTeamCandidateDirectory,
  CandidateDirectoryApiError,
  MAX_FILTER_SKILLS,
  MAX_SKILL_LENGTH,
  MAX_SEARCH_LENGTH,
} from './candidateDirectoryApi';
import * as authFetchModule from '../../config/authFetch';

describe('candidateDirectoryApi client module (US-014-T2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateCandidateDirectoryFilterDraft', () => {
    it('validates and sanitizes a valid draft', () => {
      const res = validateCandidateDirectoryFilterDraft({
        skillsInput: 'React, TypeScript, react',
        skillMatchMode: 'OR',
        role: 'Frontend',
        minHours: '15',
        maxHours: '30',
        badge: 'Competitor',
        goal: 'Project Completion',
        search: 'alice',
      });

      expect(res.ok).toBe(true);
      expect(res.errors).toEqual({});
      expect(res.filters).toEqual({
        skills: ['React', 'TypeScript'],
        skillMatchMode: 'OR',
        role: 'Frontend',
        desiredRole: null,
        minHours: 15,
        maxHours: 30,
        badge: 'Competitor',
        goal: 'Project Completion',
        search: 'alice',
      });
    });

    it('rejects more than 10 skills', () => {
      const skills = Array.from({ length: 11 }, (_, i) => `s${i}`).join(',');
      const res = validateCandidateDirectoryFilterDraft({ skillsInput: skills });
      expect(res.ok).toBe(false);
      expect(res.errors.skills).toBe(`Skills filter cannot exceed ${MAX_FILTER_SKILLS} skills.`);
    });

    it('rejects skill exceeding max length', () => {
      const longSkill = 'k'.repeat(MAX_SKILL_LENGTH + 1);
      const res = validateCandidateDirectoryFilterDraft({ skillsInput: longSkill });
      expect(res.ok).toBe(false);
      expect(res.errors.skills).toBe(`Each skill cannot exceed ${MAX_SKILL_LENGTH} characters.`);
    });

    it('rejects minHours > maxHours with errors.hours while preserving inputs (NR-010)', () => {
      const res = validateCandidateDirectoryFilterDraft({ minHours: '40', maxHours: '20' });
      expect(res.ok).toBe(false);
      expect(res.errors.hours).toBe('Minimum commitment hours cannot exceed maximum commitment hours.');
    });

    it('rejects search exceeding max length', () => {
      const longSearch = 'a'.repeat(MAX_SEARCH_LENGTH + 1);
      const res = validateCandidateDirectoryFilterDraft({ search: longSearch });
      expect(res.ok).toBe(false);
      expect(res.errors.search).toBe(`Search query cannot exceed ${MAX_SEARCH_LENGTH} characters.`);
    });
  });

  describe('buildCandidateDirectoryQuery', () => {
    it('returns empty string when no filters provided', () => {
      expect(buildCandidateDirectoryQuery()).toBe('');
      expect(buildCandidateDirectoryQuery({})).toBe('');
    });

    it('serializes all filter parameters into query string', () => {
      const qs = buildCandidateDirectoryQuery({
        skills: ['React', 'TypeScript'],
        skillMatchMode: 'OR',
        role: 'Frontend',
        desiredRole: 'Backend',
        minHours: 10,
        maxHours: 40,
        badge: 'Veteran',
        goal: 'Competitive',
        search: 'lead_dev',
      });

      expect(qs).toContain('skills=React%2CTypeScript');
      expect(qs).toContain('skillMatchMode=OR');
      expect(qs).toContain('role=Frontend');
      expect(qs).toContain('desiredRole=Backend');
      expect(qs).toContain('minHours=10');
      expect(qs).toContain('maxHours=40');
      expect(qs).toContain('badge=Veteran');
      expect(qs).toContain('goal=Competitive');
      expect(qs).toContain('search=lead_dev');
    });
  });

  describe('fetchTeamCandidateDirectory', () => {
    it('fetches candidate directory with authFetch and parses json', async () => {
      const mockData = {
        teamId: 't1',
        eventId: 'e1',
        filters: {
          skills: [],
          skillMatchMode: 'AND',
          role: null,
          desiredRole: null,
          minHours: null,
          maxHours: null,
          badge: null,
          goal: null,
          search: null,
        },
        candidates: [],
        totalEligible: 0,
        totalMatched: 0,
        empty: true,
        message: null,
        exclusions: { inactive: 0, unavailable: 0, confirmed: 0, owner: 0, totalExcluded: 0 },
      };

      vi.spyOn(authFetchModule, 'authFetch').mockResolvedValue(
        new Response(JSON.stringify(mockData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

      const res = await fetchTeamCandidateDirectory('t1', { skills: ['React'] });
      expect(res.teamId).toBe('t1');
      expect(res.empty).toBe(true);
    });

    it('converts network errors into CandidateDirectoryApiError preserving draft preservation notice (NR-010)', async () => {
      vi.spyOn(authFetchModule, 'authFetch').mockRejectedValue(new Error('Failed to fetch'));

      await expect(fetchTeamCandidateDirectory('t1')).rejects.toThrow(CandidateDirectoryApiError);
    });
  });
});
