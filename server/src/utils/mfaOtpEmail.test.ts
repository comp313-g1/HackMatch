import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMfaOtpEmail, sendMfaOtpEmail } from './mfaOtpEmail.js';
import { config } from '../config/index.js';

const sendMail = vi.fn();
const createTestAccount = vi.fn();
const getTestMessageUrl = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail })),
    createTestAccount: (...args: unknown[]) => createTestAccount(...args),
    getTestMessageUrl: (...args: unknown[]) => getTestMessageUrl(...args),
  },
}));

describe('mfaOtpEmail (US-004 / FR-009 / NR-021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'test-id' });
    createTestAccount.mockResolvedValue({
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
      user: 'ethereal-user',
      pass: 'ethereal-pass',
    });
    getTestMessageUrl.mockReturnValue('https://ethereal.email/message/preview-1');
  });

  describe('buildMfaOtpEmail()', () => {
    it('includes the 6-digit OTP in text and html bodies', () => {
      const message = buildMfaOtpEmail('jane@example.com', '847291');
      expect(message.to).toBe('jane@example.com');
      expect(message.subject).toMatch(/verification code/i);
      expect(message.text).toContain('847291');
      expect(message.html).toContain('847291');
      expect(message.text).toMatch(/10 minutes/i);
    });

    it('trims OTP whitespace before embedding', () => {
      const message = buildMfaOtpEmail('jane@example.com', '  123456  ');
      expect(message.text).toContain('123456');
      expect(message.text).not.toContain('  123456  ');
    });
  });

  describe('sendMfaOtpEmail()', () => {
    it('rejects missing recipient', async () => {
      await expect(sendMfaOtpEmail('', '123456')).rejects.toThrow(/recipient email/i);
    });

    it('rejects non-6-digit OTP codes (boundary)', async () => {
      await expect(sendMfaOtpEmail('jane@example.com', '12345')).rejects.toThrow(/6-digit/i);
      await expect(sendMfaOtpEmail('jane@example.com', '1234567')).rejects.toThrow(/6-digit/i);
      await expect(sendMfaOtpEmail('jane@example.com', 'abcdef')).rejects.toThrow(/6-digit/i);
    });

    it('uses Ethereal preview path when SMTP is not configured in non-production', async () => {
      const previousHost = config.smtp.host;
      const previousFrom = config.smtp.from;
      config.smtp.host = undefined;
      config.smtp.from = undefined;

      await expect(sendMfaOtpEmail('jane@example.com', '111222')).resolves.toBeUndefined();
      expect(createTestAccount).toHaveBeenCalled();
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          text: expect.stringContaining('111222'),
        })
      );
      expect(getTestMessageUrl).toHaveBeenCalled();

      config.smtp.host = previousHost;
      config.smtp.from = previousFrom;
    });

    it('dispatches via SMTP when host and from are configured', async () => {
      const previousHost = config.smtp.host;
      const previousFrom = config.smtp.from;
      const previousUser = config.smtp.user;
      const previousPass = config.smtp.pass;
      config.smtp.host = 'smtp.example.com';
      config.smtp.from = 'HackMatch <noreply@example.com>';
      config.smtp.user = 'user';
      config.smtp.pass = 'pass';

      await sendMfaOtpEmail('Jane@Example.com', '654321');

      expect(createTestAccount).not.toHaveBeenCalled();
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          subject: expect.stringMatching(/verification code/i),
          text: expect.stringContaining('654321'),
          html: expect.stringContaining('654321'),
        })
      );

      config.smtp.host = previousHost;
      config.smtp.from = previousFrom;
      config.smtp.user = previousUser;
      config.smtp.pass = previousPass;
    });

    it('fails closed in production when SMTP is not configured', async () => {
      const previousEnv = config.nodeEnv;
      const previousHost = config.smtp.host;
      const previousFrom = config.smtp.from;
      config.nodeEnv = 'production';
      config.smtp.host = undefined;
      config.smtp.from = undefined;

      await expect(sendMfaOtpEmail('jane@example.com', '999888')).rejects.toThrow(/SMTP is not configured/i);
      expect(createTestAccount).not.toHaveBeenCalled();

      config.nodeEnv = previousEnv;
      config.smtp.host = previousHost;
      config.smtp.from = previousFrom;
    });
  });
});
