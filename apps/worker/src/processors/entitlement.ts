import { computeEntitlementExpiry, generateDownloadToken } from '@cfe/business-rules';
import type { WorkerContext } from '../context';

export class EntitlementNotAllowedError extends Error {}

/**
 * Creates (or completes delivery of) the download entitlement for a paid digital order item.
 * Payment is re-verified here from the stored order. If an earlier attempt created the
 * entitlement but the email never went out, the token is rotated and re-sent.
 */
export async function grantEntitlement(ctx: WorkerContext, orderItemId: string): Promise<{ entitlementId: string; emailed: boolean }> {
  const item = await ctx.prisma.orderItem.findUniqueOrThrow({
    where: { id: orderItemId },
    include: { order: { include: { customer: true } }, entitlement: true, variant: { include: { product: { include: { digitalProduct: true } } } } },
  });
  const digitalProduct = item.variant?.product.digitalProduct;
  if (item.itemType !== 'DIGITAL' || !digitalProduct) throw new EntitlementNotAllowedError('Order item is not a mapped digital product');
  if (item.order.paymentStatus !== 'PAID') throw new EntitlementNotAllowedError(`Order payment status is ${item.order.paymentStatus}`);
  const email = item.order.customer?.email;
  if (!email) throw new EntitlementNotAllowedError('Order has no customer email to deliver the download link to');

  if (item.entitlement?.emailSentAt) return { entitlementId: item.entitlement.id, emailed: false };

  const { token, tokenHash } = generateDownloadToken();
  const entitlement = item.entitlement
    ? await ctx.prisma.downloadEntitlement.update({ where: { id: item.entitlement.id }, data: { tokenHash } })
    : await ctx.prisma.downloadEntitlement.create({
        data: {
          organizationId: item.organizationId,
          digitalProductId: digitalProduct.id,
          orderItemId: item.id,
          customerId: item.order.customerId,
          email,
          tokenHash,
          maxDownloads: digitalProduct.maxDownloads,
          expiresAt: computeEntitlementExpiry(new Date(), digitalProduct.accessDays),
        },
      });

  const link = `${ctx.apiUrl}/api/v1/downloads/access/${token}`;
  await ctx.mailer.send({
    to: email,
    subject: `Your download: ${item.title}`,
    text: [
      `Thanks for your order ${item.order.orderNumber}.`,
      '',
      `Download "${item.title}" here:`,
      link,
      '',
      `This link works ${entitlement.maxDownloads} times and expires on ${entitlement.expiresAt.toISOString().slice(0, 10)}.`,
    ].join('\n'),
  });
  await ctx.prisma.downloadEntitlement.update({ where: { id: entitlement.id }, data: { emailSentAt: new Date() } });
  return { entitlementId: entitlement.id, emailed: true };
}
