import { EventConsumer, RabbitConnection } from '@mediassist/common';
import { createApp } from './app.js';
import { UserClient } from './clients/UserClient.js';
import { config } from './config.js';
import { AuditEventConsumer } from './consumers/AuditEventConsumer.js';
import { createPrismaClient } from './db/prisma.js';
import { logger } from './logger.js';
import { AuditRepository } from './repositories/AuditRepository.js';
import { AuditService } from './services/AuditService.js';
import { MessageValidator } from './validators/MessageValidator.js';

// The config is checked on import (./config.js). Then RabbitMQ, then the HTTP server.
const prisma = createPrismaClient(config.AUDIT_DATABASE_URL);

const auditService = new AuditService({
  auditRepository: new AuditRepository(prisma),
  userClient: new UserClient({ baseUrl: config.AUTH_SERVICE_URL }),
  timeZone: config.AUDIT_TIMEZONE,
  logger,
});

// This service only connects: the Consultation Service creates the exchange and the queues (design doc 6.2.2).
// On the first start it saves all the events that have waited in audit.audit.event.
const rabbit = new RabbitConnection({ url: config.RABBITMQ_URL, logger });
new AuditEventConsumer({
  eventConsumer: new EventConsumer({ connection: rabbit, logger }),
  messageValidator: new MessageValidator(),
  auditService,
}).start();

await rabbit.start();

const app = createApp({ logger, auditService });

const server = app.listen(config.AUDIT_SERVICE_PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'Audit service could not start');
    process.exit(1);
  }
  logger.info(`Audit service listening on port ${config.AUDIT_SERVICE_PORT}`);
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
