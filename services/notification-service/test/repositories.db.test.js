// Checks the SQL against the real NotificationDB (Docker): the newer-changedAt rule, the check rules and
// claiming each due reminder once. Skipped when NOTIFICATION_DATABASE_URL is not set.
// Run the migrations first (npm run db:migrate).
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db/prisma.js';
import { DeliveryRepository } from '../src/repositories/DeliveryRepository.js';
import { ReminderRepository } from '../src/repositories/ReminderRepository.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: use the variables that are already set.
}

const databaseUrl = process.env.NOTIFICATION_DATABASE_URL;
// IDs that no real record has, so the rows made here can be removed afterwards.
const base = -crypto.randomInt(1e6, 1e9);
let nextConsultationId = base;
const prescriptionId = base;

const change = (consultationId, changes = {}) => ({
  consultationId,
  followUpDate: '2026-10-21',
  doctorName: 'Dr. Sara Ahmed',
  patientName: 'بلال حسین',
  changedAt: new Date('2026-10-07T09:45:00.123Z'),
  ...changes,
});

const reminder = (consultationId, recipientEmail, scheduledAt, recipientType = 'doctor') => ({
  consultationId,
  recipientType,
  recipientEmail,
  scheduledAt: new Date(scheduledAt),
  status: 'pending',
});

describe.skipIf(!databaseUrl)('NotificationDB repositories (database)', () => {
  let prisma;
  let reminders;
  let deliveries;
  const consultationIds = [];
  const newConsultation = () => {
    const id = nextConsultationId--;
    consultationIds.push(id);
    return id;
  };

  beforeAll(() => {
    prisma = createPrismaClient(databaseUrl);
    reminders = new ReminderRepository(prisma);
    deliveries = new DeliveryRepository(prisma);
  });

  afterAll(async () => {
    await prisma.followUpReminder.deleteMany({ where: { consultationId: { in: consultationIds } } });
    await prisma.followUpChange.deleteMany({ where: { consultationId: { in: consultationIds } } });
    await prisma.prescriptionDelivery.deleteMany({ where: { prescriptionId } });
    await prisma.$disconnect();
  });

  it('saves a change only when its changedAt is newer, also after the date was removed', async () => {
    const id = newConsultation();
    expect(await reminders.saveChangeIfNewer(change(id))).toBe(true);
    expect(await reminders.saveChangeIfNewer(change(id))).toBe(false);

    const removedAt = new Date('2026-10-07T10:00:00Z');
    expect(await reminders.saveChangeIfNewer(change(id, { followUpDate: null, changedAt: removedAt }))).toBe(true);
    expect(await reminders.saveChangeIfNewer(change(id, { followUpDate: '2026-10-30' }))).toBe(false);

    const saved = await prisma.followUpChange.findUnique({ where: { consultationId: id } });
    expect(saved).toMatchObject({ followUpDate: null, changedAt: removedAt, patientName: 'بلال حسین' });
  });

  it('runs a change and its reminders in one transaction', async () => {
    const id = newConsultation();
    await expect(
      reminders.transaction(async (repository) => {
        await repository.saveChangeIfNewer(change(id));
        await repository.upsertPending(id, 'doctor', 'sara@example.com', new Date('2026-10-20T04:00:00Z'));
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await prisma.followUpChange.findUnique({ where: { consultationId: id } })).toBeNull();
    expect(await prisma.followUpReminder.count({ where: { consultationId: id } })).toBe(0);
  });

  it('updates the pending row instead of adding one, and deletes only pending rows', async () => {
    const id = newConsultation();
    await reminders.saveChangeIfNewer(change(id));
    await reminders.upsertPending(id, 'doctor', 'sara@example.com', new Date('2026-10-20T04:00:00Z'));
    await reminders.upsertPending(id, 'doctor', 'sara@example.com', new Date('2026-10-24T04:00:00Z'));
    await reminders.upsertPending(id, 'patient', 'bilal@example.com', new Date('2026-10-24T04:00:00Z'));

    let rows = await prisma.followUpReminder.findMany({ where: { consultationId: id }, orderBy: { reminderId: 'asc' } });
    expect(rows.map((r) => [r.recipientType, r.scheduledAt.toISOString(), r.status])).toEqual([
      ['doctor', '2026-10-24T04:00:00.000Z', 'pending'],
      ['patient', '2026-10-24T04:00:00.000Z', 'pending'],
    ]);

    await reminders.deletePending(id, 'patient');
    rows = await prisma.followUpReminder.findMany({ where: { consultationId: id } });
    expect(rows.map((r) => r.recipientType)).toEqual(['doctor']);

    await expect(
      prisma.followUpReminder.create({ data: reminder(id, 'x@example.com', '2026-10-24T04:00:00Z', 'nurse') }),
    ).rejects.toThrow();
  });

  it('claims each due reminder once, also when three claims run at the same time', async () => {
    const id = newConsultation();
    await reminders.saveChangeIfNewer(change(id));
    // Due long ago, so they come before any other due row; plus one that is not due yet.
    for (let i = 0; i < 6; i++) {
      await prisma.followUpReminder.create({ data: reminder(id, `d${i}@example.com`, '2000-01-01T04:00:00Z') });
    }
    const later = await prisma.followUpReminder.create({
      data: reminder(id, 'p@example.com', '2999-01-01T04:00:00Z', 'patient'),
    });

    const claims = await Promise.all([1, 2, 3].map(() => reminders.claimDue({ limit: 6 })));
    const mine = claims.flat().filter((r) => r.consultationId === id);
    const ids = mine.map((r) => r.reminderId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(mine[0]).toMatchObject({
      recipientType: 'doctor',
      followUpDate: '2026-10-21',
      doctorName: 'Dr. Sara Ahmed',
      patientName: 'بلال حسین',
    });
    expect(ids).not.toContain(later.reminderId);

    const claimedAgain = (await reminders.claimDue({ limit: 50 })).filter((r) => r.consultationId === id);
    expect(claimedAgain).toEqual([]);

    await reminders.markFailed(ids[0]);
    expect(await prisma.followUpReminder.findUnique({ where: { reminderId: ids[0] } })).toMatchObject({
      status: 'failed',
      sentAt: null,
    });

    // all: true also takes the reminder that is not due yet.
    const all = (await reminders.claimDue({ all: true, limit: 50 })).filter((r) => r.consultationId === id);
    expect(all.map((r) => r.reminderId)).toEqual([later.reminderId]);
  });

  it('keeps one delivery per messageId and refuses channels other than email', async () => {
    const messageId = crypto.randomUUID();
    const data = {
      messageId,
      prescriptionId,
      channel: 'email',
      recipient: 'ali@example.com',
      status: 'sent',
      errorMessage: null,
      attemptedAt: new Date(),
    };
    await deliveries.create(data);
    expect(await deliveries.findByMessageId(messageId)).toMatchObject({ status: 'sent' });
    await expect(deliveries.create(data)).rejects.toMatchObject({ code: 'P2002' });
    await expect(deliveries.create({ ...data, messageId: crypto.randomUUID(), channel: 'whatsapp' })).rejects.toThrow();
  });
});
