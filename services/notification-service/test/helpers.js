import { createLogger } from '@mediassist/common';
import { vi } from 'vitest';
import { DeliveryService } from '../src/services/DeliveryService.js';
import { ReminderScheduler } from '../src/services/ReminderScheduler.js';
import { ReminderService } from '../src/services/ReminderService.js';

export const MESSAGE_ID = 'a1b2c3d4-0005-4000-8000-000000000005';
export const PDF = Buffer.from('%PDF-1.7 test prescription');

// prescription.send data (design doc 6.4.7).
export function prescriptionSend(changes = {}) {
  return {
    prescriptionId: 33,
    consultationId: 41,
    doctorId: 16,
    channel: 'email',
    recipient: 'bilal@example.com',
    patientName: 'Bilal Hussain',
    doctorName: 'Dr. Sara Ahmed',
    pdfKey: 'prescriptions/33.pdf',
    ...changes,
  };
}

// followup.changed data (design doc 6.4.9).
export function followUpChanged(changes = {}) {
  return {
    consultationId: 41,
    followUpDate: '2026-10-21',
    doctorId: 16,
    doctorName: 'Dr. Sara Ahmed',
    doctorEmail: 'sara@example.com',
    patientName: 'Bilal Hussain',
    patientEmail: 'bilal@example.com',
    changedAt: '2026-10-07T09:45:00Z',
    ...changes,
  };
}

// An email error like the ones nodemailer throws.
export const smtpError = (message, fields) => Object.assign(new Error(message), fields);

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

// In-memory copies of the repositories, with the same rules as the SQL: unique messageId, newer changedAt
// only, and a claimed reminder is marked sent at once.
function createFakeRepositories(now) {
  const deliveries = [];
  const changes = new Map();
  const reminders = [];

  const deliveryRepository = {
    async findByMessageId(messageId) {
      return deliveries.find((d) => d.messageId === messageId) ?? null;
    },
    async create(data) {
      if (deliveries.some((d) => d.messageId === data.messageId)) throw uniqueViolation();
      const row = { deliveryId: deliveries.length + 1, ...data };
      deliveries.push(row);
      return { ...row };
    },
  };

  const reminderRepository = {
    async transaction(fn) {
      return fn(reminderRepository);
    },
    async saveChangeIfNewer({ consultationId, followUpDate, doctorName, patientName, changedAt }) {
      const saved = changes.get(consultationId);
      if (saved && saved.changedAt >= changedAt) return false;
      changes.set(consultationId, { consultationId, followUpDate, doctorName, patientName, changedAt });
      return true;
    },
    async upsertPending(consultationId, recipientType, recipientEmail, scheduledAt) {
      const row = reminders.find(
        (r) => r.consultationId === consultationId && r.recipientType === recipientType && r.status === 'pending',
      );
      if (row) Object.assign(row, { recipientEmail, scheduledAt });
      else {
        reminders.push({
          reminderId: reminders.length + 1,
          consultationId,
          recipientType,
          recipientEmail,
          scheduledAt,
          status: 'pending',
          sentAt: null,
        });
      }
    },
    async deletePending(consultationId, recipientType) {
      for (let i = reminders.length - 1; i >= 0; i--) {
        const r = reminders[i];
        if (r.consultationId === consultationId && r.status === 'pending' && (!recipientType || r.recipientType === recipientType)) {
          reminders.splice(i, 1);
        }
      }
    },
    claimDue: vi.fn(async ({ all = false, limit }) => {
      const due = reminders
        .filter((r) => r.status === 'pending' && (all || r.scheduledAt <= now()))
        .sort((a, b) => a.scheduledAt - b.scheduledAt)
        .slice(0, limit);
      return due.map((r) => {
        Object.assign(r, { status: 'sent', sentAt: now() });
        const { followUpDate, doctorName, patientName } = changes.get(r.consultationId);
        const { reminderId, consultationId, recipientType, recipientEmail } = r;
        return { reminderId, consultationId, recipientType, recipientEmail, followUpDate, doctorName, patientName };
      });
    }),
    async markSent(reminderId, sentAt) {
      Object.assign(reminders.find((r) => r.reminderId === reminderId), { status: 'sent', sentAt });
    },
    async markFailed(reminderId) {
      Object.assign(reminders.find((r) => r.reminderId === reminderId), { status: 'failed', sentAt: null });
    },
  };

  return { deliveries, changes, reminders, deliveryRepository, reminderRepository };
}

// now: the clock for the reminders (the time the message is handled).
export function createTestContext({ now = new Date('2026-10-07T09:45:00Z') } = {}) {
  let clock = now;
  const nowFn = () => clock;
  const fakes = createFakeRepositories(nowFn);
  const logger = createLogger('test', 'silent');

  // The email sender is always a mock: tests never send real emails.
  const emailSender = { send: vi.fn(async () => {}) };
  const files = new Map([['prescriptions/33.pdf', PDF]]);
  const s3Client = {
    getBuffer: vi.fn(async (key) => {
      if (!files.has(key)) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
      return files.get(key);
    }),
  };
  const eventPublisher = {
    publish: vi.fn(async (type, data) => ({ messageId: crypto.randomUUID(), type, data })),
  };

  const deliveryService = new DeliveryService({
    deliveryRepository: fakes.deliveryRepository,
    s3Client,
    emailSender,
    eventPublisher,
    logger,
    retryDelayMs: 0,
  });
  const reminderService = new ReminderService({
    reminderRepository: fakes.reminderRepository,
    timeZone: 'Asia/Karachi',
    hour: 9,
    logger,
    now: nowFn,
  });
  const reminderScheduler = new ReminderScheduler({
    reminderRepository: fakes.reminderRepository,
    emailSender,
    logger,
    batchSize: 2,
  });

  return {
    ...fakes,
    logger,
    emailSender,
    s3Client,
    files,
    eventPublisher,
    deliveryService,
    reminderService,
    reminderScheduler,
    setNow: (date) => {
      clock = date;
    },
  };
}
