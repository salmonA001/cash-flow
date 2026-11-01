/**
 * Idempotent bootstrap: permission catalog, first organization, default roles,
 * owner account and built-in automation rules. Creates NO financial data.
 */
import argon2 from 'argon2';
import { AUTOMATION_CATALOG, DEFAULT_ROLES, PERMISSIONS } from '@cfe/business-rules';
import { createPrismaClient } from './index';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to seed the database`);
  return value;
}

async function main() {
  const prisma = createPrismaClient(required('DATABASE_URL'));
  const email = required('SEED_ADMIN_EMAIL').toLowerCase();
  const password = required('SEED_ADMIN_PASSWORD');
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
  const orgName = process.env.SEED_ORG_NAME ?? 'Cash Flow Engine';

  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const org = await prisma.organization.upsert({ where: { slug }, update: {}, create: { name: orgName, slug } });

  const permissions = await prisma.permission.findMany();
  const permId = new Map(permissions.map((p) => [p.key, p.id]));
  const roleIds: Record<string, string> = {};
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: { description: def.description },
      create: { organizationId: org.id, name, description: def.description },
    });
    roleIds[name] = role.id;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: def.permissions.map((key) => ({ roleId: role.id, permissionId: permId.get(key)! })),
    });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        organizationId: org.id,
        email,
        name: 'Owner',
        roleId: roleIds.Owner,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
  }

  for (const { key, name, trigger, action, level } of AUTOMATION_CATALOG) {
    await prisma.automationRule.upsert({
      where: { organizationId_key: { organizationId: org.id, key } },
      update: { name, trigger, action, level },
      create: { organizationId: org.id, key, name, trigger, action, level },
    });
  }

  console.log(`Seeded organization "${org.name}" (${org.id}); owner: ${email}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
