import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = createApp({ config, logger });

const server = app.listen(config.GATEWAY_PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'API Gateway could not start');
    process.exit(1);
  }
  logger.info(`API Gateway listening on port ${config.GATEWAY_PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
