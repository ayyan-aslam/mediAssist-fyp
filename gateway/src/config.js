import { loadConfig } from '@mediassist/common';
import { z } from 'zod';

const envSchema = z.object({
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  FRONTEND_URL: z.url(),
  AUTH_SERVICE_URL: z.url(),
});

export const config = loadConfig(envSchema);
