import { Router } from 'express';

// Endpoints: design doc Section 5.2.
export function createRouter({ authController, profileController, specialtyController }) {
  const router = Router();

  router.post('/auth/doctor/register', authController.register('doctor'));
  router.post('/auth/login', authController.login);
  router.post('/auth/refresh', authController.refresh);
  router.post('/auth/logout', authController.logout);

  router.get('/users/me', profileController.getMe);
  router.patch('/users/me', profileController.updateMe);

  router.get('/specialties', specialtyController.list);

  return router;
}
