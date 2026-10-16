import crypto from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { securityConfig } from '../config/security.js';

function baseOptions(httpOnly: boolean, path: string): CookieOptions {
  return {
    httpOnly,
    secure: securityConfig.sessionCookie.secure,
    sameSite: 'strict',
    path,
  };
}

export function sessionCookieOptions(): CookieOptions {
  return { ...baseOptions(true, '/api'), maxAge: securityConfig.sessionCookie.maxAgeSeconds * 1000 };
}

/** Readable by the client's JavaScript so it can echo the value in the X-CSRF-Token header. */
export function csrfCookieOptions(): CookieOptions {
  return { ...baseOptions(false, '/'), maxAge: securityConfig.sessionCookie.maxAgeSeconds * 1000 };
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(securityConfig.sessionCookie.name, baseOptions(true, '/api'));
  res.clearCookie(securityConfig.sessionCookie.csrfName, baseOptions(false, '/'));
}

export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
