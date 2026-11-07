import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, DOCTOR_ID, OTHER_DOCTOR_ID } from './helpers.js';

// Supertest waits for the response to end, and an SSE stream never ends. So these tests use a real server.
describe('GET /consultations/events', () => {
  let ctx;
  let server;
  let baseUrl;
  const openRequests = [];

  beforeEach(async () => {
    ctx = createTestContext();
    server = ctx.app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    for (const req of openRequests.splice(0)) req.destroy();
    ctx.sseManager.closeAll();
    await new Promise((resolve) => server.close(resolve));
  });

  // Opens the stream with the gateway headers and resolves with the response once the headers arrive.
  function open(headers) {
    return new Promise((resolve, reject) => {
      const req = http.get(`${baseUrl}/consultations/events`, { headers }, (res) => {
        res.setEncoding('utf8');
        res.body = '';
        res.on('data', (chunk) => {
          res.body += chunk;
        });
        // An error response ends at once, maybe before the test listens for it.
        res.ended = new Promise((done) => res.on('end', done));
        resolve(res);
      });
      req.on('error', reject);
      openRequests.push(req);
    });
  }

  const doctor = (id = DOCTOR_ID) => ({ 'x-user-id': String(id), 'x-user-role': 'doctor' });

  const nextData = (res) => new Promise((resolve) => res.once('data', resolve));

  async function readBody(res) {
    await res.ended;
    return JSON.parse(res.body);
  }

  it('opens an SSE stream', async () => {
    const res = await open(doctor());
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
  });

  it('sends the doctor’s events and not another doctor’s', async () => {
    const mine = await open(doctor());
    const other = await open(doctor(OTHER_DOCTOR_ID));

    const received = nextData(mine);
    ctx.sseManager.send(DOCTOR_ID, 'consultation_failed', {
      consultationId: 41,
      failureReason: 'AI_TIMEOUT',
      message: 'The SOAP note is taking too long. Please try again.',
    });
    await received;

    expect(mine.body).toBe(
      'event: consultation_failed\n' +
        'data: {"consultationId":41,"failureReason":"AI_TIMEOUT","message":"The SOAP note is taking too long. Please try again."}\n\n',
    );
    expect(other.body).toBe('');
  });

  it('forgets the connection when the app disconnects', async () => {
    await open(doctor());
    expect(ctx.sseManager.connections.get(DOCTOR_ID).size).toBe(1);

    openRequests[0].destroy();
    await expect.poll(() => ctx.sseManager.connections.has(DOCTOR_ID)).toBe(false);
  });

  it('returns 401 UNAUTHORIZED without the gateway user headers', async () => {
    const res = await open({});
    expect(res.statusCode).toBe(401);
    expect(await readBody(res)).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'The access token is missing.' },
    });
  });

  it('returns 403 FORBIDDEN for a patient', async () => {
    const res = await open({ 'x-user-id': '5', 'x-user-role': 'patient' });
    expect(res.statusCode).toBe(403);
    expect((await readBody(res)).error.code).toBe('FORBIDDEN');
  });
});
