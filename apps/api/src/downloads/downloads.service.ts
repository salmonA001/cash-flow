import { BadRequestException, ConflictException, GoneException, Injectable } from '@nestjs/common';
import { evaluateDownloadAccess, hashDownloadToken } from '@cfe/business-rules';
import { BucketName, StorageService } from '@cfe/integration-sdk';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { found } from '../common/owned';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';

const LINK_TTL_SECONDS = 60;

@Injectable()
export class DownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Requests an entitlement for a paid order item. Payment is verified here from the
   * server-side order record (never from a browser redirect) and again by the worker,
   * which creates the entitlement and emails the one-time link to the customer.
   */
  async grant(user: AuthUser, digitalProductId: string, orderItemId: string) {
    const item = found(
      await this.prisma.orderItem.findFirst({
        where: { id: orderItemId, organizationId: user.organizationId },
        include: { order: true, entitlement: true, variant: { include: { product: { include: { digitalProduct: true } } } } },
      }),
      'Order item',
    );
    if (item.itemType !== 'DIGITAL') throw new BadRequestException('Order item is not a digital product');
    if (item.variant?.product.digitalProduct?.id !== digitalProductId) throw new BadRequestException('Order item belongs to a different digital product');
    if (item.order.paymentStatus !== 'PAID') throw new ConflictException(`Order payment status is ${item.order.paymentStatus}; only PAID orders receive downloads`);
    if (item.entitlement) throw new ConflictException('An entitlement already exists for this order item');

    const run = await this.prisma.automationRun.create({
      data: {
        organizationId: user.organizationId, trigger: 'digital.payment_confirmed', action: 'entitlement.grant', level: 'AUTOMATIC',
        status: 'PENDING', subjectType: 'OrderItem', subjectId: orderItemId, input: { requestedBy: user.email },
      },
    });
    await this.queues.enqueueEntitlementGrant(orderItemId, run.id);
    await this.audit.log(user, 'entitlement.grant_requested', 'OrderItem', orderItemId, { automationRunId: run.id });
    return { status: 'QUEUED', automationRunId: run.id };
  }

  async revoke(user: AuthUser, entitlementId: string, reason: string) {
    const ent = found(await this.prisma.downloadEntitlement.findFirst({ where: { id: entitlementId, organizationId: user.organizationId } }), 'Entitlement');
    if (ent.status === 'REVOKED') throw new ConflictException('Entitlement is already revoked');
    const updated = await this.prisma.downloadEntitlement.update({
      where: { id: entitlementId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason },
    });
    await this.audit.log(user, 'entitlement.revoked', 'DownloadEntitlement', entitlementId, { reason });
    return updated;
  }

  /**
   * Public, token-authenticated download. The count is consumed with a conditional update, so
   * concurrent requests cannot exceed the limit. Returns a 60-second presigned URL.
   */
  async access(token: string, meta: { ip?: string; userAgent?: string }): Promise<string> {
    const ent = await this.prisma.downloadEntitlement.findUnique({
      where: { tokenHash: hashDownloadToken(token) },
      include: { digitalProduct: { include: { assets: { where: { isCurrent: true } } } } },
    });
    if (!ent) throw new GoneException('This download link is invalid');

    const now = new Date();
    let decision = evaluateDownloadAccess(ent, now);
    if (decision === 'GRANTED') {
      const consumed = await this.prisma.downloadEntitlement.updateMany({
        where: { id: ent.id, status: 'ACTIVE', expiresAt: { gt: now }, downloadCount: { lt: ent.maxDownloads } },
        data: { downloadCount: { increment: 1 } },
      });
      if (consumed.count !== 1) decision = 'DENIED_LIMIT';
    }
    await this.prisma.downloadEvent.create({
      data: { organizationId: ent.organizationId, entitlementId: ent.id, outcome: decision, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
    });
    if (decision !== 'GRANTED') {
      const messages = { DENIED_EXPIRED: 'This download link has expired', DENIED_LIMIT: 'Download limit reached', DENIED_REVOKED: 'Access to this download was revoked' };
      throw new GoneException(messages[decision]);
    }
    const asset = ent.digitalProduct.assets[0];
    if (!asset) throw new GoneException('No file is available for this product yet');
    return this.storage.presignedGet(asset.bucket as BucketName, asset.objectKey, LINK_TTL_SECONDS, asset.fileName);
  }
}
