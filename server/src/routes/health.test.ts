import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('GET /api/health', () => {
  it('responds with 200 OK and valid health payload per NR-022', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
    expect(new Date(response.body.timestamp).toString()).not.toBe('Invalid Date');

    // Invariant: Liveness probe exposes no internal topology, version numbers, or credentials
    expect(response.body).not.toHaveProperty('database');
    expect(response.body).not.toHaveProperty('version');
    expect(response.body).not.toHaveProperty('secrets');

    // Invariant: Request-ID is propagated in headers
    expect(response.headers['x-request-id']).toBeDefined();
  });
});
