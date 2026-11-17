import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BREVO_API_TIMEOUT_MS,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_DNS_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
  buildMfaOtpEmail,
  parseSenderAddress,
  sendMfaOtpEmail,
} from './mfaOtpEmail.js';
import { config } from '../config/index.js';

const sendMail = vi.fn();
const createTransport = vi.fn((..._args: unknown[]) => ({ sendMail }));
const createTestAccount = vi.fn();
const getTestMessageUrl = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (...args: unknown[]) => createTransport(...args),
    createTestAccount: (...args: unknown[]) => createTestAccount(...args),
    getTestMessageUrl: (...args: unknown[]) => getTestMessageUrl(...args),
  },
}));

describe('mfaOtpEmail (US-004 / FR-009 / NR-021)', () => {
  let savedNodeEnv: string;
  let savedSmtp: typeof config.smtp;

  beforeEach(() => {
    vi.clearAllMocks();
    savedNodeEnv = config.nodeEnv;
    savedSmtp = { ...config.smtp };
    config.smtp.brevoApiKey = undefined;
    sendMail.mockResolvedValue({ messageId: 'test-id' });
    createTestAccount.mockResolvedValue({
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
      user: 'ethereal-user',
      pass: 'ethereal-pass',
    });
    getTestMessageUrl.mockReturnValue('https://ethereal.email/message/preview-1');
  });

  afterEach(() => {
    config.nodeEnv = savedNodeEnv;
    Object.assign(config.smtp, savedSmtp);
    vi.unstubAllGlobals();
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

    it('passes explicit DNS, connection, greeting, and socket timeouts to Nodemailer SMTP transport', async () => {
      config.smtp.host = 'smtp.example.com';
      config.smtp.from = 'HackMatch <noreply@example.com>';

      await sendMfaOtpEmail('jane@example.com', '654321');

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          dnsTimeout: SMTP_DNS_TIMEOUT_MS,
          connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
          greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
          socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
        })
      );
    });

    it('dispatches via Brevo HTTPS API and takes precedence over SMTP_HOST when BREVO_API_KEY is set', async () => {
      config.smtp.brevoApiKey = 'xkeysib-test-key-123';
      config.smtp.from = 'HackMatch <sender@gmail.com>';
      config.smtp.host = 'smtp.gmail.com';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: '<msg-1>' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await sendMfaOtpEmail('Jane@Example.com', '654321');

      expect(sendMail).not.toHaveBeenCalled();
      expect(createTestAccount).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': 'xkeysib-test-key-123',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(BREVO_API_TIMEOUT_MS).toBe(10_000);
      expect(JSON.parse(String(init.body))).toEqual({
        sender: { name: 'HackMatch', email: 'sender@gmail.com' },
        to: [{ email: 'jane@example.com' }],
        subject: 'Your HackMatch login verification code',
        textContent: expect.stringContaining('654321'),
        htmlContent: expect.stringContaining('654321'),
      });
    });

    it('rejects .local placeholder sender addresses when BREVO_API_KEY is set', async () => {
      config.smtp.brevoApiKey = 'xkeysib-test-key-123';
      config.smtp.from = 'HackMatch <noreply@hackmatch.local>';

      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(sendMfaOtpEmail('jane@example.com', '654321')).rejects.toThrow(
        /verified sender email address/i
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('scrubs API keys and 6-digit OTPs from non-2xx Brevo error messages', async () => {
      config.smtp.brevoApiKey = 'xkeysib-secret-token-999';
      config.smtp.from = 'sender@gmail.com';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          code: 'unauthorized',
          message: 'Key xkeysib-secret-token-999 rejected for code=654321',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      let caught: Error | undefined;
      try {
        await sendMfaOtpEmail('jane@example.com', '654321');
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught?.message).toContain('HTTP 401');
      expect(caught?.message).not.toContain('xkeysib-secret-token-999');
      expect(caught?.message).not.toContain('654321');
    });
  });

  describe('parseSenderAddress()', () => {
    it('parses display name, unquotes Render-style outer quotes, and omits empty names', () => {
      expect(parseSenderAddress('HackMatch <user@gmail.com>')).toEqual({
        name: 'HackMatch',
        email: 'user@gmail.com',
      });
      expect(parseSenderAddress('"HackMatch" <user@gmail.com>')).toEqual({
        name: 'HackMatch',
        email: 'user@gmail.com',
      });
      expect(parseSenderAddress('"HackMatch <user@gmail.com>"')).toEqual({
        name: 'HackMatch',
        email: 'user@gmail.com',
      });
      expect(parseSenderAddress('<user@gmail.com>')).toEqual({
        email: 'user@gmail.com',
      });
      expect(parseSenderAddress('"user@gmail.com"')).toEqual({
        email: 'user@gmail.com',
      });
    });

    it('rejects malformed sender addresses', () => {
      expect(() => parseSenderAddress('')).toThrow(/Invalid sender email address/i);
      expect(() => parseSenderAddress('HackMatch <not-an-email>')).toThrow(
        /Invalid sender email address/i
      );
      expect(() => parseSenderAddress('bad"quote@gmail.com')).toThrow(
        /Invalid sender email address/i
      );
    });
  });
});
