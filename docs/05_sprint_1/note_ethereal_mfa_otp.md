# Quick note: Why Ethereal for MFA OTP emails?

**Context:** US-004 email login 2FA (`POST /api/auth/mfa/challenge`).

## Why Ethereal?

In **local development**, if `SMTP_HOST` / `SMTP_FROM` are not set in `server/.env`, the server does **not** send OTP mail to a real inbox (Gmail, etc.).

Instead it uses **Nodemailer Ethereal** — a temporary test mailbox — and prints a **preview URL** in the server console:

```text
[AUTH] MFA OTP email preview (open to read the code): https://ethereal.email/message/...
```

Open that link to read the 6-digit code. The OTP is **never** logged in plain text (NR-021).

## Why this design?

- No Gmail/SMTP credentials needed for everyday local testing
- Safe: codes are not printed to logs or committed
- Production still **requires** real SMTP (`SMTP_*`); without it, OTP send fails closed (FR-084)

## When you want real Gmail

Configure `SMTP_*` in `server/.env` (e.g. `smtp.gmail.com` + App Password), restart the server, then OTPs go to the user’s real email and Ethereal is skipped.
