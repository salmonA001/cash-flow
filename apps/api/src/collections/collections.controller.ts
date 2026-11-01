import { Body, Controller, Get, Post } from '@nestjs/common';
import { collectionCreateSchema, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

@Controller('collections')
export class CollectionsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('designs:read')
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.collection.findMany({
      where: { organizationId: user.organizationId },
      include: { _count: { select: { designs: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @RequirePermission('designs:write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(collectionCreateSchema)) body: z.infer<typeof collectionCreateSchema>) {
    const c = await this.prisma.collection.create({ data: { organizationId: user.organizationId, ...body } });
    await this.audit.log(user, 'collection.created', 'Collection', c.id, { name: c.name });
    return c;
  }
}
