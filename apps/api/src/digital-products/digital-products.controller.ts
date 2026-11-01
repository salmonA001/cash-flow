import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFile as UploadedFileParam, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { buildObjectKey, BUCKETS, DIGITAL_FILE_POLICY, StorageService, validateFile } from '@cfe/integration-sdk';
import { digitalProductCreateSchema, paginationQuery, PaginationQuery, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { found } from '../common/owned';
import { pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import type { UploadedFile } from '../designs/designs.service';

@Controller('digital-products')
export class DigitalProductsController {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('digital:read')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationQuery)) q: PaginationQuery) {
    const where = { organizationId: user.organizationId, ...(q.q ? { product: { title: { contains: q.q, mode: 'insensitive' as const } } } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.digitalProduct.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        include: {
          product: { include: { variants: true } },
          assets: { where: { isCurrent: true } },
          _count: { select: { entitlements: true } },
        },
      }),
      this.prisma.digitalProduct.count({ where }),
    ]);
    return paginated(items, total, q);
  }

  @Get(':id')
  @RequirePermission('digital:read')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return found(
      await this.prisma.digitalProduct.findFirst({
        where: { id, organizationId: user.organizationId },
        include: {
          product: { include: { variants: true } },
          assets: { orderBy: { version: 'desc' } },
          entitlements: { orderBy: { createdAt: 'desc' }, take: 100, include: { events: { orderBy: { createdAt: 'desc' }, take: 5 } } },
        },
      }),
      'Digital product',
    );
  }

  @Post()
  @RequirePermission('digital:write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(digitalProductCreateSchema)) body: z.infer<typeof digitalProductCreateSchema>) {
    const dp = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: user.organizationId,
          type: 'DIGITAL',
          title: body.title,
          description: body.description,
          variants: {
            create: {
              organizationId: user.organizationId,
              sku: body.sku,
              price: body.price,
              currency: body.currency,
              shopifyVariantId: body.shopifyVariantId,
            },
          },
        },
      });
      return tx.digitalProduct.create({
        data: { organizationId: user.organizationId, productId: product.id, maxDownloads: body.maxDownloads, accessDays: body.accessDays },
        include: { product: { include: { variants: true } } },
      });
    });
    await this.audit.log(user, 'digital_product.created', 'DigitalProduct', dp.id, { title: body.title });
    return dp;
  }

  /** Uploads a new file version; earlier versions are kept but no longer served. */
  @Post(':id/files')
  @RequirePermission('digital:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DIGITAL_FILE_POLICY.maxBytes, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFileParam() file: UploadedFile | undefined) {
    if (!file) throw new BadRequestException('A file is required (multipart field "file")');
    try {
      validateFile(file, DIGITAL_FILE_POLICY);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const dp = found(await this.prisma.digitalProduct.findFirst({ where: { id, organizationId: user.organizationId } }), 'Digital product');
    const stored = await this.storage.putObject(
      BUCKETS.digitalProducts,
      buildObjectKey(user.organizationId, 'digital-products', dp.id, file.originalname),
      file.buffer,
      file.mimetype,
    );
    const asset = await this.prisma.$transaction(async (tx) => {
      const last = await tx.downloadAsset.findFirst({ where: { digitalProductId: id }, orderBy: { version: 'desc' } });
      await tx.downloadAsset.updateMany({ where: { digitalProductId: id }, data: { isCurrent: false } });
      return tx.downloadAsset.create({
        data: {
          organizationId: user.organizationId,
          digitalProductId: id,
          version: (last?.version ?? 0) + 1,
          bucket: stored.bucket,
          objectKey: stored.objectKey,
          fileName: file.originalname,
          contentType: file.mimetype,
          sizeBytes: stored.sizeBytes,
          checksumSha256: stored.checksumSha256,
        },
      });
    });
    await this.audit.log(user, 'digital_product.file_uploaded', 'DigitalProduct', id, { version: asset.version, checksumSha256: asset.checksumSha256 });
    return asset;
  }
}
