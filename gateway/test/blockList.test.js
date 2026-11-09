import { createLogger } from '@mediassist/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BLOCK_MS, BlockListStore } from '../src/BlockListStore.js';
import { GatewayEventConsumer } from '../src/GatewayEventConsumer.js';
import { admin, buildApp, doctor, patient, serviceUrl, signToken, startEchoService } from './helpers.js';

const SUSPENDED = {
  error: { code: 'ACCOUNT_SUSPENDED', message: 'Your account has been suspended. Please contact the administrator.' },
};

// user.suspended or user.activated (design doc 6.4.10 and 6.4.11).
function statusMessage(type, userId, changedAt) {
  return {
    messageId: crypto.randomUUID(),
    type,
    version: 1,
    source: 'auth-service',
    createdAt: changedAt,
    data: { userId, changedAt },
  };
}

// A store with a clock the test moves.
function createStore(start = Date.parse('2026-10-07T12:00:00Z')) {
  let clock = start;
  const store = new BlockListStore({ now: () => clock });
  return { store, tick: (ms) => (clock += ms) };
}

function createConsumer(store) {
  const eventConsumer = { consume: vi.fn() };
  const consumer = new GatewayEventConsumer({ eventConsumer, blockListStore: store, logger: createLogger('test', 'silent') });
  return { consumer, eventConsumer };
}

describe('BlockListStore', () => {
  it('blocks a user for 15 minutes, the access token lifetime', () => {
    const { store, tick } = createStore();
    expect(BLOCK_MS).toBe(15 * 60 * 1000);
    expect(store.isBlocked(15)).toBe(false);
    store.add(15, Date.parse('2026-10-07T12:00:00Z'));
    expect(store.isBlocked(15)).toBe(true);
    expect(store.isBlocked(16)).toBe(false);
    tick(BLOCK_MS - 1);
    expect(store.isBlocked(15)).toBe(true);
    tick(1);
    expect(store.isBlocked(15)).toBe(false);
  });

  it('removes the block on activation', () => {
    const { store } = createStore();
    store.add(15, 1000);
    expect(store.remove(15, 2000)).toBe(true);
    expect(store.isBlocked(15)).toBe(false);
  });

  it('ignores a change older than the last one for that user', () => {
    const { store } = createStore();
    store.add(15, 1000);
    store.remove(15, 3000);
    // A suspension from before the activation arrives late.
    expect(store.add(15, 2000)).toBe(false);
    expect(store.isBlocked(15)).toBe(false);

    store.add(16, 5000);
    expect(store.remove(16, 4000)).toBe(false);
    expect(store.isBlocked(16)).toBe(true);
  });

  it('gives the same result when the same change is handled twice', () => {
    const { store } = createStore();
    expect(store.add(15, 1000)).toBe(true);
    expect(store.add(15, 1000)).toBe(true);
    expect(store.isBlocked(15)).toBe(true);
    expect(store.remove(15, 2000)).toBe(true);
    expect(store.remove(15, 2000)).toBe(true);
    expect(store.isBlocked(15)).toBe(false);
  });

  it('treats a user ID from the token as a number', () => {
    const { store } = createStore();
    store.add(15, 1000);
    expect(store.isBlocked('15')).toBe(true);
  });
});

describe('GatewayEventConsumer', () => {
  it('reads the gateway.user.status queue', () => {
    const { consumer, eventConsumer } = createConsumer(new BlockListStore());
    consumer.start();
    expect(eventConsumer.consume).toHaveBeenCalledWith('gateway.user.status', consumer.handle);
  });

  it('adds the user on user.suspended and removes them on user.activated', async () => {
    const { store } = createStore();
    const { consumer } = createConsumer(store);
    await consumer.handle(statusMessage('user.suspended', 15, '2026-10-07T12:00:00Z'));
    expect(store.isBlocked(15)).toBe(true);
    await consumer.handle(statusMessage('user.activated', 15, '2026-10-07T12:30:00Z'));
    expect(store.isBlocked(15)).toBe(false);
  });

  it('ignores a user.suspended that is older than the last activation', async () => {
    const { store } = createStore();
    const { consumer } = createConsumer(store);
    await consumer.handle(statusMessage('user.activated', 15, '2026-10-07T12:30:00Z'));
    await consumer.handle(statusMessage('user.suspended', 15, '2026-10-07T12:00:00Z'));
    expect(store.isBlocked(15)).toBe(false);
  });

  it('compares times with an offset correctly', async () => {
    const { store } = createStore();
    const { consumer } = createConsumer(store);
    await consumer.handle(statusMessage('user.suspended', 15, '2026-10-07T17:00:00+05:00'));
    // 12:30 UTC is after 17:00 in Pakistan (12:00 UTC).
    await consumer.handle(statusMessage('user.activated', 15, '2026-10-07T12:30:00Z'));
    expect(store.isBlocked(15)).toBe(false);
  });

  it.each([
    ['an unknown type', statusMessage('user.deleted', 15, '2026-10-07T12:00:00Z')],
    ['no user', statusMessage('user.suspended', null, '2026-10-07T12:00:00Z')],
    ['a bad time', statusMessage('user.suspended', 15, 'now')],
    ['no data', { type: 'user.suspended' }],
  ])('throws for %s, so the message goes to the retry and dead-letter queues', async (_, message) => {
    const store = new BlockListStore();
    const { consumer } = createConsumer(store);
    await expect(consumer.handle(message)).rejects.toThrow('Invalid message');
    expect(store.isBlocked(15)).toBe(false);
  });
});

describe('blocked users at the gateway', () => {
  let echo;
  let services;

  beforeAll(async () => {
    echo = await startEchoService('any');
    const url = serviceUrl(echo);
    services = {
      AUTH_SERVICE_URL: url,
      CONSULTATION_SERVICE_URL: url,
      PRESCRIPTION_SERVICE_URL: url,
      AUDIT_SERVICE_URL: url,
    };
  });

  afterAll(() => echo.close());

  const bearer = async (user) => `Bearer ${await signToken(user)}`;

  function setup() {
    const blockListStore = new BlockListStore();
    const { consumer } = createConsumer(blockListStore);
    return { app: buildApp(services, { blockListStore }), consumer };
  }

  it('returns 403 ACCOUNT_SUSPENDED on every protected request of a suspended user, at once', async () => {
    const { app, consumer } = setup();
    const token = await bearer(doctor);
    expect((await request(app).get('/api/v1/consultations/41').set('Authorization', token)).status).toBe(200);

    await consumer.handle(statusMessage('user.suspended', doctor.userId, new Date().toISOString()));

    const requests = [
      request(app).get('/api/v1/consultations/41'),
      request(app).post('/api/v1/prescriptions/33/send').send({ channel: 'email' }),
      request(app).get('/api/v1/users/me'),
      request(app).post('/api/v1/auth/logout').send({ refreshToken: 'x' }),
      // Unknown routes ask for a token too.
      request(app).get('/api/v1/nothing-here'),
    ];
    for (const req of requests) {
      const res = await req.set('Authorization', token);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(SUSPENDED);
    }
  });

  it('blocks the SSE stream with the token in the query string too', async () => {
    const { app, consumer } = setup();
    await consumer.handle(statusMessage('user.suspended', doctor.userId, new Date().toISOString()));
    const res = await request(app).get(`/api/v1/consultations/events?token=${await signToken(doctor)}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(SUSPENDED);
  });

  it('checks the block before the role, and leaves other users and public routes alone', async () => {
    const { app, consumer } = setup();
    await consumer.handle(statusMessage('user.suspended', patient.userId, new Date().toISOString()));

    const wrongRole = await request(app).post('/api/v1/consultations').set('Authorization', await bearer(patient));
    expect(wrongRole.body).toEqual(SUSPENDED);

    const other = await request(app).get('/api/v1/consultations/41').set('Authorization', await bearer(doctor));
    expect(other.status).toBe(200);

    // Login and refresh are public: the Auth & User Service refuses them itself.
    const login = await request(app).post('/api/v1/auth/login').send({ firebaseToken: 'x' });
    expect(login.status).toBe(200);
  });

  it('still returns 401 for a missing or bad token of a blocked user', async () => {
    const { app, consumer } = setup();
    await consumer.handle(statusMessage('user.suspended', doctor.userId, new Date().toISOString()));
    expect((await request(app).get('/api/v1/consultations/41')).status).toBe(401);
    const bad = await signToken(doctor, { secret: 'another-secret-that-is-at-least-32-characters' });
    expect((await request(app).get('/api/v1/consultations/41').set('Authorization', `Bearer ${bad}`)).status).toBe(401);
  });

  it('lets the user in again straight away after user.activated', async () => {
    const { app, consumer } = setup();
    const token = await bearer(doctor);
    await consumer.handle(statusMessage('user.suspended', doctor.userId, '2026-10-07T12:00:00Z'));
    expect((await request(app).get('/api/v1/consultations/41').set('Authorization', token)).status).toBe(403);
    await consumer.handle(statusMessage('user.activated', doctor.userId, '2026-10-07T12:30:00Z'));
    expect((await request(app).get('/api/v1/consultations/41').set('Authorization', token)).status).toBe(200);
  });

  it('forwards GET /admin/audit-logs with the query to the Audit Service for an admin', async () => {
    const { app } = setup();
    const res = await request(app)
      .get('/api/v1/admin/audit-logs?from=2026-10-01&to=2026-10-07&userId=16&action=login&page=2')
      .set('Authorization', await bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/admin/audit-logs?from=2026-10-01&to=2026-10-07&userId=16&action=login&page=2');
    expect(res.body.headers['x-user-role']).toBe('admin');
  });
});
