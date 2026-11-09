import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

// The Prisma CLI does not read .env files, so load the root .env when it exists.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No .env file: the variables must already be set.
}

// Migrations run as audit_owner, the owner of the AuditDB tables. The service itself runs as
// audit_service (AUDIT_DATABASE_URL), which can only SELECT and INSERT.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('AUDIT_MIGRATION_DATABASE_URL'),
  },
});
