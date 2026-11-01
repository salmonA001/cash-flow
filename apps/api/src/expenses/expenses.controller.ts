import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Prisma } from '@cfe/database';
import { dateRangeQuery, expenseCreateSchema, paginationQuery, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

const expenseQuery = paginationQuery.extend(dateRangeQuery.shape).extend({ category: z.string().optional() });

@Controller('finance/expenses')
export class ExpensesController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('finance:read')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(expenseQuery)) q: z.infer<typeof expenseQuery>) {
    const where: Prisma.ExpenseWhereInput = {
      organizationId: user.organizationId,
      ...(q.category ? { category: q.category as Prisma.EnumExpenseCategoryFilter['equals'] } : {}),
      ...(q.q ? { OR: [{ description: { contains: q.q, mode: 'insensitive' } }, { vendor: { contains: q.q, mode: 'insensitive' } }] } : {}),
      incurredOn: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) },
    };
    const [items, total, byCategory] = await Promise.all([
      this.prisma.expense.findMany({ where, orderBy: orderBy(q, ['incurredOn', 'amount', 'createdAt'] as const, 'incurredOn'), ...pageArgs(q) }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.groupBy({ by: ['category', 'currency'], where, _sum: { amount: true } }),
    ]);
    return {
      ...paginated(items, total, q),
      byCategory: byCategory.map((c) => ({ category: c.category, currency: c.currency, amount: c._sum.amount?.toFixed(2) ?? '0.00' })),
    };
  }

  @Post()
  @RequirePermission('finance:write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(expenseCreateSchema)) body: z.infer<typeof expenseCreateSchema>) {
    const expense = await this.prisma.expense.create({
      data: { ...body, incurredOn: new Date(body.incurredOn), organizationId: user.organizationId, createdById: user.id },
    });
    // Summaries are computed from source records on read, so recording is the whole refresh.
    await this.prisma.automationRun.create({
      data: {
        organizationId: user.organizationId, trigger: 'expense.recorded', action: 'finance.refresh', level: 'AUTOMATIC', status: 'SUCCEEDED',
        subjectType: 'Expense', subjectId: expense.id, startedAt: new Date(), finishedAt: new Date(),
      },
    });
    await this.audit.log(user, 'expense.created', 'Expense', expense.id, body);
    return expense;
  }
}
