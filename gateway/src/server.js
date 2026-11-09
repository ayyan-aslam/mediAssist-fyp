import { EventConsumer, RabbitConnection } from '@mediassist/common';
import { createApp } from './app.js';
import { BlockListStore } from './BlockListStore.js';
import { config } from './config.js';
import { GatewayEventConsumer } from './GatewayEventConsumer.js';
import { logger } from './logger.js';

// The gateway only connects: the Consultation Service creates the exchange and the queues (design doc 6.2.2).
// RabbitConnection starts in the background, so the gateway also starts when RabbitMQ is down.
const blockListStore = new BlockListStore();
const rabbit = new RabbitConnection({ url: config.RABBITMQ_URL, logger });
new GatewayEventConsumer({
  eventConsumer: new EventConsumer({ connection: rabbit, logger }),
  blockListStore,
  logger,
}).start();

await rabbit.start();

const app = createApp({ config, logger, blockListStore });

const server = app.listen(config.GATEWAY_PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'API Gateway could not start');
    process.exit(1);
  }
  logger.info(`API Gateway listening on port ${config.GATEWAY_PORT}`);
});

function shutdown() {
  server.close(async () => {
    await rabbit.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
