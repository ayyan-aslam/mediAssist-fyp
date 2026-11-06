import { loadConfig } from '@mediassist/common';
import { z } from 'zod';

const envSchema = z.object({
  CONSULTATION_DATABASE_URL: z.url(),
  CONSULTATION_SERVICE_PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
});

export const config = loadConfig(envSchema);
