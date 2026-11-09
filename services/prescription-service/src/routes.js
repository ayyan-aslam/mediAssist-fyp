import { Router } from 'express';

// Endpoints: design doc Section 5.7.
export function createRouter({ prescriptionController }) {
  const router = Router();

  router.post('/prescriptions', prescriptionController.finalize);
  router.get('/prescriptions', prescriptionController.getByConsultation);
  router.get('/prescriptions/:prescriptionId', prescriptionController.getById);
  router.get('/prescriptions/:prescriptionId/pdf', prescriptionController.downloadPdf);
  router.get('/prescriptions/:prescriptionId/send-options', prescriptionController.getSendOptions);
  router.post('/prescriptions/:prescriptionId/send', prescriptionController.send);
  router.get('/prescriptions/:prescriptionId/deliveries', prescriptionController.listDeliveries);

  return router;
}
