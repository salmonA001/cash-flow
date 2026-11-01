import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { paginationQuery, PaginationQuery } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { found } from '../common/owned';
import { pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

@Controller()
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('audit-logs')
  @RequirePermission('audit:read')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationQuery)) q: PaginationQuery) {
    const where = { organizationId: user.organizationId, ...(q.q ? { action: { contains: q.q } } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.prisma.notification.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Get('review-tasks')
  reviewTasks(@CurrentUser() user: AuthUser) {
    return this.prisma.reviewTask.findMany({ where: { organizationId: user.organizationId, status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}

@Controller()
export class InboxController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Post('notifications/:id/read')
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    found(await this.prisma.notification.findFirst({ where: { id, organizationId: user.organizationId } }), 'Notification');
    await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  @Post('review-tasks/:id/resolve')
  async resolve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    found(await this.prisma.reviewTask.findFirst({ where: { id, organizationId: user.organizationId, status: 'OPEN' } }), 'Review task');
    const task = await this.prisma.reviewTask.update({ where: { id }, data: { status: 'RESOLVED', resolvedById: user.id, resolvedAt: new Date() } });
    await this.audit.log(user, 'review_task.resolved', 'ReviewTask', id);
    return task;
  }
}
