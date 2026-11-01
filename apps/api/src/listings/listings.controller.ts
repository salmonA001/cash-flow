import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@cfe/database';
import { listingCreateSchema, listingListQuery, listingUpdateSchema, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { found } from '../common/owned';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

@Controller('listings')
export class ListingsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('products:read')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listingListQuery)) q: z.infer<typeof listingListQuery>) {
    const where: Prisma.MarketplaceListingWhereInput = {
      organizationId: user.organizationId,
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.status ? { status: q.status as Prisma.EnumListingStatusFilter['equals'] } : {}),
      ...(q.q ? { OR: [{ externalId: { contains: q.q, mode: 'insensitive' } }, { design: { title: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.marketplaceListing.findMany({
        where,
        orderBy: orderBy(q, ['createdAt', 'updatedAt', 'marketplace'] as const, 'updatedAt'),
        ...pageArgs(q),
        include: { design: { select: { id: true, title: true } }, product: { select: { id: true, title: true } } },
      }),
      this.prisma.marketplaceListing.count({ where }),
    ]);
    // Listing performance: royalties per listing, kept per currency (never summed across currencies).
    const perf = await this.prisma.royaltyTransaction.groupBy({
      by: ['listingId', 'currency'],
      where: { organizationId: user.organizationId, listingId: { in: items.map((i) => i.id) } },
      _sum: { royaltyAmount: true, unitsSold: true },
    });
    return paginated(
      items.map((l) => ({
        ...l,
        royalties: perf
          .filter((p) => p.listingId === l.id)
          .map((p) => ({ currency: p.currency, amount: p._sum.royaltyAmount?.toFixed(2) ?? '0.00', units: p._sum.unitsSold ?? 0 })),
      })),
      total,
      q,
    );
  }

  /** Listings may only reference APPROVED designs (IP review gate). */
  private async assertRefs(orgId: string, body: { designId?: string; productId?: string }) {
    if (body.designId) {
      const design = found(await this.prisma.design.findFirst({ where: { id: body.designId, organizationId: orgId } }), 'Design');
      if (design.status !== 'APPROVED') throw new BadRequestException('Design must be APPROVED before it can be listed');
    }
    if (body.productId) found(await this.prisma.product.findFirst({ where: { id: body.productId, organizationId: orgId } }), 'Product');
  }

  @Post()
  @RequirePermission('products:write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(listingCreateSchema)) body: z.infer<typeof listingCreateSchema>) {
    if (body.channel === 'AMAZON_MERCH' && !body.designId) throw new BadRequestException('Amazon Merch listings must reference a design');
    if (body.channel === 'SHOPIFY' && !body.productId) throw new BadRequestException('Shopify listings must reference a product');
    await this.assertRefs(user.organizationId, body);
    const listing = await this.prisma.marketplaceListing.create({
      data: { organizationId: user.organizationId, ...body, publishedAt: body.status === 'LIVE' ? new Date() : null },
    });
    if (listing.channel === 'AMAZON_MERCH') {
      // Royalties imported before the listing existed are matched to it now (by ASIN + marketplace).
      await this.prisma.royaltyTransaction.updateMany({
        where: { organizationId: user.organizationId, asin: listing.externalId.toUpperCase(), marketplace: listing.marketplace, listingId: null },
        data: { listingId: listing.id },
      });
    }
    await this.audit.log(user, 'listing.created', 'MarketplaceListing', listing.id, body);
    return listing;
  }

  @Patch(':id')
  @RequirePermission('products:write')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(listingUpdateSchema)) body: z.infer<typeof listingUpdateSchema>) {
    const existing = found(await this.prisma.marketplaceListing.findFirst({ where: { id, organizationId: user.organizationId } }), 'Listing');
    await this.assertRefs(user.organizationId, body);
    const goingLive = body.status === 'LIVE' && existing.status !== 'LIVE';
    const listing = await this.prisma.marketplaceListing.update({ where: { id }, data: { ...body, ...(goingLive ? { publishedAt: new Date() } : {}) } });
    await this.audit.log(user, 'listing.updated', 'MarketplaceListing', id, body);
    return listing;
  }
}
