import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { StorageService } from '@cfe/integration-sdk';
import argon2 from 'argon2';
import { AUTOMATION_CATALOG, DEFAULT_ROLES, PERMISSIONS } from '@cfe/business-rules';
import { PrismaClient } from '@cfe/database';
import { applyTestEnv, resetDatabase, TEST_DATABASE_URL } from './env';
import { FakeStorage } from './fake-storage';

export const PASSWORD = 'correct-horse-battery-staple';

export async function createTestApp() {
  applyTestEnv();
  await resetDatabase();
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const storage = new FakeStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StorageService).useValue(storage).compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] }));
  await app.init();
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  return { app, storage, prisma };
}

/** Same bootstrap the seed performs, parameterized for multiple orgs. */
export async function seedOrg(prisma: PrismaClient, slug: string, users: { email: string; role: keyof typeof DEFAULT_ROLES }[]) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key, description } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  const org = await prisma.organization.create({ data: { name: slug, slug } });
  const roles: Record<string, string> = {};
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.create({
      data: { organizationId: org.id, name, permissions: { create: def.permissions.map((k) => ({ permissionId: perms.get(k)! })) } },
    });
    roles[name] = role.id;
  }
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  for (const u of users) {
    await prisma.user.create({ data: { organizationId: org.id, email: u.email, name: u.email, roleId: roles[u.role], passwordHash: hash } });
  }
  for (const { key, name, trigger, action, level } of AUTOMATION_CATALOG) {
    await prisma.automationRule.create({ data: { organizationId: org.id, key, name, trigger, action, level } });
  }
  return { org, roles };
}
