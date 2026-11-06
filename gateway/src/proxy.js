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

// Tells browsers and any proxy in front of the gateway not to cache, compress or buffer the stream.
function addSseHeaders(proxyRes) {
  proxyRes.headers['cache-control'] = 'no-cache, no-transform';
  proxyRes.headers['x-accel-buffering'] = 'no';
}

// Forwards a request to one service. The /api/v1 prefix is already removed by the router.
// sse: true for SSE streams. The response is piped as it arrives, with no timeout.
export function createServiceProxy({ target, logger, sse = false }) {
  return createProxyMiddleware({
    target,
    on: {
      proxyReq: addUserHeaders,
      ...(sse && { proxyRes: addSseHeaders }),
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
