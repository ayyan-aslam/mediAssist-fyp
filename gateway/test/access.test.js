import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES } from '../src/routeTable.js';
import { admin, buildApp, doctor, patient, serviceUrl, signToken, startEchoService } from './helpers.js';

let authService;
let consultationService;
let services;

beforeAll(async () => {
  authService = await startEchoService('auth');
  consultationService = await startEchoService('consultation');
  services = {
    AUTH_SERVICE_URL: serviceUrl(authService),
    CONSULTATION_SERVICE_URL: serviceUrl(consultationService),
  };
});

afterAll(() => {
  authService.close();
  consultationService.close();
});

const bearer = async (user) => `Bearer ${await signToken(user)}`;

describe('role check', () => {
  it('returns 403 FORBIDDEN when a patient calls a doctor route', async () => {
    const app = buildApp(services);
    const res = await request(app)
      .post('/api/v1/consultations')
      .set('Authorization', await bearer(patient))
      .send({ clinicalPatientId: 7 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'You are not allowed to do this.' } });
  });

  it('returns 403 FORBIDDEN when an admin edits a profile', async () => {
    const app = buildApp(services);
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', await bearer(admin))
      .send({ fullName: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lets an admin read the own profile', async () => {
    const app = buildApp(services);
    const res = await request(app).get('/api/v1/users/me').set('Authorization', await bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('auth');
  });

  it('still returns 401, not 403, when the token is missing', async () => {
    const app = buildApp(services);
    const res = await request(app).post('/api/v1/consultations').send({ clinicalPatientId: 7 });
    expect(res.status).toBe(401);
  });

  // Every Consultation Service route in the table: a doctor gets through, a patient does not.
  const consultationRoutes = ROUTES.filter((route) => route.service === 'consultation');
  for (const route of consultationRoutes) {
    const path = route.path.replace(/:\w+/g, '41');

    it(`forwards ${route.method} ${route.path} for a doctor to the Consultation Service`, async () => {
      const app = buildApp(services);
      const res = await request(app)
        [route.method.toLowerCase()](`/api/v1${path}`)
        .set('Authorization', await bearer(doctor));
      expect(res.status).toBe(200);
      expect(res.body.service).toBe('consultation');
      expect(res.body.method).toBe(route.method);
      expect(res.body.url).toBe(path);
      expect(res.body.headers['x-user-id']).toBe('16');
    });

    it(`blocks ${route.method} ${route.path} for a patient`, async () => {
      const app = buildApp(services);
      const res = await request(app)
        [route.method.toLowerCase()](`/api/v1${path}`)
        .set('Authorization', await bearer(patient));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  }
});

describe('token in the query string', () => {
  it('accepts ?token= on an SSE route and removes it before forwarding', async () => {
    const app = buildApp(services);
    const token = await signToken(doctor);
    const res = await request(app).get(`/api/v1/consultations/events?token=${token}&x=1`);
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/consultations/events?x=1');
    expect(res.body.headers['x-user-id']).toBe('16');
    expect(res.body.headers['x-user-role']).toBe('doctor');
  });

  it('removes the query string when the token was the only value', async () => {
    const app = buildApp(services);
    const token = await signToken(doctor);
    const res = await request(app).get(`/api/v1/consultations/events?token=${token}`);
    expect(res.body.url).toBe('/consultations/events');
  });

  it('turns off caching, compression and buffering on the SSE response', async () => {
    const app = buildApp(services);
    const token = await signToken(doctor);
    const res = await request(app).get(`/api/v1/consultations/events?token=${token}`).set('Accept-Encoding', 'gzip');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.headers['accept-encoding']).toBeUndefined();
  });

  it('returns 401 on an SSE route without a token', async () => {
    const app = buildApp(services);
    const res = await request(app).get('/api/v1/consultations/events');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on an SSE route with a bad query token', async () => {
    const app = buildApp(services);
    const token = await signToken(doctor, { secret: 'another-secret-that-is-at-least-32-chars' });
    const res = await request(app).get(`/api/v1/consultations/events?token=${token}`);
    expect(res.status).toBe(401);
  });

  it('checks the role of a query token too', async () => {
    const app = buildApp(services);
    const token = await signToken(patient);
    const res = await request(app).get(`/api/v1/consultations/events?token=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ignores ?token= on routes that are not SSE', async () => {
    const app = buildApp(services);
    const token = await signToken(doctor);
    const res = await request(app).get(`/api/v1/consultations/41?token=${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('The access token is missing.');
  });
});

describe('rate limit', () => {
  it('limits logged-in routes per user and returns 429 in the shared error format', async () => {
    const app = buildApp({ ...services, RATE_LIMIT_USER_MAX: 3 });
    const sara = await bearer(doctor);

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get('/api/v1/consultations/41').set('Authorization', sara);
      expect(res.status).toBe(200);
    }
    const res = await request(app).get('/api/v1/consultations/41').set('Authorization', sara);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please wait a minute and try again.' },
    });
    expect(res.headers.ratelimit).toBeDefined();
  });

  it('counts each user on their own, even from the same IP', async () => {
    const app = buildApp({ ...services, RATE_LIMIT_USER_MAX: 1 });
    const first = await request(app).get('/api/v1/consultations/41').set('Authorization', await bearer(doctor));
    const other = await bearer({ ...doctor, userId: 99 });
    const second = await request(app).get('/api/v1/consultations/41').set('Authorization', other);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('limits public routes per IP', async () => {
    const app = buildApp({ ...services, RATE_LIMIT_PUBLIC_MAX: 2 });
    await request(app).get('/api/v1/specialties').expect(200);
    await request(app).post('/api/v1/auth/login').send({}).expect(200);
    const res = await request(app).get('/api/v1/specialties');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('allows one audio part every 10 seconds plus normal use with the default limit', async () => {
    // 6 audio parts, 2 SOAP saves and some page loads in one minute stay far below 120.
    const app = buildApp({ ...services, RATE_LIMIT_USER_MAX: 120 });
    const sara = await bearer(doctor);
    for (let i = 0; i < 20; i += 1) {
      await request(app).post('/api/v1/consultations/41/audio-parts').set('Authorization', sara).expect(200);
    }
  });
});

describe('client IP', () => {
  it('passes the client IP to the Consultation Service', async () => {
    const app = buildApp(services);
    const res = await request(app).get('/api/v1/consultations/41').set('Authorization', await bearer(doctor));
    expect(res.body.headers['x-user-ip']).toMatch(/127\.0\.0\.1|::1/);
  });

  it('uses X-Forwarded-For only when a proxy in front is trusted', async () => {
    const trusting = buildApp({ ...services, TRUST_PROXY_HOPS: 1 });
    const res = await request(trusting)
      .get('/api/v1/consultations/41')
      .set('Authorization', await bearer(doctor))
      .set('X-Forwarded-For', '203.0.113.5');
    expect(res.body.headers['x-user-ip']).toBe('203.0.113.5');
  });
});
