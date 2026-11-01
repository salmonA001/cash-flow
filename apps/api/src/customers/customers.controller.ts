import { Controller, Get, Param, Query } from '@nestjs/common';
import { Prisma } from '@cfe/database';
import { paginationQuery, PaginationQuery } from '@cfe/validation';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { found } from '../common/owned';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

@Controller('customers')
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('orders:read')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationQuery)) q: PaginationQuery) {
    const where: Prisma.CustomerWhereInput = {
      organizationId: user.organizationId,
      ...(q.q ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({ where, orderBy: orderBy(q, ['createdAt', 'email', 'name'] as const, 'createdAt'), ...pageArgs(q), include: { _count: { select: { orders: true } } } }),
      this.prisma.customer.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  @Get(':id')
  @RequirePermission('orders:read')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return found(
      await this.prisma.customer.findFirst({
        where: { id, organizationId: user.organizationId },
        include: {
          orders: { orderBy: { placedAt: 'desc' }, select: { id: true, orderNumber: true, total: true, currency: true, paymentStatus: true, placedAt: true } },
          entitlements: { select: { id: true, status: true, digitalProduct: { select: { product: { select: { title: true } } } } } },
        },
      }),
      'Customer',
    );
  }
}
