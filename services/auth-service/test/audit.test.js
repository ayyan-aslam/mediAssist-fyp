import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, validDoctor } from './helpers.js';

// audit.event for login and logout: design doc 6.4.12.
describe('audit events', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await request(ctx.app).post('/auth/doctor/register').send(validDoctor);
    ctx.firebaseClient.verifyIdToken.mockResolvedValue({
      uid: 'firebase-uid-1',
      email: 'sara@example.com',
      emailVerified: true,
    });
  });

  // The API Gateway adds x-user-ip on every route.
  function login() {
    return request(ctx.app).post('/auth/login').set('x-user-ip', '39.45.12.8').send({ firebaseToken: 'firebase-id-token' });
  }

  it('sends audit.event "login" with the user and the IP address', async () => {
    const res = await login();

    expect(res.status).toBe(200);
    expect(ctx.eventPublisher.publish).toHaveBeenCalledWith('audit.event', {
      userId: 1,
      action: 'login',
      details: null,
      ipAddress: '39.45.12.8',
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
  });

  it('sends audit.event "logout" with the user from the gateway headers', async () => {
    const { refreshToken } = (await login()).body;
    ctx.eventPublisher.publish.mockClear();

    const res = await request(ctx.app)
      .post('/auth/logout')
      .set('x-user-id', '1')
      .set('x-user-ip', '39.45.12.8')
      .send({ refreshToken });

    expect(res.status).toBe(204);
    expect(ctx.eventPublisher.publish).toHaveBeenCalledWith(
      'audit.event',
      expect.objectContaining({ userId: 1, action: 'logout', details: null, ipAddress: '39.45.12.8' }),
    );
  });

  it('still logs in when RabbitMQ is down', async () => {
    ctx.eventPublisher.publish.mockRejectedValue(new Error('RabbitMQ is not connected.'));

    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('does not wait for RabbitMQ before answering the login', async () => {
    // A publish that never confirms.
    ctx.eventPublisher.publish.mockReturnValue(new Promise(() => {}));
    const res = await login();
    expect(res.status).toBe(200);
  });

  it('still logs out when RabbitMQ is down', async () => {
    const { refreshToken } = (await login()).body;
    ctx.eventPublisher.publish.mockRejectedValue(new Error('RabbitMQ is not connected.'));

    const res = await request(ctx.app).post('/auth/logout').set('x-user-id', '1').send({ refreshToken });
    expect(res.status).toBe(204);
  });

  it('sends no audit event for a failed login', async () => {
    ctx.firebaseClient.verifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await login();
    expect(res.status).toBe(401);
    expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('logs the error when the audit event cannot be sent', async () => {
    const logger = { error: vi.fn(), debug: vi.fn() };
    const { AuthService } = await import('../src/services/AuthService.js');
    const service = new AuthService({
      refreshTokenService: { revoke: vi.fn(async () => {}) },
      eventPublisher: { publish: vi.fn(async () => Promise.reject(new Error('RabbitMQ is not connected.'))) },
      logger,
    });

    await service.logout('token', { userId: 1, ipAddress: '39.45.12.8' });
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, action: 'logout' }),
        'Could not send the audit event',
      ),
    );
  });
});
