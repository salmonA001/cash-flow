import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@cfe/database';
import { dateRangeQuery, z } from '@cfe/validation';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { resolvePeriod } from '../finance/finance.controller';

/**
 * Performance analytics in original currencies (rows are per currency, never summed across).
 * Converted, profit-level numbers live in /finance.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('designs')
  @RequirePermission('analytics:read')
  async designs(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dateRangeQuery)) q: z.infer<typeof dateRangeQuery>) {
    const { from, to } = resolvePeriod(q);
    return this.prisma.$queryRaw<{ designId: string; title: string; currency: string; shopifySales: string; shopifyUnits: number; royalties: string; merchUnits: number }[]>(Prisma.sql`
      WITH store AS (
        SELECT p."designId", o.currency,
               SUM(oi."unitPrice" * oi.quantity - oi."totalDiscount") AS sales, SUM(oi.quantity)::int AS units
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        JOIN "ProductVariant" v ON v.id = oi."variantId"
        JOIN "Product" p ON p.id = v."productId"
        WHERE o."organizationId" = ${user.organizationId} AND p."designId" IS NOT NULL
          AND o."paymentStatus" IN ('PAID','PARTIALLY_REFUNDED') AND o."placedAt" BETWEEN ${from} AND ${to}
        GROUP BY 1, 2
      ), merch AS (
        SELECT l."designId", r.currency, SUM(r."royaltyAmount") AS royalties, SUM(r."unitsSold")::int AS units
        FROM "RoyaltyTransaction" r JOIN "MarketplaceListing" l ON l.id = r."listingId"
        WHERE r."organizationId" = ${user.organizationId} AND l."designId" IS NOT NULL
          AND r."transactionDate" BETWEEN ${from} AND ${to}
        GROUP BY 1, 2
      )
      SELECT d.id AS "designId", d.title, COALESCE(s.currency, m.currency) AS currency,
             COALESCE(s.sales, 0)::text AS "shopifySales", COALESCE(s.units, 0) AS "shopifyUnits",
             COALESCE(m.royalties, 0)::text AS royalties, COALESCE(m.units, 0) AS "merchUnits"
      FROM store s FULL OUTER JOIN merch m ON m."designId" = s."designId" AND m.currency = s.currency
      JOIN "Design" d ON d.id = COALESCE(s."designId", m."designId")
      ORDER BY COALESCE(s.units, 0) + COALESCE(m.units, 0) DESC
      LIMIT 50`);
  }

  @Get('products')
  @RequirePermission('analytics:read')
  async products(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dateRangeQuery)) q: z.infer<typeof dateRangeQuery>) {
    const { from, to } = resolvePeriod(q);
    return this.prisma.$queryRaw<{ productId: string; title: string; type: string; currency: string; sales: string; units: number; orders: number }[]>(Prisma.sql`
      SELECT p.id AS "productId", p.title, p.type, o.currency,
             SUM(oi."unitPrice" * oi.quantity - oi."totalDiscount")::text AS sales,
             SUM(oi.quantity)::int AS units, COUNT(DISTINCT o.id)::int AS orders
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "ProductVariant" v ON v.id = oi."variantId"
      JOIN "Product" p ON p.id = v."productId"
      WHERE o."organizationId" = ${user.organizationId}
        AND o."paymentStatus" IN ('PAID','PARTIALLY_REFUNDED') AND o."placedAt" BETWEEN ${from} AND ${to}
      GROUP BY p.id, p.title, p.type, o.currency
      ORDER BY units DESC
      LIMIT 50`);
  }
}
