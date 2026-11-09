// Sends the follow-up reminders now, without waiting for the every-minute job (for testing and the demo).
//
//   npm run reminders:send -w services/notification-service             (only the reminders that are due)
//   npm run reminders:send -w services/notification-service -- --all    (every pending reminder)
//
// Safe while the service runs: each reminder is claimed once, so none is sent twice.
import { parseArgs } from 'node:util';
import { EmailSender } from '../src/clients/EmailSender.js';
import { config } from '../src/config.js';
import { createPrismaClient } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import { ReminderRepository } from '../src/repositories/ReminderRepository.js';
import { ReminderScheduler } from '../src/services/ReminderScheduler.js';

const { values } = parseArgs({ options: { all: { type: 'boolean', default: false } } });

const prisma = createPrismaClient(config.NOTIFICATION_DATABASE_URL);
const reminderScheduler = new ReminderScheduler({
  reminderRepository: new ReminderRepository(prisma),
  emailSender: new EmailSender({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER,
    pass: config.SMTP_PASS,
    from: config.SMTP_FROM,
  }),
  logger,
});

try {
  const { sent, failed } = await reminderScheduler.sendDue({ all: values.all });
  console.log(`Reminders sent: ${sent}, failed: ${failed}.`);
} finally {
  await prisma.$disconnect();
}
