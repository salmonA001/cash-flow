import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AUTOMATION_CATALOG, AUTOMATION_TRIGGERS, CUSTOM_RULE_ACTIONS } from '@cfe/business-rules';
import { AutomationRunStatus, Prisma } from '@cfe/database';
import { automationRuleCreateSchema, automationRuleUpdateSchema, paginationQuery, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { found } from '../common/owned';
import { pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { ZodPipe } from '../common/zod.pipe';

const runsQuery = paginationQuery.extend({ status: z.enum(['PENDING', 'AWAITING_APPROVAL', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED']).optional() });
const catalog = new Map(AUTOMATION_CATALOG.map((a) => [a.key, a]));

@Controller('automation')
export class AutomationController {
  constructor(private readonly prisma: PrismaService, private readonly queues: QueueService, private readonly audit: AuditService) {}

  @Get('rules')
  @RequirePermission('automation:read')
  async rules(@CurrentUser() user: AuthUser) {
    const rules = await this.prisma.automationRule.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: 'asc' } });
    return {
      rules: rules.map((r) => ({ ...r, builtIn: catalog.has(r.key), toggleable: catalog.get(r.key)?.toggleable ?? true })),
      triggers: AUTOMATION_TRIGGERS,
      customActions: CUSTOM_RULE_ACTIONS,
    };
  }

  /** Custom rules react to built-in triggers with notifications or review tasks only. */
  @Post('rules')
  @RequirePermission('automation:write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(automationRuleCreateSchema)) body: z.infer<typeof automationRuleCreateSchema>) {
    if (catalog.has(body.key)) throw new ConflictException('Key is reserved by a built-in automation');
    if (!AUTOMATION_TRIGGERS.includes(body.trigger)) throw new BadRequestException(`Unknown trigger "${body.trigger}"`);
    if (!(CUSTOM_RULE_ACTIONS as readonly string[]).includes(body.action)) throw new BadRequestException(`Unsupported action "${body.action}"`);
    if (body.level !== 'AUTOMATIC') throw new BadRequestException('Custom rules only perform internal, automatic actions');
    const rule = await this.prisma.automationRule.create({
      data: { ...body, config: body.config as Prisma.InputJsonValue, organizationId: user.organizationId },
    });
    await this.audit.log(user, 'automation_rule.created', 'AutomationRule', rule.id, { key: rule.key });
    return rule;
  }

  @Patch('rules/:id')
  @RequirePermission('automation:write')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(automationRuleUpdateSchema)) body: z.infer<typeof automationRuleUpdateSchema>) {
    const rule = found(await this.prisma.automationRule.findFirst({ where: { id, organizationId: user.organizationId } }), 'Rule');
    if (body.enabled !== undefined && catalog.get(rule.key)?.toggleable === false) {
      throw new ConflictException('This automation is a core workflow step and cannot be disabled');
    }
    const updated = await this.prisma.automationRule.update({
      where: { id },
      data: { name: body.name, enabled: body.enabled, config: body.config as Prisma.InputJsonValue | undefined },
    });
    await this.audit.log(user, 'automation_rule.updated', 'AutomationRule', id, body as Prisma.InputJsonValue);
    return updated;
  }

  @Get('runs')
  @RequirePermission('automation:read')
  async runs(@CurrentUser() user: AuthUser, @Query(new ZodPipe(runsQuery)) q: z.infer<typeof runsQuery>) {
    const where: Prisma.AutomationRunWhereInput = {
      organizationId: user.organizationId,
      ...(q.status ? { status: q.status as AutomationRunStatus } : {}),
      ...(q.q ? { OR: [{ trigger: { contains: q.q } }, { action: { contains: q.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.automationRun.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include: { rule: { select: { name: true } } } }),
      this.prisma.automationRun.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  /**
   * Manual retry of a failed, idempotent job. Live fulfillment has its own guarded retry
   * (/fulfillment/:id/retry) and is refused here.
   */
  @Post('runs/:id/retry')
  @HttpCode(202)
  @RequirePermission('automation:write')
  async retry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const run = found(await this.prisma.automationRun.findFirst({ where: { id, organizationId: user.organizationId } }), 'Run');
    if (run.status !== 'FAILED') throw new ConflictException(`Only FAILED runs can be retried (run is ${run.status})`);
    if (!run.subjectId) throw new ConflictException('Run has no subject to retry');
    switch (run.subjectType) {
      case 'IntegrationEvent':
        await this.prisma.integrationEvent.update({ where: { id: run.subjectId }, data: { status: 'RECEIVED', error: null } });
        await this.queues.enqueueIntegrationEvent(run.subjectId);
        break;
      case 'AmazonReportImport':
        await this.prisma.amazonReportImport.update({ where: { id: run.subjectId }, data: { status: 'PENDING' } });
        await this.queues.enqueueAmazonImport(run.subjectId);
        break;
      case 'Order':
        await this.queues.enqueueOrderWorkflow(run.subjectId);
        break;
      case 'OrderItem': {
        const retryRun = await this.prisma.automationRun.create({
          data: { organizationId: user.organizationId, trigger: run.trigger, action: run.action, level: run.level, subjectType: 'OrderItem', subjectId: run.subjectId, input: { retryOf: run.id } },
        });
        await this.queues.enqueueEntitlementGrant(run.subjectId, retryRun.id);
        break;
      }
      default:
        throw new ConflictException(`Runs for ${run.subjectType} cannot be retried here`);
    }
    await this.audit.log(user, 'automation_run.retried', 'AutomationRun', id);
    return { status: 'QUEUED' };
  }
}
