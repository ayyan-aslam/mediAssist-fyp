import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';

describe('GET /health', () => {
  it('returns status ok', async () => {
    const { app } = createTestContext();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const { app } = createTestContext();
    const res = await request(app).get('/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
