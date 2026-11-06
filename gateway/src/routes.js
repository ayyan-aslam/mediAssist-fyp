import { Router } from 'express';
import { AuthMiddleware } from './middleware/AuthMiddleware.js';
import { prepareSse } from './middleware/prepareSse.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { requireRole } from './middleware/requireRole.js';
import { createServiceProxy } from './proxy.js';
import { isSseRoute, PUBLIC, ROUTES } from './routeTable.js';

// Mounted at /api/v1. Every route comes from the route table.
// Public route: rate limit by IP -> proxy.
// Logged-in route: token check -> role check -> rate limit by user -> (SSE: prepareSse) -> proxy.
export function createRouter({ config, logger }) {
  const router = Router();
  const authMiddleware = new AuthMiddleware({ jwtSecret: config.JWT_SECRET });
  const rateLimiters = createRateLimiters(config);
  const serviceUrls = {
    auth: config.AUTH_SERVICE_URL,
    consultation: config.CONSULTATION_SERVICE_URL,
  };

  const proxies = new Map();
  function proxyFor(service, sse) {
    const key = `${service}:${sse}`;
    if (!proxies.has(key)) {
      proxies.set(key, createServiceProxy({ target: serviceUrls[service], logger, sse }));
    }
    return proxies.get(key);
  }

  for (const route of ROUTES) {
    const sse = isSseRoute(route);
    const handlers =
      route.roles === PUBLIC
        ? [rateLimiters.byIp]
        : [
            sse ? authMiddleware.authenticateSse : authMiddleware.authenticate,
            requireRole(route.roles),
            rateLimiters.byUser,
            ...(sse ? [prepareSse] : []),
          ];
    router[route.method.toLowerCase()](route.path, ...handlers, proxyFor(route.service, sse));
  }

  // Unknown route: ask for a token first, so a caller without one learns nothing about the routes.
  // With a valid token, the request goes on to the 404 handler of the app.
  router.use(authMiddleware.authenticate);

  return router;
}
