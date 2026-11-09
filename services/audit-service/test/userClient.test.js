import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserClient } from '../src/clients/UserClient.js';

// A fake Auth & User Service internal API.
let server;
let baseUrl;
const calls = [];

beforeAll(async () => {
  const fake = express();
  fake.get('/internal/users', (req, res) => {
    calls.push(req.url);
    if (req.query.ids === '500') {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
    }
    return res.json({
      items: [
        { userId: 15, fullName: 'Ali Khan', role: 'patient' },
        { userId: 16, fullName: 'Dr. Sara Ahmed', role: 'doctor' },
      ],
    });
  });
  await new Promise((resolve) => {
    server = fake.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

describe('UserClient', () => {
  it('calls GET /internal/users?ids= and returns the items', async () => {
    const users = await new UserClient({ baseUrl }).getUsers([15, 16]);
    expect(users).toEqual([
      { userId: 15, fullName: 'Ali Khan', role: 'patient' },
      { userId: 16, fullName: 'Dr. Sara Ahmed', role: 'doctor' },
    ]);
    expect(decodeURIComponent(calls.at(-1))).toBe('/internal/users?ids=15,16');
  });

  it('returns 503 SERVICE_UNAVAILABLE on a server error or when the service is down', async () => {
    await expect(new UserClient({ baseUrl }).getUsers([500])).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    await expect(new UserClient({ baseUrl: 'http://127.0.0.1:1' }).getUsers([15])).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
