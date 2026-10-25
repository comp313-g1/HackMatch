# MFA OTP email: Ethereal (dev fallback) vs Gmail SMTP (#352)

**Context:** US-004 email login 2FA (`POST /api/auth/mfa/challenge`).

## Default in local development (Ethereal)

If `SMTP_HOST` / `SMTP_FROM` are **not** set in `server/.env`, the server does **not** send OTP mail to a real inbox.

It uses **Nodemailer Ethereal** and prints a **preview URL** in the server console:

```text
[AUTH] MFA OTP email preview (open to read the code): https://ethereal.email/message/...
```

Open that link to read the 6-digit code. The OTP is **never** logged in plain text (NR-021).

## Real Gmail delivery (App Password)

Copy `server/.env.example` → `server/.env` and fill `SMTP_*` as documented there.

| Variable | Example | Notes |
|----------|---------|--------|
| `SMTP_HOST` | `smtp.gmail.com` | Server name — **not** your email address |
| `SMTP_PORT` | `587` | STARTTLS |
| `SMTP_SECURE` | `false` | Use `false` with port 587 |
| `SMTP_USER` | `yourname@gmail.com` | Full Gmail that owns the App Password |
| `SMTP_PASS` | *(16 letters from Google)* | **App Password only** — not your normal Gmail password, not Authenticator codes |
| `SMTP_FROM` | `HackMatch <yourname@gmail.com>` | Must use the same address as `SMTP_USER` |

### How to get a Gmail App Password

1. Sign in as the sending Gmail (personal or shared team inbox).
2. [Google Account → Security](https://myaccount.google.com/security) → turn **2-Step Verification** ON.
3. Open [App passwords](https://myaccount.google.com/apppasswords) → Create → name e.g. `HackMatch`.
4. Copy the **16-letter** password Google shows (you only see it once).
5. Paste into `SMTP_PASS`, save `.env`, **restart** `npm run dev`.

**Do not invent** `SMTP_PASS` or add numbers for “strength.” Google generates the App Password; you only copy it.

### Sharing with teammates

- Prefer each person using their own Gmail + App Password in local `.env`.
- Or share one team inbox App Password via a private channel — **never** commit `.env` or paste passwords in GitHub/Discord.

Production still **requires** real SMTP; without it, OTP send fails closed (FR-084).
