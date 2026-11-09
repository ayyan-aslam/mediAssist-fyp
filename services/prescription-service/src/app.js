import { AppError, errorHandler } from '@mediassist/common';
import express from 'express';
import { PrescriptionController } from './controllers/PrescriptionController.js';
import { createRouter } from './routes.js';
import { RequestValidator } from './validators/RequestValidator.js';

// The PrescriptionService is passed in, because server.js also uses it for delivery.result, and so tests
// can give it fake repositories and clients.
export function createApp({ logger, prescriptionService }) {
  const prescriptionController = new PrescriptionController({
    requestValidator: new RequestValidator(),
    prescriptionService,
  });

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(createRouter({ prescriptionController }));

  app.use(() => {
    throw new AppError(404, 'ROUTE_NOT_FOUND', 'This route does not exist.');
  });
  app.use(errorHandler(logger));
  return app;
}
