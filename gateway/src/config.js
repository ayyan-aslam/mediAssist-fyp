import { loadConfig } from '@mediassist/common';
import { z } from 'zod';

const envSchema = z.object({
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  FRONTEND_URL: z.url(),
  AUTH_SERVICE_URL: z.url(),
  CONSULTATION_SERVICE_URL: z.url(),
  PRESCRIPTION_SERVICE_URL: z.url(),
  // Number of proxies (for example a load balancer) in front of the gateway, so req.ip is the real client IP.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_USER_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().default(60),
});

export const config = loadConfig(envSchema);
