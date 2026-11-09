import { Router } from 'express';

// Endpoints: design doc Section 5.10.
export function createRouter({ auditController }) {
  const router = Router();

  router.get('/admin/audit-logs', auditController.list);

  return router;
}
