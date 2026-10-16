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

function smtpConfigured(): boolean {
  return Boolean(config.smtp.host && config.smtp.from);
}

/**
 * Delivers an MFA OTP email.
 * - SMTP when `SMTP_HOST` + `SMTP_FROM` are set
 * - Ethereal preview URL in development/test without SMTP (OTP not logged)
 * - Fails closed in production without SMTP (FR-084)
 */
export async function sendMfaOtpEmail(email: string, otp: string): Promise<void> {
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw new Error('Recipient email is required');
  }
  if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
    throw new Error('A 6-digit OTP is required to compose the email');
  }

  const message = buildMfaOtpEmail(email.trim().toLowerCase(), otp);

  if (smtpConfigured()) {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
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
    throw new Error('SMTP is not configured; cannot dispatch MFA OTP email');
  }

  // Development / test without SMTP: Ethereal captures the message so the OTP
  // is visible via preview URL only (never printed in server logs — NR-021).
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
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
