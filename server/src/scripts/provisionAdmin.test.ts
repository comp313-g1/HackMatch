import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provisionAdmin, runCLI } from './provisionAdmin.js';
import * as participantsRepoModule from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';

const mockSetCustomUserClaims = vi.fn();
const mockGetUserByEmail = vi.fn();
const mockGetUser = vi.fn();

vi.mock('../config/firebase.js', () => ({
  firebaseAuth: {
    setCustomUserClaims: (...args: unknown[]) => mockSetCustomUserClaims(...args),
    getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
    getUser: (...args: unknown[]) => mockGetUser(...args),
  },
  auth: {
    setCustomUserClaims: (...args: unknown[]) => mockSetCustomUserClaims(...args),
    getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
    getUser: (...args: unknown[]) => mockGetUser(...args),
  },
  getFirebaseAdminAuth: vi.fn(),
  _resetFirebaseInstances: vi.fn(),
}));

describe('provisionAdmin script unit & integration tests (US-001 AC 4 / S1-P2-02)', () => {
  const mockAdminParticipant: Participant = {
    id: 'part-uuid-admin',
    firebase_uid: 'fb-uid-admin',
    email: 'admin@example.com',
    full_name: 'System Admin',
    role: 'ADMIN',
    is_verified: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully provisions an ADMIN given valid email and explicit uid', async () => {
    mockSetCustomUserClaims.mockResolvedValueOnce(undefined);
    mockGetUser.mockResolvedValueOnce({
      uid: 'fb-uid-admin',
      email: 'admin@example.com',
      customClaims: { role: 'ADMIN' },
    });

    const spyProvision = vi
      .spyOn(participantsRepoModule, 'provisionAdminParticipant')
      .mockResolvedValueOnce(mockAdminParticipant);

    const result = await provisionAdmin({
      email: 'admin@example.com',
      uid: 'fb-uid-admin',
      fullName: 'System Admin',
    });

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid-admin', { role: 'ADMIN' });
    expect(mockGetUser).toHaveBeenCalledWith('fb-uid-admin');
    expect(spyProvision).toHaveBeenCalledWith({
      firebase_uid: 'fb-uid-admin',
      email: 'admin@example.com',
      full_name: 'System Admin',
    });
    expect(result).toEqual({
      uid: 'fb-uid-admin',
      email: 'admin@example.com',
      role: 'ADMIN',
      participant: mockAdminParticipant,
    });
  });

  it('resolves user by email when uid is omitted', async () => {
    mockGetUserByEmail.mockResolvedValueOnce({
      uid: 'resolved-uid-999',
      email: 'lookup@example.com',
    });
    mockSetCustomUserClaims.mockResolvedValueOnce(undefined);
    mockGetUser.mockResolvedValueOnce({
      uid: 'resolved-uid-999',
      email: 'lookup@example.com',
      customClaims: { role: 'ADMIN' },
    });

    vi.spyOn(participantsRepoModule, 'provisionAdminParticipant').mockResolvedValueOnce({
      ...mockAdminParticipant,
      firebase_uid: 'resolved-uid-999',
      email: 'lookup@example.com',
    });

    const result = await provisionAdmin({
      email: 'lookup@example.com',
    });

    expect(mockGetUserByEmail).toHaveBeenCalledWith('lookup@example.com');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('resolved-uid-999', { role: 'ADMIN' });
    expect(result.uid).toBe('resolved-uid-999');
  });

  it('rejects with descriptive error when user is not found in Firebase Authentication', async () => {
    mockGetUserByEmail.mockRejectedValueOnce(new Error('auth/user-not-found'));

    await expect(
      provisionAdmin({ email: 'nonexistent@example.com' })
    ).rejects.toThrow(/User with email "nonexistent@example.com" not found in Firebase Authentication/);

    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('rejects when required email is missing or syntactically invalid', async () => {
    await expect(
      provisionAdmin({ email: '' })
    ).rejects.toThrow(/A valid email address is required/);

    await expect(
      provisionAdmin({ email: 'not-an-email' })
    ).rejects.toThrow(/A valid email address is required/);

    await expect(
      provisionAdmin(undefined as unknown as { email: string })
    ).rejects.toThrow(/Options object is required/);
  });

  it('throws when Firebase custom claim verification check fails', async () => {
    mockSetCustomUserClaims.mockResolvedValueOnce(undefined);
    mockGetUser.mockResolvedValueOnce({
      uid: 'fb-uid-admin',
      email: 'admin@example.com',
      customClaims: { role: 'PART' }, // Mismatched claim!
    });

    await expect(
      provisionAdmin({
        email: 'admin@example.com',
        uid: 'fb-uid-admin',
      })
    ).rejects.toThrow(/Failed to verify custom claims on Firebase user/);
  });

  it('supports demoting an administrator back to PART', async () => {
    mockSetCustomUserClaims.mockResolvedValueOnce(undefined);
    mockGetUser.mockResolvedValueOnce({
      uid: 'fb-uid-admin',
      email: 'admin@example.com',
      customClaims: { role: 'PART' },
    });

    vi.spyOn(participantsRepoModule.participantsRepository, 'findByFirebaseUid').mockResolvedValueOnce(
      mockAdminParticipant
    );
    const spyUpdate = vi
      .spyOn(participantsRepoModule.participantsRepository, 'updateParticipant')
      .mockResolvedValueOnce({
        ...mockAdminParticipant,
        role: 'PART',
      });

    const result = await provisionAdmin({
      email: 'admin@example.com',
      uid: 'fb-uid-admin',
      role: 'PART',
    });

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid-admin', { role: 'PART' });
    expect(spyUpdate).toHaveBeenCalledWith(mockAdminParticipant.id, { role: 'PART' });
    expect(result.role).toBe('PART');
  });

  describe('runCLI entry point', () => {
    it('executes successfully and logs non-sensitive summary', async () => {
      mockSetCustomUserClaims.mockResolvedValueOnce(undefined);
      mockGetUser.mockResolvedValueOnce({
        uid: 'fb-uid-cli',
        email: 'cli@example.com',
        customClaims: { role: 'ADMIN' },
      });

      vi.spyOn(participantsRepoModule, 'provisionAdminParticipant').mockResolvedValueOnce({
        ...mockAdminParticipant,
        firebase_uid: 'fb-uid-cli',
        email: 'cli@example.com',
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runCLI(['--email', 'cli@example.com', '--uid', 'fb-uid-cli']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Admin Provisioning] Successfully provisioned user:')
      );
      expect(consoleSpy).toHaveBeenCalledWith('  UID:   fb-uid-cli');
      expect(consoleSpy).toHaveBeenCalledWith('  Email: cli@example.com');
      expect(consoleSpy).toHaveBeenCalledWith('  Role:  ADMIN');

      consoleSpy.mockRestore();
    });

    it('exits with code 1 if email is missing', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit called with ${code}`);
      });

      await expect(runCLI([])).rejects.toThrow('process.exit called with 1');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: npm run admin:provision')
      );

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('exits with code 1 when provisioning throws an error', async () => {
      mockGetUserByEmail.mockRejectedValueOnce(new Error('auth/user-not-found'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit called with ${code}`);
      });

      await expect(
        runCLI(['--email', 'unknown@example.com'])
      ).rejects.toThrow('process.exit called with 1');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Admin Provisioning Error]')
      );

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});
