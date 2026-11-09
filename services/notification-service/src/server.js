import { EventConsumer, EventPublisher, RabbitConnection } from '@mediassist/common';
import { createApp } from './app.js';
import { EmailSender } from './clients/EmailSender.js';
import { S3Client } from './clients/S3Client.js';
import { config } from './config.js';
import { createPrismaClient } from './db/prisma.js';
import { logger } from './logger.js';
import { DeliveryRepository } from './repositories/DeliveryRepository.js';
import { ReminderRepository } from './repositories/ReminderRepository.js';
import { DeliveryService } from './services/DeliveryService.js';
import { ReminderScheduler } from './services/ReminderScheduler.js';
import { ReminderService } from './services/ReminderService.js';
import { MessageValidator } from './validators/MessageValidator.js';

// The config is checked on import (./config.js). Then SMTP, RabbitMQ, the reminder job and the HTTP server.
const prisma = createPrismaClient(config.NOTIFICATION_DATABASE_URL);

const emailSender = new EmailSender({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  user: config.SMTP_USER,
  pass: config.SMTP_PASS,
  from: config.SMTP_FROM,
});
// Only a warning: the service still reads its queues, and each email that fails is saved as failed.
emailSender.verify().then(
  () => logger.info({ host: config.SMTP_HOST }, 'SMTP connection works'),
  (err) =>
    logger.warn(
      { err, host: config.SMTP_HOST, port: config.SMTP_PORT },
      'Could not connect to the SMTP server. Emails will fail until SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASS are right.',
    ),
);

// This service only connects: the Consultation Service creates the exchange and the queues (design doc 6.2.2).
const rabbit = new RabbitConnection({ url: config.RABBITMQ_URL, logger });
const eventPublisher = new EventPublisher({ connection: rabbit, source: 'notification-service', logger });
const reminderRepository = new ReminderRepository(prisma);

const deliveryService = new DeliveryService({
  deliveryRepository: new DeliveryRepository(prisma),
  s3Client: new S3Client({
    region: config.AWS_REGION,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    bucket: config.S3_BUCKET_NAME,
  }),
  emailSender,
  eventPublisher,
  logger,
});
const reminderService = new ReminderService({
  reminderRepository,
  timeZone: config.REMINDER_TIMEZONE,
  hour: config.REMINDER_HOUR,
  logger,
});

const messageValidator = new MessageValidator();
const eventConsumer = new EventConsumer({ connection: rabbit, logger });
eventConsumer.consume(
  'notification.prescription.send',
  ({ messageId, data }) => deliveryService.handlePrescriptionSend(messageId, messageValidator.validatePrescriptionSend(data)),
  {
    onDeadLetter: ({ messageId, data }) =>
      deliveryService.handleDeadLetter(messageId, messageValidator.validatePrescriptionSend(data)),
  },
);
eventConsumer.consume('notification.followup.changed', ({ data }) =>
  reminderService.handleFollowUpChanged(messageValidator.validateFollowUpChanged(data)),
);

await rabbit.start();

const reminderScheduler = new ReminderScheduler({ reminderRepository, emailSender, logger });
reminderScheduler.start();

const app = createApp({ logger });

const server = app.listen(config.NOTIFICATION_SERVICE_PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'Notification service could not start');
    process.exit(1);
  }
  logger.info(`Notification service listening on port ${config.NOTIFICATION_SERVICE_PORT}`);
});

function shutdown() {
  reminderScheduler.stop();
  server.close(async () => {
    await rabbit.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
