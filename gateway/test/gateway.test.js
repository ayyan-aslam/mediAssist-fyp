import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, doctor as user, serviceUrl, signToken, startEchoService } from './helpers.js';

// A fake Auth & User Service that sends back what it received.
let upstream;
let app;

beforeAll(async () => {
  upstream = await startEchoService('auth');
  app = buildApp({
    AUTH_SERVICE_URL: serviceUrl(upstream),
    CONSULTATION_SERVICE_URL: serviceUrl(upstream),
    PRESCRIPTION_SERVICE_URL: serviceUrl(upstream),
    AUDIT_SERVICE_URL: serviceUrl(upstream),
  });
});

afterAll(() => {
  upstream.close();
});

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('public routes', () => {
  it('forwards login without a token, removing /api/v1 and keeping the body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ firebaseToken: 'abc' });
    expect(res.status).toBe(200);
    expect(res.body.method).toBe('POST');
    expect(res.body.url).toBe('/auth/login');
    expect(res.body.body).toEqual({ firebaseToken: 'abc' });
  });

  it('forwards GET /specialties without a token', async () => {
    const res = await request(app).get('/api/v1/specialties');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/specialties');
  });
});

describe('profile routes', () => {
  it('forwards GET /users/me with the user headers', async () => {
    const token = await signToken(user);
    const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/users/me');
    expect(res.body.headers['x-user-id']).toBe('16');
    expect(res.body.headers['x-user-role']).toBe('doctor');
  });

  it('forwards PATCH /users/me with the body', async () => {
    const token = await signToken(user);
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ specialtyId: 3 });
    expect(res.status).toBe(200);
    expect(res.body.method).toBe('PATCH');
    expect(res.body.body).toEqual({ specialtyId: 3 });
  });

  it('returns 401 for /users/me without a token', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('token check', () => {
  it('returns 401 when the token is missing', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'x' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'The access token is missing.' } });
  });

  it('returns 401 when the token is signed with another secret', async () => {
    const token = await signToken(user, { secret: 'another-secret-that-is-at-least-32-chars' });
    const res = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when the token has expired', async () => {
    const token = await signToken(user, { expiresIn: '-1s' });
    const res = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('The access token has expired.');
  });

  it('does not treat a public path with another method as public', async () => {
    const res = await request(app).delete('/api/v1/specialties');
    expect(res.status).toBe(401);
  });
});

describe('user headers', () => {
  it('replaces fake x-user-* headers with the ones from the token', async () => {
    const token = await signToken(user);
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('x-user-id', '1')
      .set('x-user-role', 'admin')
      .set('x-user-ip', '1.2.3.4')
      .send({ refreshToken: 'x' });

    expect(res.status).toBe(200);
    const { headers } = res.body;
    expect(headers['x-user-id']).toBe('16');
    expect(headers['x-user-role']).toBe('doctor');
    expect(decodeURIComponent(headers['x-user-name'])).toBe('Dr. Sara Ahmed');
    expect(headers['x-user-email']).toBe('sara@example.com');
    expect(headers['x-user-ip']).not.toBe('1.2.3.4');
  });

  it('removes fake x-user-* headers on public routes too', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('x-user-id', '1').send({});
    expect(res.body.headers['x-user-id']).toBeUndefined();
    expect(res.body.headers['x-user-ip']).toBeDefined();
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404 outside /api/v1', async () => {
    const res = await request(app).get('/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('returns a JSON 404 for an unknown /api/v1 route with a valid token', async () => {
    const token = await signToken(user);
    const res = await request(app).get('/api/v1/nothing-here').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('service down', () => {
  it('returns 503 when the service does not answer', async () => {
    const downApp = buildApp({
      AUTH_SERVICE_URL: 'http://127.0.0.1:1',
      CONSULTATION_SERVICE_URL: 'http://127.0.0.1:1',
      PRESCRIPTION_SERVICE_URL: 'http://127.0.0.1:1',
      AUDIT_SERVICE_URL: 'http://127.0.0.1:1',
    });
    const res = await request(downApp).get('/api/v1/specialties');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('security headers', () => {
  it('adds helmet and CORS headers for the frontend', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});
