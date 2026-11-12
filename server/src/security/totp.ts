import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_SECRET_BYTES = 20;
const TOTP_PERIOD_SECONDS = 30;
const ACCEPTED_STEP_WINDOW = 1;

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(encoded: string): Buffer {
  const normalized = encoded.trim().toUpperCase().replace(/=+$/g, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('Invalid Base32 TOTP secret.');
  }
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  const bytes = randomBytes(TOTP_SECRET_BYTES);
  try {
    return encodeBase32(bytes);
  } finally {
    bytes.fill(0);
  }
}

function codeAtStep(secret: string, step: number): string {
  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  try {
    const digest = createHmac('sha1', key).update(counter).digest();
    try {
      const offset = digest[digest.length - 1]! & 0x0f;
      const binary =
        ((digest[offset]! & 0x7f) << 24) |
        ((digest[offset + 1]! & 0xff) << 16) |
        ((digest[offset + 2]! & 0xff) << 8) |
        (digest[offset + 3]! & 0xff);
      return String(binary % 1_000_000).padStart(6, '0');
    } finally {
      digest.fill(0);
    }
  } finally {
    key.fill(0);
    counter.fill(0);
  }
}

export function verifyTotpCode(secret: string, code: string, now: Date = new Date()): boolean {
  if (!/^\d{6}$/.test(code) || Number.isNaN(now.getTime())) return false;
  const step = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  const submitted = Buffer.from(code, 'utf8');
  try {
    for (let offset = -ACCEPTED_STEP_WINDOW; offset <= ACCEPTED_STEP_WINDOW; offset += 1) {
      const expected = Buffer.from(codeAtStep(secret, step + offset), 'utf8');
      try {
        if (timingSafeEqual(expected, submitted)) return true;
      } finally {
        expected.fill(0);
      }
    }
    return false;
  } finally {
    submitted.fill(0);
  }
}

export function buildTotpAuthUri(secret: string, accountLabel: string): string {
  const issuer = 'HackMatch';
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Test-only deterministic code helper; never used in API responses or logs. */
export function _totpCodeForTest(secret: string, now: Date): string {
  return codeAtStep(secret, Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS));
}
