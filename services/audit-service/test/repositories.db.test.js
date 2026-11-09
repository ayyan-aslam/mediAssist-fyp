// Checks the SQL against the real AuditDB (Docker): ON CONFLICT (message_id) DO NOTHING, the filters, the
// check rule, and that the runtime login audit_service cannot UPDATE or DELETE. Skipped when
// AUDIT_DATABASE_URL or AUDIT_MIGRATION_DATABASE_URL is not set. Run the migrations first (npm run db:migrate).
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db/prisma.js';
import { AuditRepository } from '../src/repositories/AuditRepository.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: use the variables that are already set.
}

const serviceUrl = process.env.AUDIT_DATABASE_URL;
const ownerUrl = process.env.AUDIT_MIGRATION_DATABASE_URL;
// A user ID that no real user has, so the rows made here can be found and removed afterwards.
const userId = -crypto.randomInt(1e6, 1e9);

const log = (changes = {}) => ({
  messageId: crypto.randomUUID(),
  userId,
  action: 'soap_note_change',
  details: 'SOAP note of consultation 41 edited – بلال حسین',
  ipAddress: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
  occurredAt: '2026-10-07T09:41:00.123Z',
  ...changes,
});

describe.skipIf(!serviceUrl || !ownerUrl)('AuditDB repository (database)', () => {
  // prisma: the runtime login audit_service. owner: audit_owner, only to remove the test rows.
  let prisma;
  let owner;
  let audit;

  beforeAll(() => {
    prisma = createPrismaClient(serviceUrl);
    owner = createPrismaClient(ownerUrl);
    audit = new AuditRepository(prisma);
  });

  afterAll(async () => {
    await owner?.auditLog.deleteMany({ where: { userId } });
    await prisma?.$disconnect();
    await owner?.$disconnect();
  });

  it('inserts a log once per messageId, with the UTC time and UTF-8 text', async () => {
    const entry = log();
    expect(await audit.insert(entry)).toBe(true);
    expect(await audit.insert({ ...entry, details: 'changed' })).toBe(false);

    const rows = await prisma.auditLog.findMany({ where: { messageId: entry.messageId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      action: 'soap_note_change',
      details: 'SOAP note of consultation 41 edited – بلال حسین',
      ipAddress: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      createdAt: new Date('2026-10-07T09:41:00.123Z'),
    });
    expect(typeof rows[0].logId).toBe('bigint');
  });

  it('accepts a time with an offset and saves it as UTC', async () => {
    const entry = log({ occurredAt: '2026-10-07T14:41:00+05:00' });
    await audit.insert(entry);
    const row = await prisma.auditLog.findUnique({ where: { messageId: entry.messageId } });
    expect(row.createdAt).toEqual(new Date('2026-10-07T09:41:00Z'));
  });

  it('finds the logs newest first, filtered by time, user and action, and paged', async () => {
    await audit.insert(log({ action: 'login', occurredAt: '2026-11-01T08:00:00Z' }));
    await audit.insert(log({ action: 'logout', occurredAt: '2026-11-01T09:00:00Z' }));
    await audit.insert(log({ action: 'login', occurredAt: '2026-11-02T08:00:00Z' }));

    const all = await audit.find({
      from: new Date('2026-11-01T00:00:00Z'),
      before: new Date('2026-11-03T00:00:00Z'),
      userId,
      page: 1,
      pageSize: 20,
    });
    expect(all.total).toBe(3);
    expect(all.rows.map((row) => row.createdAt.toISOString())).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-01T09:00:00.000Z',
      '2026-11-01T08:00:00.000Z',
    ]);

    const logins = await audit.find({ userId, action: 'login', page: 2, pageSize: 1 });
    expect(logins.total).toBe(2);
    expect(logins.rows.map((row) => row.createdAt.toISOString())).toEqual(['2026-11-01T08:00:00.000Z']);

    // before is not included.
    const firstDay = await audit.find({
      from: new Date('2026-11-01T00:00:00Z'),
      before: new Date('2026-11-01T09:00:00Z'),
      userId,
      page: 1,
      pageSize: 20,
    });
    expect(firstDay.rows.map((row) => row.action)).toEqual(['login']);
  });

  it('refuses an action that is not allowed (design doc 4.6)', async () => {
    await expect(audit.insert(log({ action: 'delete_everything' }))).rejects.toThrow();
  });

  it('cannot UPDATE or DELETE rows with the runtime login audit_service', async () => {
    const entry = log();
    await audit.insert(entry);

    await expect(
      prisma.$executeRaw`UPDATE audit_log SET details = 'changed' WHERE message_id = ${entry.messageId}::uuid`,
    ).rejects.toThrow(/permission denied/i);
    await expect(
      prisma.$executeRaw`DELETE FROM audit_log WHERE message_id = ${entry.messageId}::uuid`,
    ).rejects.toThrow(/permission denied/i);
    await expect(prisma.$executeRaw`TRUNCATE audit_log`).rejects.toThrow(/permission denied/i);
    await expect(
      prisma.auditLog.update({ where: { messageId: entry.messageId }, data: { details: 'changed' } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(prisma.auditLog.deleteMany({ where: { messageId: entry.messageId } })).rejects.toThrow(
      /permission denied/i,
    );

    const row = await prisma.auditLog.findUnique({ where: { messageId: entry.messageId } });
    expect(row.details).toBe(entry.details);
  });
});
