import { describe, expect, it, vi } from 'vitest';
import { createHmac, hkdfSync } from 'node:crypto';
import {
  RECOVERY_CODE_POLICY,
  createRecoveryCodeVerifier,
  createRecoveryCodeVerifierFromEnvironment,
  generateRecoveryCode,
  generateRecoveryCodeSet,
  normalizeRecoveryCode,
} from './recoveryCodes.js';
import { TotpEncryptionConfigurationError } from './totpSecretEncryption.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64');
const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){2}$/;

describe('recovery-code generation and verifiers (US-029 / #269)', () => {
  it('generates human-enterable codes from an unambiguous 32-symbol alphabet (60 bits)', () => {
    expect(RECOVERY_CODE_POLICY.alphabet).toHaveLength(32);
    expect(RECOVERY_CODE_POLICY.alphabet).not.toMatch(/[01IO]/);
    const bits =
      RECOVERY_CODE_POLICY.groups *
      RECOVERY_CODE_POLICY.groupLength *
      Math.log2(RECOVERY_CODE_POLICY.alphabet.length);
    expect(bits).toBe(60);
    for (let index = 0; index < 50; index += 1) {
      expect(generateRecoveryCode()).toMatch(CODE_PATTERN);
    }
  });

  it('draws every symbol from the injected CSPRNG source rather than Math.random', () => {
    const mathRandom = vi.spyOn(Math, 'random');
    const nextIndex = vi.fn(() => 0);
    expect(generateRecoveryCode(nextIndex)).toBe('AAAA-AAAA-AAAA');
    expect(nextIndex).toHaveBeenCalledTimes(12);
    expect(nextIndex).toHaveBeenCalledWith(32);
    generateRecoveryCodeSet();
    expect(mathRandom).not.toHaveBeenCalled();
    mathRandom.mockRestore();
  });

  it('generates a unique set of the approved size and redraws duplicates', () => {
    const set = generateRecoveryCodeSet();
    expect(set).toHaveLength(10);
    expect(new Set(set).size).toBe(10);

    let calls = 0;
    // First two codes collide, then the generator advances.
    const nextIndex = () => (calls++ < 24 ? 0 : (calls % 32));
    const redrawn = generateRecoveryCodeSet(3, nextIndex);
    expect(new Set(redrawn).size).toBe(3);
  });

  it('fails closed instead of looping forever on a broken random source', () => {
    expect(() => generateRecoveryCodeSet(2, () => 0)).toThrow('RECOVERY_CODE_GENERATION_FAILED');
  });

  it('normalizes case, spaces, and separators but rejects non-codes', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(normalizeRecoveryCode(' ABCD EFGH JKMN ')).toBe('ABCDEFGHJKMN');
    expect(normalizeRecoveryCode('ABCD-EFGH-JKM0')).toBeNull();
    expect(normalizeRecoveryCode('ABCD-EFGH')).toBeNull();
    expect(normalizeRecoveryCode('')).toBeNull();
  });

  it('stores an irreversible, owner-bound, key-bound verifier that never contains the code', () => {
    const verifier = createRecoveryCodeVerifier(KEY, 'v1');
    const code = 'ABCD-EFGH-JKMN';
    const stored = verifier.verifierFor(OWNER, code);

    expect(stored).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toContain('ABCD');
    expect(stored).not.toContain('ABCDEFGHJKMN');
    expect(verifier.keyVersion).toBe('v1');
    // Deterministic for the same owner and normalized code (enables later lookup).
    expect(verifier.verifierFor(OWNER, 'abcd efgh jkmn')).toBe(stored);
    // Another account's identical code never produces the same verifier.
    expect(verifier.verifierFor(OTHER, code)).not.toBe(stored);
    // Without the server key the verifier cannot be reproduced.
    expect(createRecoveryCodeVerifier(OTHER_KEY, 'v1').verifierFor(OWNER, code)).not.toBe(stored);
  });

  it('keys verifiers with an HKDF subkey (distinct info), never the raw TOTP encryption key', () => {
    const message = `hackmatch:recovery:v1:${OWNER}:ABCDEFGHJKMN`;
    const rawKey = Buffer.from(KEY, 'base64');
    const separatedKey = Buffer.from(
      hkdfSync('sha256', rawKey, Buffer.alloc(0), 'hackmatch:recovery-code-verifier:v1', 32)
    );
    const stored = createRecoveryCodeVerifier(KEY, 'v1').verifierFor(OWNER, 'ABCD-EFGH-JKMN');

    expect(stored).toBe(createHmac('sha256', separatedKey).update(message).digest('base64url'));
    expect(stored).not.toBe(createHmac('sha256', rawKey).update(message).digest('base64url'));
    expect(separatedKey.equals(rawKey)).toBe(false);
  });

  it('rejects malformed codes and missing owners before hashing', () => {
    const verifier = createRecoveryCodeVerifier(KEY, 'v1');
    expect(() => verifier.verifierFor(OWNER, 'not-a-code')).toThrow('RECOVERY_CODE_INVALID_FORMAT');
    expect(() => verifier.verifierFor('', 'ABCD-EFGH-JKMN')).toThrow('RECOVERY_CODE_INVALID_FORMAT');
  });

  it('reuses the existing server key configuration and fails closed when absent', () => {
    expect(() => createRecoveryCodeVerifierFromEnvironment({})).toThrow(
      TotpEncryptionConfigurationError
    );
    expect(() => createRecoveryCodeVerifier('short', 'v1')).toThrow(
      TotpEncryptionConfigurationError
    );
    expect(() => createRecoveryCodeVerifier(KEY, 'bad version!')).toThrow(
      TotpEncryptionConfigurationError
    );
    const fromEnv = createRecoveryCodeVerifierFromEnvironment({
      TOTP_ENCRYPTION_KEY_BASE64: KEY,
      TOTP_ENCRYPTION_KEY_VERSION: 'v2',
    });
    expect(fromEnv.keyVersion).toBe('v2');
    expect(fromEnv.verifierFor(OWNER, 'ABCD-EFGH-JKMN')).toBe(
      createRecoveryCodeVerifier(KEY, 'v2').verifierFor(OWNER, 'ABCD-EFGH-JKMN')
    );
  });
});
