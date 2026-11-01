import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import argon2 from 'argon2';
import { userCreateSchema, userUpdateSchema, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { found } from '../common/owned';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

const publicUser = { id: true, email: true, name: true, isActive: true, lastLoginAt: true, createdAt: true, role: { select: { id: true, name: true } } } as const;

@Controller()
export class UsersController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get('users')
  @RequirePermission('users:write')
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findMany({ where: { organizationId: user.organizationId }, select: publicUser, orderBy: { createdAt: 'asc' } });
  }

  @Get('roles')
  roles(@CurrentUser() user: AuthUser) {
    return this.prisma.role.findMany({
      where: { organizationId: user.organizationId },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
      orderBy: { name: 'asc' },
    });
  }

  @Post('users')
  @RequirePermission('users:write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(userCreateSchema)) body: z.infer<typeof userCreateSchema>) {
    found(await this.prisma.role.findFirst({ where: { id: body.roleId, organizationId: user.organizationId } }), 'Role');
    const created = await this.prisma.user.create({
      data: {
        organizationId: user.organizationId,
        email: body.email,
        name: body.name,
        roleId: body.roleId,
        passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }),
      },
      select: publicUser,
    });
    await this.audit.log(user, 'user.created', 'User', created.id, { email: created.email });
    return created;
  }

  @Patch('users/:id')
  @RequirePermission('users:write')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(userUpdateSchema)) body: z.infer<typeof userUpdateSchema>) {
    found(await this.prisma.user.findFirst({ where: { id, organizationId: user.organizationId } }), 'User');
    if (body.roleId) found(await this.prisma.role.findFirst({ where: { id: body.roleId, organizationId: user.organizationId } }), 'Role');
    const updated = await this.prisma.user.update({ where: { id }, data: body, select: publicUser });
    if (body.isActive === false) await this.prisma.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log(user, 'user.updated', 'User', id, body);
    return updated;
  }
}
