/**
 * MFA OTP email dispatch (FR-009 / FR-084 / US-004 AC 1 / NR-021).
 *
 * Builds a message that includes the 6-digit code, then delivers it via SMTP when
 * configured. The plaintext OTP is never written to application logs.
 *
 * Development without SMTP uses Nodemailer Ethereal and logs a preview URL so
 * engineers can open the message (including the OTP) without logging the code.
 */

import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

export interface MfaOtpMailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MfaOtpEmailSender = (email: string, otp: string) => Promise<void>;

/** Seconds mirrored in copy so users know the FR-009 lifetime. */
const OTP_LIFETIME_MINUTES = 10;

export const SMTP_DNS_TIMEOUT_MS = 5_000;
export const SMTP_CONNECTION_TIMEOUT_MS = 8_000;
export const SMTP_GREETING_TIMEOUT_MS = 8_000;
export const SMTP_SOCKET_TIMEOUT_MS = 10_000;
export const BREVO_API_TIMEOUT_MS = 10_000;
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

const EMAIL_ADDRESS_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/**
 * Parses an RFC 5322-style `SMTP_FROM` value (`Name <email>` or `email`),
 * stripping accidental surrounding quotes from dashboard env UIs.
 */
export function parseSenderAddress(rawFrom: string): { name?: string; email: string } {
  let cleaned = rawFrom.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  let name: string | undefined;
  let email: string;

  const angleMatch = /^(.*?)\s*<([^<>]+)>\s*$/.exec(cleaned);
  if (angleMatch) {
    const rawName = (angleMatch[1] ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
    name = rawName.length > 0 ? rawName : undefined;
    email = (angleMatch[2] ?? '').trim();
  } else {
    email = cleaned.replace(/^["']+|["']+$/g, '').trim();
  }

  if (!EMAIL_ADDRESS_PATTERN.test(email)) {
    throw new Error('Invalid sender email address in SMTP_FROM');
  }

  return name ? { name, email } : { email };
}

function sanitizeDispatchErrorDetail(raw: string, apiKey: string, otp: string): string {
  let cleaned = raw;
  if (apiKey) {
    cleaned = cleaned.split(apiKey).join('[REDACTED]');
  }
  if (otp) {
    cleaned = cleaned.split(otp).join('[REDACTED]');
  }
  cleaned = cleaned
    .replace(/xkeysib-[a-zA-Z0-9._-]+/gi, '[REDACTED]')
    .replace(/\d{6}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 160);
}

/**
 * Builds the MFA OTP email body. The OTP appears only in the message payload —
 * callers must not log `text` / `html`.
 */
export function buildMfaOtpEmail(email: string, otp: string): MfaOtpMailMessage {
  const trimmedOtp = otp.trim();
  const subject = 'Your HackMatch login verification code';
  const text = [
    'Your HackMatch login verification code is:',
    '',
    trimmedOtp,
    '',
    `This code expires in ${OTP_LIFETIME_MINUTES} minutes.`,
    'If you did not try to sign in, you can ignore this email.',
  ].join('\n');

  const html = [
    '<p>Your HackMatch login verification code is:</p>',
    `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${trimmedOtp}</p>`,
    `<p>This code expires in ${OTP_LIFETIME_MINUTES} minutes.</p>`,
    '<p>If you did not try to sign in, you can ignore this email.</p>',
  ].join('');

  return { to: email, subject, text, html };
}

function brevoConfigured(): boolean {
  return Boolean(config.smtp.brevoApiKey?.trim() && config.smtp.from?.trim());
}

function smtpConfigured(): boolean {
  return Boolean(config.smtp.host?.trim() && config.smtp.from?.trim());
}

/**
 * Delivers an MFA OTP email.
 * - Brevo HTTPS API (`443`) when `BREVO_API_KEY` + `SMTP_FROM` are set
 * - SMTP when `SMTP_HOST` + `SMTP_FROM` are set
 * - Ethereal preview URL in development/test without SMTP (OTP not logged)
 * - Fails closed in production without either transport (FR-084)
 */
export async function sendMfaOtpEmail(email: string, otp: string): Promise<void> {
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw new Error('Recipient email is required');
  }
  if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
    throw new Error('A 6-digit OTP is required to compose the email');
  }

  const trimmedOtp = otp.trim();
  const message = buildMfaOtpEmail(email.trim().toLowerCase(), trimmedOtp);

  if (brevoConfigured()) {
    const apiKey = config.smtp.brevoApiKey!.trim();
    const sender = parseSenderAddress(config.smtp.from!);
    if (sender.email.toLowerCase().endsWith('.local')) {
      throw new Error(
        'SMTP_FROM must be a verified sender email address (not a .local placeholder) when BREVO_API_KEY is set'
      );
    }

    const res = await fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
      }),
      signal: AbortSignal.timeout(BREVO_API_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const rawParts: string[] = [];
      if (typeof errBody.code === 'string' && errBody.code.trim()) {
        rawParts.push(errBody.code.trim());
      }
      if (typeof errBody.message === 'string' && errBody.message.trim()) {
        rawParts.push(errBody.message.trim());
      }
      const detail = sanitizeDispatchErrorDetail(rawParts.join(': '), apiKey, trimmedOtp);
      throw new Error(
        `Brevo email dispatch failed (HTTP ${res.status}${detail ? `: ${detail}` : ''})`
      );
    }

    if (config.nodeEnv === 'development') {
      console.info(`[AUTH] MFA OTP email dispatched to ${message.to}`);
    }
    return;
  }

  if (smtpConfigured()) {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      dnsTimeout: SMTP_DNS_TIMEOUT_MS,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      auth:
        config.smtp.user && config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
    });

    await transporter.sendMail({
      from: config.smtp.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (config.nodeEnv === 'development') {
      console.info(`[AUTH] MFA OTP email dispatched to ${message.to}`);
    }
    return;
  }

  if (config.nodeEnv === 'production') {
    throw new Error(
      'SMTP is not configured (set BREVO_API_KEY or SMTP_HOST with SMTP_FROM); cannot dispatch MFA OTP email'
    );
  }

  // Development / test without SMTP: Ethereal captures the message so the OTP
  // is visible via preview URL only (never printed in server logs — NR-021).
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    dnsTimeout: SMTP_DNS_TIMEOUT_MS,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  const info = await transporter.sendMail({
    from: config.smtp.from || 'HackMatch <noreply@hackmatch.local>',
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  console.info(`[AUTH] MFA OTP email dispatched to ${message.to}`);
  if (previewUrl) {
    console.info(`[AUTH] MFA OTP email preview (open to read the code): ${previewUrl}`);
  }
}

export const defaultMfaOtpEmailSender: MfaOtpEmailSender = sendMfaOtpEmail;
