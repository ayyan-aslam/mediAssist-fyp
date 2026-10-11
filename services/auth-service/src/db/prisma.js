import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.ts';

// The pg driver ignores ?schema= in the URL, so pass the schema to the adapter.
export function createPrismaClient(databaseUrl) {
  const schema = new URL(databaseUrl).searchParams.get('schema') ?? undefined;
  const adapter = new PrismaPg({ connectionString: databaseUrl }, { schema });
  return new PrismaClient({ adapter });
}
