import { parseMerchReport } from '@cfe/business-rules';
import { BucketName } from '@cfe/integration-sdk';
import { runAutomation } from '../automation/engine';
import type { WorkerContext } from '../context';

/**
 * Imports an archived Amazon Merch report. Rows are deduplicated by (organization, rowHash)
 * so overlapping reports and re-runs never double-count royalties.
 */
export async function importAmazonReport(ctx: WorkerContext, importId: string): Promise<void> {
  const record = await ctx.prisma.amazonReportImport.findUniqueOrThrow({ where: { id: importId } });
  if (record.status === 'COMPLETED') return;
  const organizationId = record.organizationId;

  await runAutomation(ctx, 'amazon.report.import', { organizationId, subjectType: 'AmazonReportImport', subjectId: importId }, async () => {
    await ctx.prisma.amazonReportImport.update({ where: { id: importId }, data: { status: 'PROCESSING' } });
    try {
      const csv = (await ctx.storage.getObject(record.bucket as BucketName, record.objectKey)).toString('utf8');
      const parsed = parseMerchReport(csv);

      const listings = await ctx.prisma.marketplaceListing.findMany({
        where: { organizationId, channel: 'AMAZON_MERCH', externalId: { in: [...new Set(parsed.rows.map((r) => r.asin))] } },
      });
      const listingFor = (asin: string, marketplace: string) => listings.find((l) => l.externalId.toUpperCase() === asin && l.marketplace === marketplace)?.id ?? null;

      const created = await ctx.prisma.royaltyTransaction.createMany({
        data: parsed.rows.map((r) => ({
          organizationId,
          importId,
          listingId: listingFor(r.asin, r.marketplace),
          marketplace: r.marketplace,
          asin: r.asin,
          title: r.title,
          productType: r.productType,
          transactionDate: new Date(`${r.transactionDate}T00:00:00Z`),
          unitsSold: r.unitsSold,
          unitsReturned: r.unitsReturned,
          royaltyAmount: r.royaltyAmount,
          currency: r.currency,
          rowHash: r.rowHash,
        })),
        skipDuplicates: true,
      });
      const summary = {
        status: 'COMPLETED' as const,
        formatId: parsed.formatId,
        rowCount: parsed.rows.length + parsed.errors.length + parsed.duplicateRowNumbers.length,
        importedCount: created.count,
        duplicateCount: parsed.rows.length - created.count + parsed.duplicateRowNumbers.length,
        errorCount: new Set(parsed.errors.map((e) => e.rowNumber)).size,
        errors: parsed.errors.slice(0, 500).map((e) => ({ ...e })),
        completedAt: new Date(),
      };
      await ctx.prisma.amazonReportImport.update({ where: { id: importId }, data: summary });
      return { status: 'SUCCEEDED', output: { importedCount: summary.importedCount, duplicateCount: summary.duplicateCount, errorCount: summary.errorCount } };
    } catch (err) {
      await ctx.prisma.amazonReportImport.update({ where: { id: importId }, data: { status: 'FAILED', errors: [{ message: (err as Error).message }] } });
      throw err;
    }
  });
}
