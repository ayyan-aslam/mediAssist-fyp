import { AppError, errorHandler } from '@mediassist/common';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { stripUserHeaders } from './middleware/stripUserHeaders.js';
import { createRouter } from './routes.js';

// No express.json() here: the gateway passes the request body to the service as it is.
export function createApp({ config, logger }) {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.FRONTEND_URL }));
  app.use(stripUserHeaders);

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/v1', createRouter({ config, logger }));

  app.use(() => {
    throw new AppError(404, 'ROUTE_NOT_FOUND', 'This route does not exist.');
  });
  app.use(errorHandler(logger));
  return app;
}
