import { AppError } from '@mediassist/common';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { auditEvent, createTestContext } from './helpers.js';

// Saves the events through the consumer, as RabbitMQ would.
async function withLogs(events) {
  const ctx = createTestContext();
  for (const [userId, action, occurredAt, details = null] of events) {
    await ctx.auditEventConsumer.handle(auditEvent({}, { userId, action, occurredAt, details }));
  }
  return ctx;
}

const admin = (ctx) => ctx.as(1, 'admin');

describe('GET /admin/audit-logs', () => {
  it('returns the logs newest first, with user names and roles (design doc 5.10)', async () => {
    const ctx = await withLogs([
      [15, 'login', '2026-10-07T08:00:00Z'],
      [16, 'prescription_send', '2026-10-07T09:41:00Z', 'Prescription 33 sent by email'],
      [1, 'account_suspension', '2026-10-07T09:00:00Z', 'Suspended patient 15 (Ali Khan)'],
    ]);
    const res = await admin(ctx).get('/admin/audit-logs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          logId: 2,
          user: { userId: 16, fullName: 'Dr. Sara Ahmed', role: 'doctor' },
          action: 'prescription_send',
          details: 'Prescription 33 sent by email',
          ipAddress: '39.45.12.8',
          createdAt: '2026-10-07T09:41:00.000Z',
        },
        {
          logId: 3,
          user: { userId: 1, fullName: 'Admin', role: 'admin' },
          action: 'account_suspension',
          details: 'Suspended patient 15 (Ali Khan)',
          ipAddress: '39.45.12.8',
          createdAt: '2026-10-07T09:00:00.000Z',
        },
        {
          logId: 1,
          user: { userId: 15, fullName: 'Ali Khan', role: 'patient' },
          action: 'login',
          details: null,
          ipAddress: '39.45.12.8',
          createdAt: '2026-10-07T08:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 3,
    });
    // One call for all the users on the page, each ID once.
    expect(ctx.userClient.getUsers).toHaveBeenCalledTimes(1);
    expect(ctx.userClient.getUsers.mock.calls[0][0].sort()).toEqual([1, 15, 16]);
  });

  it('pages the list and counts every matching log', async () => {
    const ctx = await withLogs(
      Array.from({ length: 5 }, (_, i) => [16, 'login', `2026-10-07T0${i}:00:00Z`]),
    );
    const res = await admin(ctx).get('/admin/audit-logs?page=2&pageSize=2');
    expect(res.body.items.map((item) => item.createdAt)).toEqual([
      '2026-10-07T02:00:00.000Z',
      '2026-10-07T01:00:00.000Z',
    ]);
    expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
  });

  it('filters by user and by action', async () => {
    const ctx = await withLogs([
      [15, 'login', '2026-10-07T08:00:00Z'],
      [16, 'login', '2026-10-07T08:30:00Z'],
      [16, 'logout', '2026-10-07T09:00:00Z'],
    ]);
    const byUser = await admin(ctx).get('/admin/audit-logs?userId=16');
    expect(byUser.body.items.map((item) => item.action)).toEqual(['logout', 'login']);

    const both = await admin(ctx).get('/admin/audit-logs?userId=16&action=login');
    expect(both.body.items).toHaveLength(1);
    expect(both.body.items[0]).toMatchObject({ user: { userId: 16 }, action: 'login' });
    expect(both.body.total).toBe(1);
  });

  it('filters by whole days in Pakistan time, both dates included', async () => {
    const ctx = await withLogs([
      // 2026-09-30 23:59 in Pakistan (UTC+5): the day before.
      [16, 'login', '2026-09-30T18:59:00Z'],
      // 2026-10-01 00:00 in Pakistan.
      [16, 'login', '2026-09-30T19:00:00Z'],
      // 2026-10-07 23:59 in Pakistan.
      [16, 'login', '2026-10-07T18:59:00Z'],
      // 2026-10-08 00:00 in Pakistan: the day after.
      [16, 'login', '2026-10-07T19:00:00Z'],
    ]);
    const res = await admin(ctx).get('/admin/audit-logs?from=2026-10-01&to=2026-10-07');
    expect(res.body.items.map((item) => item.createdAt)).toEqual([
      '2026-10-07T18:59:00.000Z',
      '2026-09-30T19:00:00.000Z',
    ]);
    expect(ctx.auditRepository.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: new Date('2026-09-30T19:00:00Z'),
        before: new Date('2026-10-07T19:00:00Z'),
      }),
    );

    const fromOnly = await admin(ctx).get('/admin/audit-logs?from=2026-10-08');
    expect(fromOnly.body.total).toBe(1);
    const toOnly = await admin(ctx).get('/admin/audit-logs?to=2026-09-30');
    expect(toOnly.body.total).toBe(1);
  });

  it('returns an empty page without calling the Auth & User Service', async () => {
    const ctx = createTestContext();
    const res = await admin(ctx).get('/admin/audit-logs');
    expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(ctx.userClient.getUsers).not.toHaveBeenCalled();
  });

  it('keeps the user ID with no name or role when the Auth & User Service does not know the user', async () => {
    const ctx = await withLogs([[99, 'login', '2026-10-07T08:00:00Z']]);
    const res = await admin(ctx).get('/admin/audit-logs');
    expect(res.body.items[0].user).toEqual({ userId: 99, fullName: null, role: null });
  });

  it('returns 503 SERVICE_UNAVAILABLE when the Auth & User Service does not answer', async () => {
    const ctx = await withLogs([[16, 'login', '2026-10-07T08:00:00Z']]);
    ctx.userClient.getUsers.mockRejectedValueOnce(
      new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is not responding. Please try again.'),
    );
    const res = await admin(ctx).get('/admin/audit-logs');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it.each([
    ['from=2026-10-32'],
    ['to=07-10-2026'],
    ['from=2026-10-08&to=2026-10-07'],
    ['userId=abc'],
    ['userId=0'],
    ['action=delete'],
    ['page=0'],
    ['pageSize=101'],
  ])('returns 400 VALIDATION_ERROR for ?%s', async (query) => {
    const ctx = createTestContext();
    const res = await admin(ctx).get(`/admin/audit-logs?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without the gateway user and 403 for a doctor or a patient', async () => {
    const ctx = createTestContext();
    expect((await request(ctx.app).get('/admin/audit-logs')).status).toBe(401);
    for (const [userId, role] of [[16, 'doctor'], [15, 'patient']]) {
      const res = await ctx.as(userId, role).get('/admin/audit-logs');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});
