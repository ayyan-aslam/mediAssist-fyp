import { RabbitConnection, setupTopology } from '@mediassist/common';
import { createApp } from './app.js';
import { config } from './config.js';
import { createPrismaClient } from './db/prisma.js';
import { logger } from './logger.js';
import { ConsultationRepository } from './repositories/ConsultationRepository.js';
import { PatientRepository } from './repositories/PatientRepository.js';

// The config is checked on import (./config.js). Then RabbitMQ, then the HTTP server.
const prisma = createPrismaClient(config.CONSULTATION_DATABASE_URL);

// This service creates the exchange and all queues (design doc 6.2.2). setupTopology() runs again after
// every reconnect. The server waits for the first run, so no message is sent before its queue exists.
const rabbit = new RabbitConnection({ url: config.RABBITMQ_URL, logger });
const topologyReady = new Promise((resolve) => {
  rabbit.onConnect(async (model) => {
    await setupTopology(model);
    logger.info('RabbitMQ exchange and queues are ready');
    resolve();
  });
});
await rabbit.start();
logger.info('Waiting for RabbitMQ to create the exchange and queues');
await topologyReady;

const app = createApp({
  logger,
  patientRepository: new PatientRepository(prisma),
  consultationRepository: new ConsultationRepository(prisma),
});

const server = app.listen(config.CONSULTATION_SERVICE_PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'Consultation service could not start');
    process.exit(1);
  }
  logger.info(`Consultation service listening on port ${config.CONSULTATION_SERVICE_PORT}`);
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
