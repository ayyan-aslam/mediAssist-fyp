import { AppError, errorHandler } from '@mediassist/common';
import express from 'express';
import { ConsultationController } from './controllers/ConsultationController.js';
import { PatientController } from './controllers/PatientController.js';
import { createRouter } from './routes.js';
import { ConsultationService } from './services/ConsultationService.js';
import { PatientService } from './services/PatientService.js';
import { RequestValidator } from './validators/RequestValidator.js';

// Repositories are passed in, so tests can replace them.
export function createApp({ logger, patientRepository, consultationRepository }) {
  const requestValidator = new RequestValidator();
  const patientController = new PatientController({
    requestValidator,
    patientService: new PatientService({ patientRepository }),
  });
  const consultationController = new ConsultationController({
    requestValidator,
    consultationService: new ConsultationService({ consultationRepository, patientRepository }),
  });

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(createRouter({ patientController, consultationController }));

  app.use(() => {
    throw new AppError(404, 'ROUTE_NOT_FOUND', 'This route does not exist.');
  });
  app.use(errorHandler(logger));
  return app;
}
