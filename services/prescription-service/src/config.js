import { loadConfig } from '@mediassist/common';
import { z } from 'zod';

const envSchema = z.object({
  PRESCRIPTION_DATABASE_URL: z.url(),
  PRESCRIPTION_SERVICE_PORT: z.coerce.number().int().positive().default(3003),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  // The Consultation Service internal API: prescription-source and patient-contact (design doc 5.5).
  CONSULTATION_SERVICE_URL: z.url(),
  // Amazon S3: the prescription PDFs.
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_NAME: z.string().min(1),
});

export const config = loadConfig(envSchema);
