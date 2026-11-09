import { AppError, errorHandler } from '@mediassist/common';
import express from 'express';

// The Notification Service has no API endpoints, only GET /health (design doc 5.9).
export function createApp({ logger }) {
  const app = express();

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(() => {
    throw new AppError(404, 'ROUTE_NOT_FOUND', 'This route does not exist.');
  });
  app.use(errorHandler(logger));
  return app;
}
