import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@mediassist/common';
import { z } from 'zod';

// Relative file paths in .env are relative to the repo root, where .env lives.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// 32 random bytes in base64, as made by the command in the README.
const base64Key32 = z
  .base64()
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((key) => key.length === 32, 'must be 32 bytes in base64');

const envSchema = z.object({
  AUTH_DATABASE_URL: z.url(),
  AUTH_SERVICE_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  CNIC_ENCRYPTION_KEY: base64Key32,
  CNIC_HASH_KEY: base64Key32,
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_SERVICE_ACCOUNT_PATH: z
    .string()
    .min(1)
    .transform((value) => path.resolve(repoRoot, value)),
});

export const config = loadConfig(envSchema);
