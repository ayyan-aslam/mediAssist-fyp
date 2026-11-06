import { Router } from 'express';
import { audioUpload } from './middleware/audioUpload.js';

// Endpoints: design doc Section 5.5.
export function createRouter({ patientController, consultationController }) {
  const router = Router();

  router.post('/clinical-patients', patientController.create);
  router.get('/clinical-patients', patientController.findByPhone);
  router.get('/clinical-patients/:patientId', patientController.getById);
  router.patch('/clinical-patients/:patientId', patientController.update);

  router.post('/consultations', consultationController.start);
  router.post('/consultations/:consultationId/audio-parts', audioUpload, consultationController.uploadPart);
  router.post('/consultations/:consultationId/stop', consultationController.stop);
  router.post('/consultations/:consultationId/retry', consultationController.retry);
  router.get('/consultations/:consultationId', consultationController.getById);

  router.get('/internal/consultations/:consultationId/patient-contact', consultationController.getPatientContact);

  return router;
}
