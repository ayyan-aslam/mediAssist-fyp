import { loadConfig } from '@mediassist/common';
import { z } from 'zod';

const isTimeZone = (value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const envSchema = z.object({
  NOTIFICATION_DATABASE_URL: z.url(),
  NOTIFICATION_SERVICE_PORT: z.coerce.number().int().positive().default(3004),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  // Amazon S3: the prescription PDFs.
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_NAME: z.string().min(1),
  // Email over Gmail SMTP (nodemailer).
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z.stringbool(),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().min(1),
  // Follow-up reminders go out at this hour, one day before the follow-up date.
  REMINDER_TIMEZONE: z.string().refine(isTimeZone, 'Not a valid time zone, for example Asia/Karachi').default('Asia/Karachi'),
  REMINDER_HOUR: z.coerce.number().int().min(0).max(23).default(9),
});

export const config = loadConfig(envSchema);
