import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireCsrf, requireCsrfIfCookieSession } from './requireCsrf.js';
import { securityConfig } from '../config/security.js';

function buildApp(middleware: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  // Minimal cookie parser stand-in for unit tests
  app.use((req, _res, next) => {
    const header = req.headers.cookie ?? '';
    req.cookies = Object.fromEntries(
      header
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const eq = part.indexOf('=');
          return eq === -1 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)];
        })
    );
    next();
  });
  app.use(middleware);
  app.post('/action', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.get('/action', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

const CSRF = 'd'.repeat(43);
const sessionName = securityConfig.sessionCookie.name;
const csrfName = securityConfig.sessionCookie.csrfName;

describe('requireCsrf', () => {
  const app = buildApp(requireCsrf);

  it('allows safe methods without a CSRF token', async () => {
    const response = await request(app).get('/action');
    expect(response.status).toBe(200);
  });

  it('allows POST when the cookie and header match', async () => {
    const response = await request(app)
      .post('/action')
      .set('Cookie', `${csrfName}=${CSRF}`)
      .set('X-CSRF-Token', CSRF)
      .set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(200);
  });

  it('rejects POST with a mismatched CSRF token', async () => {
    const response = await request(app)
      .post('/action')
      .set('Cookie', `${csrfName}=${CSRF}`)
      .set('X-CSRF-Token', 'wrong')
      .set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects POST from a foreign origin', async () => {
    const response = await request(app)
      .post('/action')
      .set('Cookie', `${csrfName}=${CSRF}`)
      .set('X-CSRF-Token', CSRF)
      .set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('requireCsrfIfCookieSession', () => {
  const app = buildApp(requireCsrfIfCookieSession);

  it('skips CSRF when there is no session cookie (Bearer-only logout)', async () => {
    const response = await request(app).post('/action');
    expect(response.status).toBe(200);
  });

  it('enforces CSRF when a session cookie is present', async () => {
    const response = await request(app)
      .post('/action')
      .set('Cookie', `${sessionName}=session-value; ${csrfName}=${CSRF}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('allows session-cookie POST when CSRF matches', async () => {
    const response = await request(app)
      .post('/action')
      .set('Cookie', `${sessionName}=session-value; ${csrfName}=${CSRF}`)
      .set('X-CSRF-Token', CSRF)
      .set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(200);
  });
});
