import { describe, expect, it } from 'vitest';
import {
  createTotpSecretProtector,
  createTotpSecretProtectorFromEnvironment,
  TotpEncryptionConfigurationError,
  TotpSecretIntegrityError,
} from './totpSecretEncryption.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const context = {
  participantId: '10000000-0000-4000-8000-000000000001',
  enrollmentId: '20000000-0000-4000-8000-000000000002',
};

describe('TOTP secret protection (US-029 / #267)', () => {
  it('uses randomized authenticated encryption and decrypts with valid context', () => {
    const protector = createTotpSecretProtector(KEY, 'v1');
    const first = protector.encrypt('JBSWY3DPEHPK3PXP', context);
    const second = protector.encrypt('JBSWY3DPEHPK3PXP', context);

    expect(first.ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(protector.decrypt(first, context)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('binds ciphertext to owner, enrollment, key version, and key material', () => {
    const protector = createTotpSecretProtector(KEY, 'v1');
    const encrypted = protector.encrypt('JBSWY3DPEHPK3PXP', context);

    expect(() =>
      protector.decrypt(encrypted, { ...context, participantId: 'another-owner' })
    ).toThrow(TotpSecretIntegrityError);
    expect(() =>
      protector.decrypt(encrypted, { ...context, enrollmentId: 'another-enrollment' })
    ).toThrow(TotpSecretIntegrityError);
    expect(() => createTotpSecretProtector(OTHER_KEY, 'v1').decrypt(encrypted, context)).toThrow(
      TotpSecretIntegrityError
    );
    expect(() => createTotpSecretProtector(KEY, 'v2').decrypt(encrypted, context)).toThrow(
      TotpEncryptionConfigurationError
    );
  });

  it('fails closed when ciphertext or authentication metadata is corrupted', () => {
    const protector = createTotpSecretProtector(KEY, 'v1');
    const encrypted = protector.encrypt('JBSWY3DPEHPK3PXP', context);

    expect(() =>
      protector.decrypt({ ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` }, context)
    ).toThrow(TotpSecretIntegrityError);
    expect(() => protector.decrypt({ ...encrypted, iv: 'bad' }, context)).toThrow(
      TotpSecretIntegrityError
    );
    expect(() => protector.decrypt({ ...encrypted, authTag: 'bad' }, context)).toThrow(
      TotpSecretIntegrityError
    );
  });

  it.each([
    {},
    { TOTP_ENCRYPTION_KEY_BASE64: 'base64-is-not-encryption' },
    { TOTP_ENCRYPTION_KEY_BASE64: Buffer.alloc(16).toString('base64') },
    { TOTP_ENCRYPTION_KEY_BASE64: KEY, TOTP_ENCRYPTION_KEY_VERSION: 'bad version' },
  ])('rejects missing or malformed runtime configuration %#', (env) => {
    expect(() => createTotpSecretProtectorFromEnvironment(env)).toThrow(
      TotpEncryptionConfigurationError
    );
  });
});
