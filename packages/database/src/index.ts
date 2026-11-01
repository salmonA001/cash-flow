import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
