import { jwtVerify } from 'jose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testConfig, validDoctor } from './helpers.js';

describe('login, refresh and logout', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await request(ctx.app).post('/auth/doctor/register').send(validDoctor);
  });

  function mockFirebaseLogin({ emailVerified = true } = {}) {
    ctx.firebaseClient.verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-uid-1',
      email: 'sara@example.com',
      emailVerified,
    });
  }

  async function login() {
    mockFirebaseLogin();
    const res = await request(ctx.app).post('/auth/login').send({ firebaseToken: 'firebase-id-token' });
    expect(res.status).toBe(200);
    return res.body;
  }

  function refresh(refreshToken) {
    return request(ctx.app).post('/auth/refresh').send({ refreshToken });
  }

  describe('POST /auth/login', () => {
    it('returns the tokens and the user', async () => {
      const body = await login();

      expect(ctx.firebaseClient.verifyIdToken).toHaveBeenCalledWith('firebase-id-token');
      expect(body).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.stringMatching(/^[0-9a-f]{64}$/),
        expiresIn: 900,
        user: { userId: 1, fullName: 'Dr. Sara Ahmed', email: 'sara@example.com', role: 'doctor' },
      });
    });

    it('gives a 15-minute access token with the user ID, role, name and email', async () => {
      const { accessToken } = await login();

      const { payload } = await jwtVerify(accessToken, new TextEncoder().encode(testConfig.JWT_SECRET));
      expect(payload).toMatchObject({ userId: 1, role: 'doctor', name: 'Dr. Sara Ahmed', email: 'sara@example.com' });
      expect(payload.exp - payload.iat).toBe(900);
    });

    it('saves only the hash of the refresh token', async () => {
      const { refreshToken } = await login();

      expect(ctx.refreshTokens).toHaveLength(1);
      expect(ctx.refreshTokens[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(ctx.refreshTokens[0].tokenHash).not.toBe(refreshToken);
      const days = (ctx.refreshTokens[0].expiresAt - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeCloseTo(7, 1);
    });

    it('returns 401 INVALID_FIREBASE_TOKEN when Firebase rejects the token', async () => {
      const res = await request(ctx.app).post('/auth/login').send({ firebaseToken: 'bad-token' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_FIREBASE_TOKEN');
    });

    it('returns 401 INVALID_FIREBASE_TOKEN when the Firebase user has no account', async () => {
      ctx.firebaseClient.verifyIdToken.mockResolvedValueOnce({
        uid: 'unknown-uid',
        email: 'x@example.com',
        emailVerified: true,
      });
      const res = await request(ctx.app).post('/auth/login').send({ firebaseToken: 'firebase-id-token' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_FIREBASE_TOKEN');
    });

    it('returns 403 EMAIL_NOT_VERIFIED', async () => {
      mockFirebaseLogin({ emailVerified: false });
      const res = await request(ctx.app).post('/auth/login').send({ firebaseToken: 'firebase-id-token' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      expect(ctx.refreshTokens).toHaveLength(0);
    });

    it('returns 403 ACCOUNT_SUSPENDED', async () => {
      ctx.users[0].accountStatus = 'suspended';
      mockFirebaseLogin();
      const res = await request(ctx.app).post('/auth/login').send({ firebaseToken: 'firebase-id-token' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('returns 400 VALIDATION_ERROR when the Firebase token is missing', async () => {
      const res = await request(ctx.app).post('/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns new tokens and the old refresh token stops working', async () => {
      const { refreshToken } = await login();

      const res = await refresh(refreshToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.stringMatching(/^[0-9a-f]{64}$/),
        expiresIn: 900,
      });
      expect(res.body.refreshToken).not.toBe(refreshToken);

      const reuse = await refresh(refreshToken);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe('REFRESH_TOKEN_INVALID');

      expect((await refresh(res.body.refreshToken)).status).toBe(200);
    });

    it('returns 401 REFRESH_TOKEN_INVALID for an unknown token', async () => {
      const res = await refresh('not-a-real-token');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('returns 401 REFRESH_TOKEN_INVALID for an expired token', async () => {
      const { refreshToken } = await login();
      ctx.refreshTokens[0].expiresAt = new Date(Date.now() - 1000);

      const res = await refresh(refreshToken);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('returns 403 ACCOUNT_SUSPENDED and keeps no token for a suspended user', async () => {
      const { refreshToken } = await login();
      ctx.users[0].accountStatus = 'suspended';

      const res = await refresh(refreshToken);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
      expect(ctx.refreshTokens).toHaveLength(0);
    });

    it('returns 400 VALIDATION_ERROR when the refresh token is missing', async () => {
      const res = await request(ctx.app).post('/auth/refresh').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/logout', () => {
    it('deletes only the token of this device', async () => {
      const phone = await login();
      const laptop = await login();

      const res = await request(ctx.app).post('/auth/logout').send({ refreshToken: phone.refreshToken });
      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      expect((await refresh(phone.refreshToken)).status).toBe(401);
      expect((await refresh(laptop.refreshToken)).status).toBe(200);
    });

    it('returns 204 when the token is already gone', async () => {
      const res = await request(ctx.app).post('/auth/logout').send({ refreshToken: 'already-deleted' });
      expect(res.status).toBe(204);
    });

    it('returns 400 VALIDATION_ERROR when the refresh token is missing', async () => {
      const res = await request(ctx.app).post('/auth/logout').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
