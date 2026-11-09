import { createLogger } from '@mediassist/common';
import request from 'supertest';
import { vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditEventConsumer } from '../src/consumers/AuditEventConsumer.js';
import { AuditService } from '../src/services/AuditService.js';
import { MessageValidator } from '../src/validators/MessageValidator.js';

// audit.event message (design doc 6.4.12).
export function auditEvent(changes = {}, dataChanges = {}) {
  return {
    messageId: crypto.randomUUID(),
    type: 'audit.event',
    version: 1,
    source: 'prescription-service',
    createdAt: '2026-10-07T09:41:00Z',
    data: {
      userId: 16,
      action: 'prescription_send',
      details: 'Prescription 33 sent by email',
      ipAddress: '39.45.12.8',
      occurredAt: '2026-10-07T09:41:00Z',
      ...dataChanges,
    },
    ...changes,
  };
}

// The names and roles the fake Auth & User Service knows.
export const USERS = [
  { userId: 1, fullName: 'Admin', role: 'admin' },
  { userId: 15, fullName: 'Ali Khan', role: 'patient' },
  { userId: 16, fullName: 'Dr. Sara Ahmed', role: 'doctor' },
];

// An in-memory AUDIT_LOG with the same rules as the SQL: unique messageId, newest first.
function createFakeRepository() {
  const rows = [];
  return {
    rows,
    async insert({ messageId, userId, action, details, ipAddress, occurredAt }) {
      if (rows.some((row) => row.messageId === messageId)) return false;
      rows.push({
        logId: BigInt(rows.length + 1),
        messageId,
        userId,
        action,
        details,
        ipAddress,
        createdAt: new Date(occurredAt),
      });
      return true;
    },
    find: vi.fn(async ({ from, before, userId, action, page, pageSize }) => {
      const matching = rows
        .filter(
          (row) =>
            (!from || row.createdAt >= from) &&
            (!before || row.createdAt < before) &&
            (!userId || row.userId === userId) &&
            (!action || row.action === action),
        )
        .sort((a, b) => b.createdAt - a.createdAt || Number(b.logId - a.logId));
      return { rows: matching.slice((page - 1) * pageSize, page * pageSize), total: matching.length };
    }),
  };
}

export function createTestContext() {
  const logger = createLogger('test', 'silent');
  const auditRepository = createFakeRepository();
  const userClient = {
    getUsers: vi.fn(async (ids) => USERS.filter((user) => ids.includes(user.userId))),
  };
  const auditService = new AuditService({ auditRepository, userClient, timeZone: 'Asia/Karachi', logger });
  const eventConsumer = { consume: vi.fn() };
  const auditEventConsumer = new AuditEventConsumer({
    eventConsumer,
    messageValidator: new MessageValidator(),
    auditService,
  });
  const app = createApp({ logger, auditService });

  // A request as the API Gateway forwards it, with the user headers.
  const as = (userId, role) => ({
    get: (path) => request(app).get(path).set('x-user-id', String(userId)).set('x-user-role', role),
  });

  return { app, auditRepository, userClient, auditService, eventConsumer, auditEventConsumer, as };
}
