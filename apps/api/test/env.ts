import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@cfe/database';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://cfe:cfe@localhost:5432/cfe_test?schema=public';

/** Test configuration. Postgres and Redis are real; object storage is an in-memory double. */
export function applyTestEnv() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    COOKIE_SECURE: 'false',
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_PUBLIC_ENDPOINT: 'http://localhost:9000',
    MINIO_ACCESS_KEY: 'test',
    MINIO_SECRET_KEY: 'testtesttest',
    SHOPIFY_CLIENT_ID: 'test-client-id',
    SHOPIFY_CLIENT_SECRET: 'test-shopify-secret',
    PRINTFUL_WEBHOOK_SECRET: 'test-printful-webhook-secret-0000',
  });
}

/**
 * Recreates the disposable test schema and applies migrations.
 * Refuses to run against any database whose name does not end in "_test".
 */
export async function resetDatabase() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  await prisma.$disconnect();
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../../../packages/database'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
