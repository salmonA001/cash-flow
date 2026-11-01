import { BadRequestException, ConflictException, Controller, Get, HttpCode, Post, Query, UploadedFile as UploadedFileParam, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { parseMerchReport } from '@cfe/business-rules';
import { Prisma } from '@cfe/database';
import { buildObjectKey, BUCKETS, CSV_FILE_POLICY, StorageService, validateFile } from '@cfe/integration-sdk';
import { dateRangeQuery, paginationQuery, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { ZodPipe } from '../common/zod.pipe';
import type { UploadedFile } from '../designs/designs.service';

const royaltyQuery = paginationQuery.extend(dateRangeQuery.shape).extend({ marketplace: z.string().optional() });

function readCsv(file: UploadedFile | undefined) {
  if (!file) throw new BadRequestException('A CSV file is required (multipart field "file")');
  try {
    validateFile(file, CSV_FILE_POLICY);
    return parseMerchReport(file.buffer.toString('utf8'));
  } catch (err) {
    throw new BadRequestException((err as Error).message);
  }
}

@Controller('amazon-merch')
export class AmazonMerchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
  ) {}

  /** Validates a report without storing anything. */
  @Post('reports/preview')
  @HttpCode(200)
  @RequirePermission('amazon:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CSV_FILE_POLICY.maxBytes, files: 1 } }))
  async preview(@CurrentUser() user: AuthUser, @UploadedFileParam() file: UploadedFile | undefined) {
    const parsed = readCsv(file);
    const existing = await this.prisma.royaltyTransaction.count({
      where: { organizationId: user.organizationId, rowHash: { in: parsed.rows.map((r) => r.rowHash) } },
    });
    return {
      formatId: parsed.formatId,
      validRows: parsed.rows.length,
      alreadyImported: existing,
      duplicateRowsInFile: parsed.duplicateRowNumbers,
      errors: parsed.errors,
      sample: parsed.rows.slice(0, 25),
    };
  }

  /** Archives the original file and queues the import. Re-uploading an identical file is rejected. */
  @Post('reports/import')
  @HttpCode(202)
  @RequirePermission('amazon:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CSV_FILE_POLICY.maxBytes, files: 1 } }))
  async import(@CurrentUser() user: AuthUser, @UploadedFileParam() file: UploadedFile | undefined) {
    const parsed = readCsv(file);
    const f = file!;
    const checksum = createHash('sha256').update(f.buffer).digest('hex');
    const duplicate = await this.prisma.amazonReportImport.findUnique({
      where: { organizationId_checksumSha256: { organizationId: user.organizationId, checksumSha256: checksum } },
    });
    if (duplicate) throw new ConflictException(`This exact file was already imported on ${duplicate.createdAt.toISOString().slice(0, 10)}`);

    const stored = await this.storage.putObject(
      BUCKETS.reportArchives,
      buildObjectKey(user.organizationId, 'amazon-merch', 'reports', f.originalname),
      f.buffer,
      'text/csv',
    );
    const record = await this.prisma.amazonReportImport.create({
      data: {
        organizationId: user.organizationId,
        formatId: parsed.formatId,
        fileName: f.originalname,
        bucket: stored.bucket,
        objectKey: stored.objectKey,
        checksumSha256: checksum,
        uploadedById: user.id,
      },
    });
    await this.queues.enqueueAmazonImport(record.id);
    await this.audit.log(user, 'amazon_report.uploaded', 'AmazonReportImport', record.id, { fileName: f.originalname });
    return record;
  }

  @Get('imports')
  @RequirePermission('amazon:read')
  imports(@CurrentUser() user: AuthUser) {
    return this.prisma.amazonReportImport.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Get('royalties')
  @RequirePermission('amazon:read')
  async royalties(@CurrentUser() user: AuthUser, @Query(new ZodPipe(royaltyQuery)) q: z.infer<typeof royaltyQuery>) {
    const where: Prisma.RoyaltyTransactionWhereInput = {
      organizationId: user.organizationId,
      ...(q.marketplace ? { marketplace: q.marketplace } : {}),
      ...(q.q ? { OR: [{ asin: { contains: q.q.toUpperCase() } }, { title: { contains: q.q, mode: 'insensitive' } }] } : {}),
      transactionDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) },
    };
    const [items, total, byCurrency] = await Promise.all([
      this.prisma.royaltyTransaction.findMany({
        where,
        orderBy: orderBy(q, ['transactionDate', 'royaltyAmount', 'unitsSold'] as const, 'transactionDate'),
        ...pageArgs(q),
        include: { listing: { select: { id: true, design: { select: { id: true, title: true } } } } },
      }),
      this.prisma.royaltyTransaction.count({ where }),
      this.prisma.royaltyTransaction.groupBy({ by: ['currency'], where, _sum: { royaltyAmount: true, unitsSold: true, unitsReturned: true } }),
    ]);
    return {
      ...paginated(items, total, q),
      totals: byCurrency.map((t) => ({
        currency: t.currency,
        royalties: t._sum.royaltyAmount?.toFixed(2) ?? '0.00',
        unitsSold: t._sum.unitsSold ?? 0,
        unitsReturned: t._sum.unitsReturned ?? 0,
      })),
    };
  }

  /** Royalties per design (via listing mapping) and per month, kept per currency. */
  @Get('royalties/summary')
  @RequirePermission('amazon:read')
  async summary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dateRangeQuery)) q: z.infer<typeof dateRangeQuery>) {
    const range = Prisma.sql`${q.from ? Prisma.sql`AND r."transactionDate" >= ${new Date(q.from)}` : Prisma.empty} ${q.to ? Prisma.sql`AND r."transactionDate" <= ${new Date(q.to)}` : Prisma.empty}`;
    const byDesign = await this.prisma.$queryRaw<{ designId: string | null; title: string | null; currency: string; royalties: string; units: bigint }[]>`
      SELECT d.id AS "designId", d.title, r.currency, SUM(r."royaltyAmount")::text AS royalties, SUM(r."unitsSold") AS units
      FROM "RoyaltyTransaction" r
      LEFT JOIN "MarketplaceListing" l ON l.id = r."listingId"
      LEFT JOIN "Design" d ON d.id = l."designId"
      WHERE r."organizationId" = ${user.organizationId} ${range}
      GROUP BY d.id, d.title, r.currency
      ORDER BY SUM(r."royaltyAmount") DESC
      LIMIT 50`;
    const byMonth = await this.prisma.$queryRaw<{ month: string; currency: string; royalties: string; units: bigint }[]>`
      SELECT to_char(date_trunc('month', r."transactionDate"), 'YYYY-MM') AS month, r.currency,
             SUM(r."royaltyAmount")::text AS royalties, SUM(r."unitsSold") AS units
      FROM "RoyaltyTransaction" r
      WHERE r."organizationId" = ${user.organizationId} ${range}
      GROUP BY 1, 2 ORDER BY 1`;
    const unmapped = await this.prisma.royaltyTransaction.groupBy({
      by: ['asin', 'marketplace'],
      where: { organizationId: user.organizationId, listingId: null },
      _sum: { unitsSold: true },
    });
    return {
      byDesign: byDesign.map((r) => ({ ...r, units: Number(r.units) })),
      byMonth: byMonth.map((r) => ({ ...r, units: Number(r.units) })),
      unmappedAsins: unmapped.map((u) => ({ asin: u.asin, marketplace: u.marketplace, units: u._sum.unitsSold ?? 0 })),
    };
  }

  @Get('payouts')
  @RequirePermission('amazon:read')
  payouts(@CurrentUser() user: AuthUser) {
    return this.prisma.payout.findMany({ where: { organizationId: user.organizationId, source: 'AMAZON_MERCH' }, orderBy: { periodEnd: 'desc' } });
  }
}
