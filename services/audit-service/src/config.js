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
  // Runtime login audit_service: SELECT and INSERT only. Migrations use AUDIT_MIGRATION_DATABASE_URL.
  AUDIT_DATABASE_URL: z.url(),
  AUDIT_SERVICE_PORT: z.coerce.number().int().positive().default(3005),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  // The Auth & User Service internal API: user names and roles (GET /internal/users, design doc 5.2).
  AUTH_SERVICE_URL: z.url(),
  // The from and to dates of GET /admin/audit-logs are whole days in this time zone.
  AUDIT_TIMEZONE: z.string().refine(isTimeZone, 'Not a valid time zone, for example Asia/Karachi').default('Asia/Karachi'),
});

export const config = loadConfig(envSchema);
