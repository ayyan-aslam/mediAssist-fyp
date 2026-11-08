import { AppError, errorHandler } from '@mediassist/common';
import express from 'express';
import { ConsultationController } from './controllers/ConsultationController.js';
import { PatientController } from './controllers/PatientController.js';
import { SoapNoteController } from './controllers/SoapNoteController.js';
import { createRouter } from './routes.js';
import { ConsultationService } from './services/ConsultationService.js';
import { PdfGenerator } from './services/PdfGenerator.js';
import { PatientService } from './services/PatientService.js';
import { PrescriptionSourceService } from './services/PrescriptionSourceService.js';
import { SoapNoteEditService } from './services/SoapNoteEditService.js';
import { SoapNoteHistoryService } from './services/SoapNoteHistoryService.js';
import { SoapNotePdfService } from './services/SoapNotePdfService.js';
import { RequestValidator } from './validators/RequestValidator.js';

// Repositories, the S3Client, the EventPublisher, the SseManager and the EditSessionStore are passed in,
// so tests can replace or check them.
export function createApp({
  logger,
  patientRepository,
  consultationRepository,
  transcriptRepository,
  soapNoteRepository,
  s3Client,
  eventPublisher,
  sseManager,
  editSessionStore,
}) {
  const requestValidator = new RequestValidator();
  const patientController = new PatientController({
    requestValidator,
    patientService: new PatientService({ patientRepository }),
  });
  const consultationController = new ConsultationController({
    requestValidator,
    consultationService: new ConsultationService({
      consultationRepository,
      patientRepository,
      transcriptRepository,
      s3Client,
      eventPublisher,
      logger,
    }),
    sseManager,
  });
  const soapNoteController = new SoapNoteController({
    requestValidator,
    soapNoteEditService: new SoapNoteEditService({ soapNoteRepository, editSessionStore, eventPublisher, logger }),
    soapNoteHistoryService: new SoapNoteHistoryService({ soapNoteRepository, patientRepository }),
    soapNotePdfService: new SoapNotePdfService({ soapNoteRepository, pdfGenerator: new PdfGenerator() }),
    prescriptionSourceService: new PrescriptionSourceService({ soapNoteRepository }),
  });

  const app = express();
  // A SOAP note PATCH can carry four parts of up to 10,000 characters each (3 bytes per Urdu letter).
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(createRouter({ patientController, consultationController, soapNoteController }));

  app.use(() => {
    throw new AppError(404, 'ROUTE_NOT_FOUND', 'This route does not exist.');
  });
  app.use(errorHandler(logger));
  return app;
}
