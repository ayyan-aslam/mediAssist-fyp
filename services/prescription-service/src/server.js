import { EventConsumer, EventPublisher, RabbitConnection } from '@mediassist/common';
import { createApp } from './app.js';
import { ConsultationClient } from './clients/ConsultationClient.js';
import { S3Client } from './clients/S3Client.js';
import { config } from './config.js';
import { createPrismaClient } from './db/prisma.js';
import { logger } from './logger.js';
import { PrescriptionRepository } from './repositories/PrescriptionRepository.js';
import { PrescriptionPdf } from './services/PrescriptionPdf.js';
import { PrescriptionService } from './services/PrescriptionService.js';
import { RequestValidator } from './validators/RequestValidator.js';

// The config is checked on import (./config.js). Then RabbitMQ, then the HTTP server.
const prisma = createPrismaClient(config.PRESCRIPTION_DATABASE_URL);

// This service only connects: the Consultation Service creates the exchange and the queues (design doc 6.2.2).
// Until it has, reading the queue fails and amqplib connects again.
const rabbit = new RabbitConnection({ url: config.RABBITMQ_URL, logger });
const eventPublisher = new EventPublisher({ connection: rabbit, source: 'prescription-service', logger });

const prescriptionService = new PrescriptionService({
  prescriptionRepository: new PrescriptionRepository(prisma),
  consultationClient: new ConsultationClient({ baseUrl: config.CONSULTATION_SERVICE_URL }),
  prescriptionPdf: new PrescriptionPdf(),
  s3Client: new S3Client({
    region: config.AWS_REGION,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    bucket: config.S3_BUCKET_NAME,
  }),
  eventPublisher,
  logger,
});

// The result of each send from the Notification Service (design doc 6.4.8, Diagram 9).
const requestValidator = new RequestValidator();
const eventConsumer = new EventConsumer({ connection: rabbit, logger });
eventConsumer.consume('prescription.delivery.result', ({ data }) =>
  prescriptionService.saveDeliveryResult(requestValidator.validateDeliveryResult(data)),
);

await rabbit.start();

const app = createApp({ logger, prescriptionService });

const server = app.listen(config.PRESCRIPTION_SERVICE_PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'Prescription service could not start');
    process.exit(1);
  }
  logger.info(`Prescription service listening on port ${config.PRESCRIPTION_SERVICE_PORT}`);
});

function shutdown() {
  server.close(async () => {
    await rabbit.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
