import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@cfe/database';
import { productCreateSchema, productListQuery, productUpdateSchema, variantSchema, variantUpdateSchema, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { found } from '../common/owned';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(orgId: string, q: z.infer<typeof productListQuery>) {
    const where: Prisma.ProductWhereInput = {
      organizationId: orgId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { variants: { some: { sku: { contains: q.q, mode: 'insensitive' } } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: orderBy(q, ['title', 'createdAt', 'updatedAt'] as const, 'updatedAt'),
        ...pageArgs(q),
        include: { design: { select: { id: true, title: true } }, variants: true, _count: { select: { listings: true } } },
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  async get(orgId: string, id: string) {
    return found(
      await this.prisma.product.findFirst({
        where: { id, organizationId: orgId },
        include: { design: true, variants: { orderBy: { sku: 'asc' } }, listings: true, digitalProduct: true },
      }),
      'Product',
    );
  }

  private async assertDesign(orgId: string, designId: string | null | undefined) {
    if (designId) found(await this.prisma.design.findFirst({ where: { id: designId, organizationId: orgId } }), 'Design');
  }

  private async assertPrintFile(orgId: string, assetId: string | undefined) {
    if (!assetId) return;
    const asset = found(await this.prisma.designAsset.findFirst({ where: { id: assetId, organizationId: orgId } }), 'Print file asset');
    if (asset.kind !== 'PRINT_FILE') throw new BadRequestException('printFileAssetId must reference a PRINT_FILE asset');
  }

  async create(user: AuthUser, body: z.infer<typeof productCreateSchema>) {
    await this.assertDesign(user.organizationId, body.designId);
    for (const v of body.variants) await this.assertPrintFile(user.organizationId, v.printFileAssetId);
    const { variants, ...fields } = body;
    const product = await this.prisma.product.create({
      data: {
        organizationId: user.organizationId,
        type: 'POD',
        ...fields,
        variants: { create: variants.map((v) => ({ ...v, organizationId: user.organizationId })) },
      },
      include: { variants: true },
    });
    await this.audit.log(user, 'product.created', 'Product', product.id, { title: product.title });
    return product;
  }

  async update(user: AuthUser, id: string, body: z.infer<typeof productUpdateSchema>) {
    found(await this.prisma.product.findFirst({ where: { id, organizationId: user.organizationId } }), 'Product');
    await this.assertDesign(user.organizationId, body.designId);
    const product = await this.prisma.product.update({ where: { id }, data: body });
    await this.audit.log(user, 'product.updated', 'Product', id, body);
    return product;
  }

  async addVariant(user: AuthUser, productId: string, body: z.infer<typeof variantSchema>) {
    found(await this.prisma.product.findFirst({ where: { id: productId, organizationId: user.organizationId } }), 'Product');
    await this.assertPrintFile(user.organizationId, body.printFileAssetId);
    const variant = await this.prisma.productVariant.create({ data: { ...body, productId, organizationId: user.organizationId } });
    await this.audit.log(user, 'variant.created', 'ProductVariant', variant.id, { sku: variant.sku });
    return variant;
  }

  /** Variant mapping: Printful variant, print file and Shopify variant. */
  async updateVariant(user: AuthUser, productId: string, variantId: string, body: z.infer<typeof variantUpdateSchema>) {
    found(await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, organizationId: user.organizationId } }), 'Variant');
    await this.assertPrintFile(user.organizationId, body.printFileAssetId);
    const variant = await this.prisma.productVariant.update({ where: { id: variantId }, data: body });
    await this.audit.log(user, 'variant.updated', 'ProductVariant', variantId, body);
    return variant;
  }
}
