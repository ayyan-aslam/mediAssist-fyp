import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

// The Prisma CLI does not read .env files, so load the root .env when it exists.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No .env file: the variables must already be set.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: env('AUTH_DATABASE_URL'),
  },
});
