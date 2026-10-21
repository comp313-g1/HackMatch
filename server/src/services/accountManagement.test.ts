import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ACCOUNT_PRIVACY_NOTICE,
  getAdminAccountDetail,
  listAdminAccounts,
  toSafeAdminAccountView,
} from './accountManagement.js';
import { accountsRepository } from '../db/accounts.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import type { Participant } from '../db/types.js';

describe('accountManagement (US-027 / #248)', () => {
  const part: Participant = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    firebase_uid: 'fb-part-secret',
    email: 'part@example.com',
    full_name: 'Ada Lovelace',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    suspended_at: null,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T01:00:00.000Z',
  };

  const suspended: Participant = {
    ...part,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    email: 'bad@example.com',
    full_name: 'Bad Actor',
    is_suspended: true,
    suspended_at: '2026-10-19T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('toSafeAdminAccountView omits firebase_uid and maps Active/Suspended', () => {
    const active = toSafeAdminAccountView(part, { handle: 'ada' });
    expect(active).toEqual({
      accountId: part.id,
      email: part.email,
      fullName: part.full_name,
      role: 'PART',
      state: 'Active',
      isVerified: true,
      suspendedAt: null,
      createdAt: part.created_at,
      handle: 'ada',
    });
    expect((active as unknown as Record<string, unknown>).firebase_uid).toBeUndefined();

    expect(toSafeAdminAccountView(suspended).state).toBe('Suspended');
  });

  it('lists accounts newest-first with handles and without credential fields', async () => {
    vi.spyOn(accountsRepository, 'listForAdmin').mockResolvedValue([suspended, part]);
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockImplementation(async (id) => {
      if (id === part.id) {
        return {
          participant_id: part.id,
          handle: 'ada',
          primary_role: 'Frontend',
          institution: null,
          shared_contact_handle: 'secret-discord',
          created_at: part.created_at,
          updated_at: part.updated_at,
        };
      }
      return null;
    });

    const accounts = await listAdminAccounts({ limit: 50 });

    expect(accounts).toHaveLength(2);
    expect(accounts[0]?.state).toBe('Suspended');
    expect(accounts[1]?.handle).toBe('ada');
    expect(JSON.stringify(accounts)).not.toMatch(/fb-part-secret|secret-discord|otp|password/i);
  });

  it('returns detail with relevant listings and privacy flags (success)', async () => {
    vi.spyOn(accountsRepository, 'findById').mockResolvedValue(part);
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: part.id,
      handle: 'ada',
      primary_role: 'Frontend',
      institution: 'UofT',
      shared_contact_handle: 'private@im',
      moderation_status: 'None',
      created_at: part.created_at,
      updated_at: part.updated_at,
    });
    vi.spyOn(accountsRepository, 'listRelevantListings').mockResolvedValue([
      {
        team_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        team_name: 'ByteCrafters',
        recruitment_status: 'Open',
        locked_at: null,
        membership_role: 'Owner',
        is_owner: true,
      },
    ]);

    const detail = await getAdminAccountDetail(part.id);

    expect(detail.account.accountId).toBe(part.id);
    expect(detail.account.state).toBe('Active');
    expect(detail.profile?.handle).toBe('ada');
    expect(detail.relevantListings).toEqual([
      expect.objectContaining({
        teamName: 'ByteCrafters',
        membershipRole: 'Owner',
        isOwner: true,
      }),
    ]);
    expect(detail.privacy).toEqual({
      credentialsIncluded: false,
      otpsIncluded: false,
      privateTeamNotesIncluded: false,
      privateContactsIncluded: false,
      notice: ACCOUNT_PRIVACY_NOTICE,
    });
    expect(JSON.stringify(detail)).not.toMatch(/private@im|fb-part-secret|otp_hash/i);
  });

  it('returns ACCOUNT_NOT_FOUND when detail target is missing (failure)', async () => {
    vi.spyOn(accountsRepository, 'findById').mockResolvedValue(null);
    await expect(getAdminAccountDetail(part.id)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      status: 404,
    });
  });
});
