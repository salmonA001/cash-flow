import { ConflictException, Injectable } from '@nestjs/common';
import { checkFulfillmentEligibility, ShippingAddress } from '@cfe/business-rules';
import { FulfillmentStatus, Prisma } from '@cfe/database';
import { fulfillmentListQuery, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { found } from '../common/owned';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';

const SUBMITTABLE: FulfillmentStatus[] = ['AWAITING_APPROVAL', 'APPROVED'];
/** NEEDS_REVIEW = outcome unknown after a timeout. Retrying is safe because the worker
 *  looks the order up by its idempotency key before creating anything. */
const RETRYABLE: FulfillmentStatus[] = ['FAILED', 'NEEDS_REVIEW'];

@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService, private readonly queues: QueueService, private readonly audit: AuditService) {}

  async list(orgId: string, q: z.infer<typeof fulfillmentListQuery>) {
    const where: Prisma.FulfillmentOrderWhereInput = {
      organizationId: orgId,
      ...(q.status ? { status: q.status as FulfillmentStatus } : {}),
      ...(q.q ? { order: { orderNumber: { contains: q.q, mode: 'insensitive' } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.fulfillmentOrder.findMany({
        where,
        orderBy: orderBy(q, ['createdAt', 'updatedAt', 'status'] as const, 'createdAt'),
        ...pageArgs(q),
        include: { order: { select: { id: true, orderNumber: true, paymentStatus: true, placedAt: true } }, events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
      this.prisma.fulfillmentOrder.count({ where }),
    ]);
    const counts = await this.prisma.fulfillmentOrder.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: true });
    return { ...paginated(items, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])) };
  }

  private async preflight(orgId: string, id: string, allowed: FulfillmentStatus[]) {
    const fo = found(
      await this.prisma.fulfillmentOrder.findFirst({
        where: { id, organizationId: orgId },
        include: { order: { include: { items: { include: { variant: true } } } }, organization: true },
      }),
      'Fulfillment',
    );
    if (!allowed.includes(fo.status)) throw new ConflictException(`Fulfillment is ${fo.status}; expected one of ${allowed.join(', ')}`);
    if (fo.organization.demoMode) throw new ConflictException('Demo mode is on: live fulfillment submission is disabled');
    const credential = await this.prisma.integrationCredential.findUnique({ where: { organizationId_provider: { organizationId: orgId, provider: 'PRINTFUL' } } });
    if (credential?.status !== 'CONNECTED') throw new ConflictException('Printful is not connected');

    const eligibility = checkFulfillmentEligibility({
      order: { status: fo.order.status, paymentStatus: fo.order.paymentStatus, shippingAddress: fo.order.shippingAddress as ShippingAddress | null },
      items: fo.order.items.map((i) => ({
        itemType: i.itemType,
        quantity: i.quantity,
        printfulVariantId: i.variant?.printfulVariantId ?? null,
        printFileUrl: i.variant?.printFileAssetId ?? null,
      })),
      existingFulfillmentStatus: null,
    });
    if (!eligibility.eligible) throw new ConflictException({ message: 'Order is not eligible for fulfillment', details: eligibility.reasons });
    return fo;
  }

  /**
   * Human approval + submission. The status transition is a compare-and-set so double clicks
   * or concurrent approvers cannot enqueue two submissions.
   */
  async submit(user: AuthUser, id: string) {
    await this.preflight(user.organizationId, id, SUBMITTABLE);
    return this.transitionAndEnqueue(user, id, SUBMITTABLE, 'fulfillment.submitted');
  }

  async retry(user: AuthUser, id: string) {
    await this.preflight(user.organizationId, id, RETRYABLE);
    return this.transitionAndEnqueue(user, id, RETRYABLE, 'fulfillment.retried');
  }

  private async transitionAndEnqueue(user: AuthUser, id: string, from: FulfillmentStatus[], action: string) {
    const run = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.fulfillmentOrder.updateMany({
        where: { id, organizationId: user.organizationId, status: { in: from } },
        data: { status: 'SUBMITTING', approvedById: user.id, approvedAt: new Date(), lastError: null },
      });
      if (moved.count !== 1) throw new ConflictException('Fulfillment changed state concurrently; refresh and try again');
      await tx.fulfillmentEvent.create({ data: { organizationId: user.organizationId, fulfillmentOrderId: id, type: action, message: `Approved by ${user.email}` } });
      return tx.automationRun.create({
        data: {
          organizationId: user.organizationId, trigger: 'fulfillment.approved', action: 'printful.create_order', level: 'APPROVAL_REQUIRED',
          status: 'PENDING', subjectType: 'FulfillmentOrder', subjectId: id, approvedById: user.id, approvedAt: new Date(),
        },
      });
    });
    await this.queues.enqueueFulfillmentSubmit({ fulfillmentOrderId: id, automationRunId: run.id });
    await this.audit.log(user, action, 'FulfillmentOrder', id, { automationRunId: run.id });
    return { status: 'SUBMITTING', automationRunId: run.id };
  }
}
