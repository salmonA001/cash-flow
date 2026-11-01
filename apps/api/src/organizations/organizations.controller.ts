import { Body, Controller, Get, Patch } from '@nestjs/common';
import { organizationUpdateSchema, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

@Controller('organization')
export class OrganizationsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  }

  @Patch()
  @RequirePermission('settings:write')
  async update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(organizationUpdateSchema)) body: z.infer<typeof organizationUpdateSchema>) {
    const org = await this.prisma.organization.update({ where: { id: user.organizationId }, data: body });
    await this.audit.log(user, 'organization.updated', 'Organization', org.id, body);
    return org;
  }
}
