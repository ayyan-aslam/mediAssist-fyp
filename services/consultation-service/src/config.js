import { loadConfig } from '@mediassist/common';
import { z } from 'zod';

const envSchema = z.object({
  CONSULTATION_DATABASE_URL: z.url(),
  CONSULTATION_SERVICE_PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  // Amazon S3: the audio parts.
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_NAME: z.string().min(1),
});

export const config = loadConfig(envSchema);
