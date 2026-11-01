import { BadRequestException, Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { classifyOrderItem } from '@cfe/business-rules';
import { Prisma } from '@cfe/database';
import { orderListQuery, orderUpdateSchema, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { found } from '../common/owned';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { ZodPipe } from '../common/zod.pipe';

@Controller('orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService, private readonly queues: QueueService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('orders:read')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(orderListQuery)) q: z.infer<typeof orderListQuery>) {
    const where: Prisma.OrderWhereInput = {
      organizationId: user.organizationId,
      ...(q.paymentStatus ? { paymentStatus: q.paymentStatus } : {}),
      ...(q.itemType ? { items: { some: { itemType: q.itemType } } } : {}),
      ...(q.q ? { OR: [{ orderNumber: { contains: q.q, mode: 'insensitive' } }, { customer: { email: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: orderBy(q, ['placedAt', 'total', 'orderNumber'] as const, 'placedAt'),
        ...pageArgs(q),
        include: {
          customer: { select: { id: true, email: true, name: true } },
          items: { select: { itemType: true, quantity: true } },
          fulfillments: { select: { id: true, status: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  @Get(':id')
  @RequirePermission('orders:read')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return found(
      await this.prisma.order.findFirst({
        where: { id, organizationId: user.organizationId },
        include: {
          customer: true,
          items: { include: { variant: { include: { product: { select: { id: true, title: true, type: true } } } }, entitlement: { select: { id: true, status: true, downloadCount: true, maxDownloads: true, expiresAt: true } } } },
          payments: { orderBy: { processedAt: 'asc' } },
          refunds: { orderBy: { processedAt: 'asc' } },
          fulfillments: { include: { events: { orderBy: { createdAt: 'asc' } } } },
        },
      }),
      'Order',
    );
  }

  /** Maps unclassified line items to internal variants, reclassifies, then re-runs the order workflow. */
  @Patch(':id')
  @RequirePermission('orders:write')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(orderUpdateSchema)) body: z.infer<typeof orderUpdateSchema>) {
    const order = found(await this.prisma.order.findFirst({ where: { id, organizationId: user.organizationId }, include: { items: true } }), 'Order');
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: body.itemMappings.map((m) => m.variantId) }, organizationId: user.organizationId },
      include: { product: { select: { type: true } } },
    });
    await this.prisma.$transaction(
      body.itemMappings.map((m) => {
        if (!order.items.some((i) => i.id === m.orderItemId)) throw new BadRequestException(`Item ${m.orderItemId} is not on this order`);
        const variant = variants.find((v) => v.id === m.variantId);
        if (!variant) throw new BadRequestException(`Variant ${m.variantId} not found`);
        return this.prisma.orderItem.update({
          where: { id: m.orderItemId },
          data: { variantId: variant.id, itemType: classifyOrderItem({ productType: variant.product.type }) },
        });
      }),
    );
    await this.audit.log(user, 'order.items_mapped', 'Order', id, body);
    await this.queues.enqueueOrderWorkflow(id);
    return this.get(user, id);
  }
}
