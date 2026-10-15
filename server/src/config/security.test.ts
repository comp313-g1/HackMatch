import { describe, it, expect } from 'vitest';
import {
  loadSecurityConfig,
  parseSessionMaxAge,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  MIN_SESSION_MAX_AGE_SECONDS,
  MAX_SESSION_MAX_AGE_SECONDS,
} from './security.js';

describe('parseSessionMaxAge', () => {
  it('defaults to a fixed 7-day lifetime', () => {
    expect(parseSessionMaxAge(undefined)).toBe(7 * 24 * 60 * 60);
    expect(parseSessionMaxAge('')).toBe(DEFAULT_SESSION_MAX_AGE_SECONDS);
  });

  it.each([
    [String(MIN_SESSION_MAX_AGE_SECONDS), MIN_SESSION_MAX_AGE_SECONDS],
    [String(MAX_SESSION_MAX_AGE_SECONDS), MAX_SESSION_MAX_AGE_SECONDS],
    ['3600', 3600],
    [' 3600 ', 3600],
  ])('accepts %j', (raw, expected) => {
    expect(parseSessionMaxAge(raw)).toBe(expected);
  });

  it.each([
    String(MIN_SESSION_MAX_AGE_SECONDS - 1),
    String(MAX_SESSION_MAX_AGE_SECONDS + 1),
    '0',
  ])('rejects out-of-range %j', (raw) => {
    expect(() => parseSessionMaxAge(raw)).toThrow(/between 300 and 1209600/);
  });

  it.each(['-1', '1.5', '7d', 'abc'])('rejects non-integer %j', (raw) => {
    expect(() => parseSessionMaxAge(raw)).toThrow(/whole number/);
  });
});

describe('loadSecurityConfig', () => {
  it('uses relaxed local settings in development', () => {
    const cfg = loadSecurityConfig({ NODE_ENV: 'development' });
    expect(cfg.enforceHttps).toBe(false);
    expect(cfg.sessionCookie.secure).toBe(false);
    expect(cfg.trustProxy).toBe(false);
    expect(cfg.sessionCookie.maxAgeSeconds).toBe(DEFAULT_SESSION_MAX_AGE_SECONDS);
    expect(cfg.recentSignInSeconds).toBe(600);
  });

  it('defaults to HTTPS and Secure cookies in production', () => {
    const cfg = loadSecurityConfig({ NODE_ENV: 'production' });
    expect(cfg.enforceHttps).toBe(true);
    expect(cfg.sessionCookie.secure).toBe(true);
  });

  it('keeps Secure cookies on in the test environment', () => {
    expect(loadSecurityConfig({ NODE_ENV: 'test' }).sessionCookie.secure).toBe(true);
  });

  it('refuses to disable HTTPS or Secure cookies in production', () => {
    expect(() => loadSecurityConfig({ NODE_ENV: 'production', ENFORCE_HTTPS: 'false' })).toThrow(
      /ENFORCE_HTTPS cannot be false in production/
    );
    expect(() => loadSecurityConfig({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE cannot be false in production/
    );
  });

  it('lets development opt in to HTTPS and Secure cookies', () => {
    const cfg = loadSecurityConfig({ NODE_ENV: 'development', ENFORCE_HTTPS: 'true', COOKIE_SECURE: '1' });
    expect(cfg.enforceHttps).toBe(true);
    expect(cfg.sessionCookie.secure).toBe(true);
  });

  it.each([
    [undefined, false],
    ['0', false],
    ['false', false],
    ['1', 1],
    ['2', 2],
  ])('parses TRUST_PROXY %j as %j', (raw, expected) => {
    expect(loadSecurityConfig({ NODE_ENV: 'development', TRUST_PROXY: raw }).trustProxy).toBe(expected);
  });

  it('rejects invalid boolean and proxy values', () => {
    expect(() => loadSecurityConfig({ ENFORCE_HTTPS: 'yes' })).toThrow(/ENFORCE_HTTPS must be/);
    expect(() => loadSecurityConfig({ TRUST_PROXY: 'loopback' })).toThrow(/TRUST_PROXY must be/);
  });
});
