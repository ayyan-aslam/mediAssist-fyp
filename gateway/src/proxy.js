import { createProxyMiddleware } from 'http-proxy-middleware';

// Adds the user and the client IP for the service.
// The name is URL-encoded, because HTTP headers cannot hold every character (for example Urdu).
function addUserHeaders(proxyReq, req) {
  proxyReq.setHeader('x-user-ip', req.ip);
  if (req.user) {
    proxyReq.setHeader('x-user-id', String(req.user.userId));
    proxyReq.setHeader('x-user-role', req.user.role);
    proxyReq.setHeader('x-user-name', encodeURIComponent(req.user.name ?? ''));
    proxyReq.setHeader('x-user-email', req.user.email ?? '');
  }
}

// Forwards the matching requests to one service. The /api/v1 prefix is already removed by the router.
export function createServiceProxy({ target, pathFilter, logger }) {
  return createProxyMiddleware({
    target,
    pathFilter,
    on: {
      proxyReq: addUserHeaders,
      error: (err, req, res) => {
        logger.error({ err, method: req.method, url: req.originalUrl, target }, 'Service is not responding');
        if (!res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
        }
        res.end(
          JSON.stringify({
            error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is not responding. Please try again.' },
          }),
        );
      },
    },
  });
}
