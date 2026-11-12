import { createHmac, hkdfSync, randomInt } from 'node:crypto';
import { TotpEncryptionConfigurationError } from './totpSecretEncryption.js';

/**
 * US-029 / #269 recovery-code policy.
 *
 * Codes are server-generated, single-use account recovery credentials. They are
 * returned to the owner exactly once and persisted only as keyed HMAC verifiers,
 * so a database disclosure alone cannot recover or test a code offline.
 *
 * Format: three groups of four characters (e.g. `7KQM-2XHD-PW9C`) drawn from a
 * 32-symbol alphabet without the ambiguous 0/O/1/I characters: 12 × 5 bits =
 * 60 bits of CSPRNG entropy per code.
 */
export const RECOVERY_CODE_POLICY = Object.freeze({
  count: 10,
  groups: 3,
  groupLength: 4,
  alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
});

const KEY_BYTES = 32;
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
const HKDF_INFO = 'hackmatch:recovery-code-verifier:v1';
const CODE_LENGTH = RECOVERY_CODE_POLICY.groups * RECOVERY_CODE_POLICY.groupLength;
const NORMALIZED_PATTERN = new RegExp(
  `^[${RECOVERY_CODE_POLICY.alphabet}]{${CODE_LENGTH}}$`
);

export interface RecoveryCodeVerifier {
  /** Computes the stored verifier for an owner's normalized code. */
  verifierFor(participantId: string, code: string): string;
  readonly keyVersion: string;
}

export type RandomIndex = (maxExclusive: number) => number;

export function generateRecoveryCode(nextIndex: RandomIndex = randomInt): string {
  const { alphabet, groups, groupLength } = RECOVERY_CODE_POLICY;
  const parts: string[] = [];
  for (let group = 0; group < groups; group += 1) {
    let part = '';
    for (let index = 0; index < groupLength; index += 1) {
      part += alphabet[nextIndex(alphabet.length)];
    }
    parts.push(part);
  }
  return parts.join('-');
}

/** Generates a unique set; duplicates (≈2^-54 per pair) are simply redrawn. */
export function generateRecoveryCodeSet(
  count: number = RECOVERY_CODE_POLICY.count,
  nextIndex: RandomIndex = randomInt
): string[] {
  const codes = new Set<string>();
  let attempts = 0;
  while (codes.size < count) {
    attempts += 1;
    if (attempts > count * 10) {
      throw new Error('RECOVERY_CODE_GENERATION_FAILED');
    }
    codes.add(generateRecoveryCode(nextIndex));
  }
  return [...codes];
}

/**
 * Canonical form used for verifiers: uppercase with separators and whitespace
 * removed. Returns null when the input cannot be a HackMatch recovery code.
 */
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.toUpperCase().replace(/[\s-]+/g, '');
  return NORMALIZED_PATTERN.test(normalized) ? normalized : null;
}

function decodeKey(encodedKey: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    throw new TotpEncryptionConfigurationError();
  }
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== encodedKey) {
    key.fill(0);
    throw new TotpEncryptionConfigurationError();
  }
  return key;
}

/**
 * Derives a domain-separated HMAC key from the existing #267 server key so no
 * second secret is introduced and the TOTP encryption key is never reused
 * directly for a different primitive.
 */
export function createRecoveryCodeVerifier(
  encodedKey: string,
  keyVersion: string
): RecoveryCodeVerifier {
  if (!KEY_VERSION_PATTERN.test(keyVersion)) {
    throw new TotpEncryptionConfigurationError();
  }
  const masterKey = decodeKey(encodedKey);
  let hmacKey: Buffer;
  try {
    hmacKey = Buffer.from(
      hkdfSync('sha256', masterKey, Buffer.alloc(0), HKDF_INFO, KEY_BYTES)
    );
  } finally {
    masterKey.fill(0);
  }

  return {
    keyVersion,
    verifierFor(participantId, code) {
      const normalized = normalizeRecoveryCode(code);
      if (!participantId || !normalized) {
        throw new Error('RECOVERY_CODE_INVALID_FORMAT');
      }
      // Binding the owner prevents a verifier from matching on another account.
      return createHmac('sha256', hmacKey)
        .update(`hackmatch:recovery:v1:${participantId}:${normalized}`, 'utf8')
        .digest('base64url');
    },
  };
}

export function createRecoveryCodeVerifierFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): RecoveryCodeVerifier {
  const encodedKey = env.TOTP_ENCRYPTION_KEY_BASE64?.trim();
  const keyVersion = env.TOTP_ENCRYPTION_KEY_VERSION?.trim() || 'v1';
  if (!encodedKey) throw new TotpEncryptionConfigurationError();
  return createRecoveryCodeVerifier(encodedKey, keyVersion);
}
