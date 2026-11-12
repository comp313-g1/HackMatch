import { describe, expect, it } from 'vitest';
import {
  _totpCodeForTest,
  buildTotpAuthUri,
  decodeBase32,
  encodeBase32,
  generateTotpSecret,
  verifyTotpCode,
} from './totp.js';

describe('standards-based TOTP helpers (US-029 / #267)', () => {
  it('round-trips Base32 and generates a 160-bit secret', () => {
    const input = Buffer.from('12345678901234567890', 'ascii');
    const encoded = encodeBase32(input);
    expect(encoded).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(decodeBase32(encoded)).toEqual(input);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('matches the RFC 6238 SHA-1 vector using the approved six-digit truncation', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const at59Seconds = new Date(59_000);
    expect(_totpCodeForTest(secret, at59Seconds)).toBe('287082');
    expect(verifyTotpCode(secret, '287082', at59Seconds)).toBe(true);
    expect(verifyTotpCode(secret, '287083', at59Seconds)).toBe(false);
  });

  it('accepts only the adjacent 30-second drift window, not a wide window', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const origin = new Date('2026-11-11T18:00:00.000Z');
    const code = _totpCodeForTest(secret, origin);
    expect(verifyTotpCode(secret, code, new Date(origin.getTime() + 30_000))).toBe(true);
    expect(verifyTotpCode(secret, code, new Date(origin.getTime() + 60_000))).toBe(false);
    expect(verifyTotpCode(secret, '12345x', origin)).toBe(false);
  });

  it('builds an interoperable URI without an email or Firebase identifier', () => {
    const uri = buildTotpAuthUri('JBSWY3DPEHPK3PXP', 'HackMatch account');
    expect(uri).toMatch(/^otpauth:\/\/totp\/HackMatch%3AHackMatch%20account\?/);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=HackMatch');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(uri).not.toMatch(/@|firebase/i);
  });
});
