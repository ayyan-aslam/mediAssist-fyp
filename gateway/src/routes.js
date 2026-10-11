import { Router } from 'express';
import { AuthMiddleware } from './middleware/AuthMiddleware.js';
import { createServiceProxy } from './proxy.js';

// Routes that need no access token. Paths are relative to /api/v1 (design doc Section 5.2).
const PUBLIC_ROUTES = new Set([
  'POST /auth/doctor/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'GET /specialties',
]);

export function isPublicRoute(req) {
  return PUBLIC_ROUTES.has(`${req.method} ${req.path}`);
}

// Mounted at /api/v1. Order: token check -> (Phase 1: block list, role check, rate limit) -> proxies.
export function createRouter({ config, logger }) {
  const router = Router();
  const authMiddleware = new AuthMiddleware({ jwtSecret: config.JWT_SECRET, isPublicRoute });

  router.use(authMiddleware.authenticate);

  router.use(
    createServiceProxy({
      target: config.AUTH_SERVICE_URL,
      pathFilter: (path) => path.startsWith('/auth/') || path === '/specialties',
      logger,
    }),
  );

  return router;
}
