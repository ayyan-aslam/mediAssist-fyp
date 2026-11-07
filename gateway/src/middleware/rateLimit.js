import { AppError } from '@mediassist/common';
import { rateLimit } from 'express-rate-limit';

function tooManyRequests(req, res, next) {
  next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many requests. Please wait a minute and try again.'));
}

// byUser: logged-in routes, counted per user ID. byIp: public routes, counted per client IP.
export function createRateLimiters(config) {
  const options = {
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: tooManyRequests,
  };

  return {
    byUser: rateLimit({
      ...options,
      limit: config.RATE_LIMIT_USER_MAX,
      keyGenerator: (req) => `user:${req.user.userId}`,
    }),
    // The default key is the client IP (with IPv6 grouped by subnet).
    byIp: rateLimit({ ...options, limit: config.RATE_LIMIT_PUBLIC_MAX }),
  };
}
