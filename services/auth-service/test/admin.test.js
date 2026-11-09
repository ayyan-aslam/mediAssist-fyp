import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';

// Admin endpoints: design doc 5.2, 6.4.10, 6.4.11 and Diagram 11.
describe('admin users', () => {
  let ctx;

  // Users made straight in the fake repository. A newer user has a later createdAt.
  function addUser({ role, fullName, email, phone = null, accountStatus = 'active', specialtyId }) {
    const userId = ctx.users.length + 1;
    const createdAt = new Date(Date.UTC(2026, 9, userId, 9, 15));
    ctx.users.push({ userId, firebaseUid: `uid-${userId}`, fullName, email, phone, role, accountStatus, createdAt });
    if (role === 'doctor') {
      ctx.doctorProfiles.push({
        userId,
        cnicEncrypted: 'encrypted-cnic',
        cnicHash: `hash-${userId}`,
        registrationNo: `PMDC-${userId}`,
        specialtyId,
      });
    }
    return userId;
  }

  let adminId;
  let saraId;
  let aliId;
  let omarId;

  beforeEach(() => {
    ctx = createTestContext();
    adminId = addUser({ role: 'admin', fullName: 'Site Admin', email: 'admin@example.com' });
    saraId = addUser({ role: 'doctor', fullName: 'Dr. Sara Ahmed', email: 'sara@example.com', phone: '03111234567', specialtyId: 3 });
    aliId = addUser({ role: 'patient', fullName: 'Ali Khan', email: 'ali@example.com', phone: '03214567890' });
    omarId = addUser({
      role: 'doctor',
      fullName: 'Dr. Omar Farooq',
      email: 'omar@clinic.pk',
      phone: '03001112233',
      accountStatus: 'suspended',
      specialtyId: 1,
    });
  });

  // The API Gateway sends the admin in these headers.
  function asAdmin(req) {
    return req.set('x-user-id', String(adminId)).set('x-user-role', 'admin').set('x-user-ip', '39.45.12.8');
  }

  const list = (query = '') => asAdmin(request(ctx.app).get(`/admin/users${query}`));
  const suspend = (userId) => asAdmin(request(ctx.app).post(`/admin/users/${userId}/suspend`));
  const activate = (userId) => asAdmin(request(ctx.app).post(`/admin/users/${userId}/activate`));
  const names = (res) => res.body.items.map((item) => item.fullName);

  describe('GET /admin/users', () => {
    it('returns a page of users, newest first, in the shape of design doc 5.2', async () => {
      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 4 });
      expect(names(res)).toEqual(['Dr. Omar Farooq', 'Ali Khan', 'Dr. Sara Ahmed', 'Site Admin']);
      expect(res.body.items[2]).toEqual({
        userId: saraId,
        fullName: 'Dr. Sara Ahmed',
        email: 'sara@example.com',
        phone: '03111234567',
        role: 'doctor',
        accountStatus: 'active',
        specialty: { specialtyId: 3, name: 'Cardiologist' },
        createdAt: '2026-10-02T09:15:00.000Z',
      });
    });

    it('never returns the CNIC or the Firebase UID', async () => {
      const res = await list();
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/cnic|encrypted-cnic|hash-|firebase|uid-/i);
    });

    it('gives null as the specialty of a patient', async () => {
      const res = await list('?role=patient');
      expect(res.body.items).toEqual([expect.objectContaining({ userId: aliId, specialty: null })]);
    });

    it('searches part of the name, ignoring case', async () => {
      expect(names(await list('?search=SARA'))).toEqual(['Dr. Sara Ahmed']);
      expect(names(await list('?search=kha'))).toEqual(['Ali Khan']);
    });

    it('searches part of the email', async () => {
      expect(names(await list('?search=clinic.pk'))).toEqual(['Dr. Omar Farooq']);
    });

    it('searches part of the phone number', async () => {
      expect(names(await list('?search=4567'))).toEqual(['Ali Khan', 'Dr. Sara Ahmed']);
    });

    it('filters by role, status and speciality, together with the search', async () => {
      expect(names(await list('?role=doctor'))).toEqual(['Dr. Omar Farooq', 'Dr. Sara Ahmed']);
      expect(names(await list('?status=suspended'))).toEqual(['Dr. Omar Farooq']);
      expect(names(await list('?specialtyId=3'))).toEqual(['Dr. Sara Ahmed']);
      expect(names(await list('?role=doctor&status=active&search=dr'))).toEqual(['Dr. Sara Ahmed']);
    });

    it('pages the list and gives the total', async () => {
      const res = await list('?page=2&pageSize=3');
      expect(res.body).toMatchObject({ page: 2, pageSize: 3, total: 4 });
      expect(names(res)).toEqual(['Site Admin']);
    });

    it('treats an empty search as no search', async () => {
      expect((await list('?search=')).body.total).toBe(4);
    });

    it.each(['?role=nurse', '?status=deleted', '?page=0', '?pageSize=101', '?specialtyId=abc'])(
      'returns 400 VALIDATION_ERROR for %s',
      async (query) => {
        const res = await list(query);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      },
    );

    it('returns 403 FORBIDDEN for a user who is not an admin', async () => {
      const res = await request(ctx.app).get('/admin/users').set('x-user-id', String(saraId)).set('x-user-role', 'doctor');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 401 without the gateway headers', async () => {
      const res = await request(ctx.app).get('/admin/users');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /admin/users/{userId}', () => {
    it('returns one user in the same shape', async () => {
      const res = await asAdmin(request(ctx.app).get(`/admin/users/${aliId}`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: aliId,
        fullName: 'Ali Khan',
        email: 'ali@example.com',
        phone: '03214567890',
        role: 'patient',
        accountStatus: 'active',
        specialty: null,
        createdAt: '2026-10-03T09:15:00.000Z',
      });
    });

    it.each(['99', 'abc', '0', '1.5'])('returns 404 USER_NOT_FOUND for %s', async (userId) => {
      const res = await asAdmin(request(ctx.app).get(`/admin/users/${userId}`));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'USER_NOT_FOUND', message: 'This user was not found.' } });
    });
  });

  describe('POST /admin/users/{userId}/suspend', () => {
    it('suspends a doctor: Firebase disabled, sessions revoked, refresh tokens deleted', async () => {
      ctx.refreshTokens.push(
        { tokenId: 1, userId: saraId, tokenHash: 'a', expiresAt: new Date(Date.now() + 60_000) },
        { tokenId: 2, userId: saraId, tokenHash: 'b', expiresAt: new Date(Date.now() + 60_000) },
        { tokenId: 3, userId: aliId, tokenHash: 'c', expiresAt: new Date(Date.now() + 60_000) },
      );

      const res = await suspend(saraId);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: saraId, accountStatus: 'suspended' });
      expect(ctx.firebaseClient.disableUser).toHaveBeenCalledWith(`uid-${saraId}`);
      expect(ctx.firebaseClient.revokeRefreshTokens).toHaveBeenCalledWith(`uid-${saraId}`);
      expect(ctx.users.find((user) => user.userId === saraId).accountStatus).toBe('suspended');
      // Only Sara's tokens are gone.
      expect(ctx.refreshTokens.map((token) => token.userId)).toEqual([aliId]);
    });

    it('can suspend a patient', async () => {
      const res = await suspend(aliId);
      expect(res.status).toBe(200);
      expect(res.body.accountStatus).toBe('suspended');
    });

    it('publishes user.suspended with changedAt and audit.event account_suspension', async () => {
      await suspend(saraId);

      const calls = ctx.eventPublisher.publish.mock.calls;
      expect(calls.map(([type]) => type)).toEqual(['user.suspended', 'audit.event']);
      const [, suspended] = calls[0];
      const [, audit] = calls[1];
      expect(suspended).toEqual({ userId: saraId, changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) });
      expect(audit).toEqual({
        userId: adminId,
        action: 'account_suspension',
        details: `Suspended doctor ${saraId} (Dr. Sara Ahmed)`,
        ipAddress: '39.45.12.8',
        occurredAt: suspended.changedAt,
      });
    });

    it('returns 403 CANNOT_SUSPEND_ADMIN for an admin, also for yourself, and changes nothing', async () => {
      const otherAdmin = addUser({ role: 'admin', fullName: 'Second Admin', email: 'admin2@example.com' });

      for (const userId of [otherAdmin, adminId]) {
        const res = await suspend(userId);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('CANNOT_SUSPEND_ADMIN');
      }
      expect(ctx.firebaseClient.disableUser).not.toHaveBeenCalled();
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
      expect(ctx.users.filter((user) => user.accountStatus === 'suspended')).toHaveLength(1);
    });

    it('is safe to call twice: the second call returns 409 ALREADY_SUSPENDED and does nothing', async () => {
      expect((await suspend(saraId)).status).toBe(200);
      ctx.firebaseClient.disableUser.mockClear();
      ctx.eventPublisher.publish.mockClear();

      const res = await suspend(saraId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_SUSPENDED');
      expect(ctx.firebaseClient.disableUser).not.toHaveBeenCalled();
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
      expect(ctx.users.find((user) => user.userId === saraId).accountStatus).toBe('suspended');
    });

    it('returns 404 USER_NOT_FOUND for an unknown user', async () => {
      const res = await suspend(99);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('returns 503 and keeps the user active when Firebase fails, and a retry then works', async () => {
      ctx.firebaseClient.disableUser.mockRejectedValueOnce(new Error('Firebase is down'));

      const failed = await suspend(saraId);
      expect(failed.status).toBe(503);
      expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(ctx.users.find((user) => user.userId === saraId).accountStatus).toBe('active');
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();

      expect((await suspend(saraId)).status).toBe(200);
    });

    it('returns 503 and saves nothing when RabbitMQ fails, and a retry then works', async () => {
      ctx.refreshTokens.push({ tokenId: 1, userId: saraId, tokenHash: 'a', expiresAt: new Date(Date.now() + 60_000) });
      ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));

      const failed = await suspend(saraId);
      expect(failed.status).toBe(503);
      expect(ctx.users.find((user) => user.userId === saraId).accountStatus).toBe('active');
      expect(ctx.refreshTokens).toHaveLength(1);

      expect((await suspend(saraId)).status).toBe(200);
      expect(ctx.refreshTokens).toHaveLength(0);
    });

    it('returns 403 FORBIDDEN for a user who is not an admin', async () => {
      const res = await request(ctx.app)
        .post(`/admin/users/${aliId}/suspend`)
        .set('x-user-id', String(saraId))
        .set('x-user-role', 'doctor');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(ctx.firebaseClient.disableUser).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/users/{userId}/activate', () => {
    it('activates a suspended user: Firebase enabled and user.activated published', async () => {
      const res = await activate(omarId);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: omarId, accountStatus: 'active' });
      expect(ctx.firebaseClient.enableUser).toHaveBeenCalledWith(`uid-${omarId}`);
      expect(ctx.users.find((user) => user.userId === omarId).accountStatus).toBe('active');
      expect(ctx.eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(ctx.eventPublisher.publish).toHaveBeenCalledWith('user.activated', {
        userId: omarId,
        changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      });
    });

    it('is safe to call twice: the second call returns 409 ALREADY_ACTIVE and does nothing', async () => {
      expect((await activate(omarId)).status).toBe(200);
      ctx.firebaseClient.enableUser.mockClear();
      ctx.eventPublisher.publish.mockClear();

      const res = await activate(omarId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_ACTIVE');
      expect(ctx.firebaseClient.enableUser).not.toHaveBeenCalled();
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('returns 404 USER_NOT_FOUND for an unknown user', async () => {
      const res = await activate(99);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('returns 503 and keeps the user suspended when RabbitMQ fails', async () => {
      ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));
      const res = await activate(omarId);
      expect(res.status).toBe(503);
      expect(ctx.users.find((user) => user.userId === omarId).accountStatus).toBe('suspended');
    });

    it('lets the user log in again after a suspend and an activate', async () => {
      await suspend(saraId);
      ctx.firebaseClient.verifyIdToken.mockResolvedValue({ uid: `uid-${saraId}`, email: 'sara@example.com', emailVerified: true });
      const login = () => request(ctx.app).post('/auth/login').send({ firebaseToken: 'firebase-id-token' });

      expect((await login()).body.error.code).toBe('ACCOUNT_SUSPENDED');
      await activate(saraId);
      expect((await login()).status).toBe(200);
    });
  });

  describe('suspended users cannot log in or refresh', () => {
    beforeEach(() => {
      ctx.firebaseClient.verifyIdToken.mockResolvedValue({ uid: `uid-${saraId}`, email: 'sara@example.com', emailVerified: true });
    });

    it('returns 403 ACCOUNT_SUSPENDED on login', async () => {
      await suspend(saraId);
      const res = await request(ctx.app).post('/auth/login').send({ firebaseToken: 'firebase-id-token' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('returns 403 ACCOUNT_SUSPENDED on refresh when the account is suspended', async () => {
      const { refreshToken } = (await request(ctx.app).post('/auth/login').send({ firebaseToken: 'x' })).body;
      // The status changes while the token still exists (for example, a refresh at the same moment as the suspend).
      ctx.users.find((user) => user.userId === saraId).accountStatus = 'suspended';

      const res = await request(ctx.app).post('/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('stops every refresh token of the user after the suspension', async () => {
      const { refreshToken } = (await request(ctx.app).post('/auth/login').send({ firebaseToken: 'x' })).body;
      await suspend(saraId);

      const res = await request(ctx.app).post('/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });
  });

  describe('GET /internal/users', () => {
    it('returns the names and roles of the given users', async () => {
      const res = await request(ctx.app).get(`/internal/users?ids=${aliId},${saraId}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          { userId: saraId, fullName: 'Dr. Sara Ahmed', role: 'doctor' },
          { userId: aliId, fullName: 'Ali Khan', role: 'patient' },
        ],
      });
    });

    it('leaves out unknown IDs and repeats', async () => {
      const res = await request(ctx.app).get(`/internal/users?ids=${aliId},${aliId},999`);
      expect(res.body.items).toEqual([{ userId: aliId, fullName: 'Ali Khan', role: 'patient' }]);
    });

    it.each(['', '?ids=', '?ids=1,abc', '?ids=0', '?ids=1,,2'])('returns 400 VALIDATION_ERROR for %s', async (query) => {
      const res = await request(ctx.app).get(`/internal/users${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for more than 100 IDs', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(',');
      const res = await request(ctx.app).get(`/internal/users?ids=${ids}`);
      expect(res.status).toBe(400);
    });
  });
});
