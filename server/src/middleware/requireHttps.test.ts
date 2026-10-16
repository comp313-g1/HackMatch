import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequireHttps } from './requireHttps.js';

function buildApp(enforce: boolean) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createRequireHttps(enforce));
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  app.post('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('createRequireHttps', () => {
  it('rejects plain HTTP with 403 HTTPS_REQUIRED when enforced', async () => {
    const response = await request(buildApp(true)).get('/ping');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'HTTPS is required. Please use a secure connection.',
      code: 'HTTPS_REQUIRED',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects POST over HTTP too, so tokens are never accepted in clear text', async () => {
    const response = await request(buildApp(true))
      .post('/ping')
      .set('Authorization', 'Bearer some.id.token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('HTTPS_REQUIRED');
  });

  it('allows requests forwarded as HTTPS by a trusted proxy', async () => {
    const response = await request(buildApp(true)).get('/ping').set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(200);
  });

  it('rejects requests the proxy forwarded as HTTP', async () => {
    const response = await request(buildApp(true)).get('/ping').set('X-Forwarded-Proto', 'http');

    expect(response.status).toBe(403);
  });

  it('allows HTTP when enforcement is off (local development)', async () => {
    const response = await request(buildApp(false)).get('/ping');

    expect(response.status).toBe(200);
  });
});
