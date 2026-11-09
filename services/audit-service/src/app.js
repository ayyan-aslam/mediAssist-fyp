import { AppError, errorHandler } from '@mediassist/common';
import express from 'express';
import { AuditController } from './controllers/AuditController.js';
import { createRouter } from './routes.js';
import { RequestValidator } from './validators/RequestValidator.js';

// The AuditService is passed in, because server.js also uses it for audit.event, and so tests can give it
// a fake repository and client.
export function createApp({ logger, auditService }) {
  const auditController = new AuditController({ requestValidator: new RequestValidator(), auditService });

  const app = express();

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(createRouter({ auditController }));

  app.use(() => {
    throw new AppError(404, 'ROUTE_NOT_FOUND', 'This route does not exist.');
  });
  app.use(errorHandler(logger));
  return app;
}
