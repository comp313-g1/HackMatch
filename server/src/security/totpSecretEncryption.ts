import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

export interface ProtectedTotpSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

export interface TotpSecretContext {
  participantId: string;
  enrollmentId: string;
}

export interface TotpSecretProtector {
  encrypt(secret: string, context: TotpSecretContext): ProtectedTotpSecret;
  decrypt(protectedSecret: ProtectedTotpSecret, context: TotpSecretContext): string;
}

export class TotpEncryptionConfigurationError extends Error {
  constructor() {
    super('TOTP encryption is not configured correctly.');
    this.name = 'TotpEncryptionConfigurationError';
  }
}

export class TotpSecretIntegrityError extends Error {
  constructor() {
    super('Protected TOTP material could not be authenticated.');
    this.name = 'TotpSecretIntegrityError';
  }
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

function aad(context: TotpSecretContext, keyVersion: string): Buffer {
  if (!context.participantId || !context.enrollmentId || !KEY_VERSION_PATTERN.test(keyVersion)) {
    throw new TotpEncryptionConfigurationError();
  }
  return Buffer.from(
    `hackmatch:totp:v1:${context.participantId}:${context.enrollmentId}:${keyVersion}`,
    'utf8'
  );
}

export function createTotpSecretProtector(
  encodedKey: string,
  keyVersion: string
): TotpSecretProtector {
  if (!KEY_VERSION_PATTERN.test(keyVersion)) {
    throw new TotpEncryptionConfigurationError();
  }
  const key = decodeKey(encodedKey);

  return {
    encrypt(secret, context) {
      if (typeof secret !== 'string' || secret.length === 0) {
        throw new TotpEncryptionConfigurationError();
      }
      const iv = randomBytes(IV_BYTES);
      const plaintext = Buffer.from(secret, 'utf8');
      try {
        const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
        cipher.setAAD(aad(context, keyVersion));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const authTag = cipher.getAuthTag();
        try {
          return {
            ciphertext: ciphertext.toString('base64'),
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64'),
            keyVersion,
          };
        } finally {
          ciphertext.fill(0);
          authTag.fill(0);
        }
      } finally {
        plaintext.fill(0);
        iv.fill(0);
      }
    },

    decrypt(protectedSecret, context) {
      if (protectedSecret.keyVersion !== keyVersion) {
        throw new TotpEncryptionConfigurationError();
      }

      const iv = Buffer.from(protectedSecret.iv, 'base64');
      const ciphertext = Buffer.from(protectedSecret.ciphertext, 'base64');
      const authTag = Buffer.from(protectedSecret.authTag, 'base64');
      let plaintext: Buffer | null = null;
      try {
        if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES || ciphertext.length === 0) {
          throw new TotpSecretIntegrityError();
        }
        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(aad(context, keyVersion));
        decipher.setAuthTag(authTag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plaintext.toString('utf8');
      } catch (error: unknown) {
        if (error instanceof TotpEncryptionConfigurationError) throw error;
        throw new TotpSecretIntegrityError();
      } finally {
        plaintext?.fill(0);
        iv.fill(0);
        ciphertext.fill(0);
        authTag.fill(0);
      }
    },
  };
}

export function createTotpSecretProtectorFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): TotpSecretProtector {
  const encodedKey = env.TOTP_ENCRYPTION_KEY_BASE64?.trim();
  const keyVersion = env.TOTP_ENCRYPTION_KEY_VERSION?.trim() || 'v1';
  if (!encodedKey) throw new TotpEncryptionConfigurationError();
  return createTotpSecretProtector(encodedKey, keyVersion);
}
