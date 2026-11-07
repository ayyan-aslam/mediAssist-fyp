import { Router } from 'express';
import { audioUpload } from './middleware/audioUpload.js';

// Endpoints: design doc Section 5.5.
export function createRouter({ patientController, consultationController, soapNoteController }) {
  const router = Router();

  router.post('/clinical-patients', patientController.create);
  router.get('/clinical-patients', patientController.findOrList);
  router.get('/clinical-patients/:patientId', patientController.getById);
  router.patch('/clinical-patients/:patientId', patientController.update);
  router.get('/clinical-patients/:patientId/soap-notes', soapNoteController.listForPatient);
  router.get('/soap-notes', soapNoteController.listRecent);
  router.get('/soap-notes/search', soapNoteController.search);

  router.post('/consultations', consultationController.start);
  // Before /consultations/:consultationId, so "events" is not read as an ID.
  router.get('/consultations/events', consultationController.events);
  router.post('/consultations/:consultationId/audio-parts', audioUpload, consultationController.uploadPart);
  router.post('/consultations/:consultationId/stop', consultationController.stop);
  router.post('/consultations/:consultationId/retry', consultationController.retry);
  router.get('/consultations/:consultationId', consultationController.getById);
  router.delete('/consultations/:consultationId', consultationController.discard);
  router.get('/consultations/:consultationId/soap-note', soapNoteController.getSoapNote);
  router.patch('/consultations/:consultationId/soap-note', soapNoteController.updateSoapNote);
  router.post('/consultations/:consultationId/soap-note/finish-editing', soapNoteController.finishEditing);
  router.get('/consultations/:consultationId/soap-note/pdf', soapNoteController.downloadPdf);

  router.get('/internal/consultations/:consultationId/patient-contact', consultationController.getPatientContact);

  return router;
}
