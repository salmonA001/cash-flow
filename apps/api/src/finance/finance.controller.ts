import { Controller, Get, Query } from '@nestjs/common';
import { computeContributions, Decimal, money } from '@cfe/business-rules';
import type { FinanceSummary, MonthlyPoint } from '@cfe/shared-types';
import { dateRangeQuery, z } from '@cfe/validation';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { LedgerService, Period } from './ledger.service';

/** Default window: the last 12 full months through today. */
export function resolvePeriod(q: z.infer<typeof dateRangeQuery>): Period {
  const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
  const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth() + 1, 1));
  return { from, to };
}

@Controller('finance')
export class FinanceController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('summary')
  @RequirePermission('finance:read')
  async summary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dateRangeQuery)) q: z.infer<typeof dateRangeQuery>): Promise<FinanceSummary> {
    const period = resolvePeriod(q);
    const { baseCurrency, lines } = await this.ledger.build(user.organizationId, period);
    const report = computeContributions(lines);
    const ch = (c: string) => report.channels.find((x) => x.channel === c)!;
    const sumKinds = (kinds: string[]) =>
      lines.filter((l) => kinds.includes(l.kind)).reduce((acc, l) => acc.plus(money(l.amount)), new Decimal(0));
    return {
      baseCurrency,
      from: period.from.toISOString().slice(0, 10),
      to: period.to.toISOString().slice(0, 10),
      shopifySales: ch('SHOPIFY_POD').grossSales,
      digitalSales: ch('DIGITAL').grossSales,
      amazonRoyalties: ch('AMAZON_MERCH').royalties,
      refunds: sumKinds(['REFUND']).toFixed(2),
      totalExpenses: sumKinds(['ADVERTISING', 'OPERATING', 'PLATFORM_FEE']).toFixed(2),
      estimatedNetProfit: report.totalNetContribution,
      outstandingPayouts: (await this.ledger.outstandingPayouts(user.organizationId, baseCurrency)).toFixed(2),
      channels: report.channels,
      unallocatedSharedCosts: report.unallocatedSharedCosts,
    };
  }

  /** Monthly revenue series: sales and royalties are reported side by side, never merged. */
  @Get('revenue')
  @RequirePermission('finance:read')
  async revenue(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dateRangeQuery)) q: z.infer<typeof dateRangeQuery>) {
    const { baseCurrency, lines } = await this.ledger.build(user.organizationId, resolvePeriod(q));
    const months = new Map<string, { pod: Decimal; digital: Decimal; royalties: Decimal; expenses: Decimal }>();
    for (const l of lines) {
      const key = l.date.toISOString().slice(0, 7);
      const m = months.get(key) ?? { pod: new Decimal(0), digital: new Decimal(0), royalties: new Decimal(0), expenses: new Decimal(0) };
      const amt = money(l.amount);
      if (l.kind === 'GROSS_SALES' && l.channel === 'SHOPIFY_POD') m.pod = m.pod.plus(amt);
      else if (l.kind === 'GROSS_SALES' && l.channel === 'DIGITAL') m.digital = m.digital.plus(amt);
      else if (l.kind === 'ROYALTY') m.royalties = m.royalties.plus(amt);
      else if (['ADVERTISING', 'OPERATING', 'PLATFORM_FEE'].includes(l.kind)) m.expenses = m.expenses.plus(amt);
      months.set(key, m);
    }
    const series: MonthlyPoint[] = [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => ({
        month,
        shopifySales: m.pod.toFixed(2),
        digitalSales: m.digital.toFixed(2),
        amazonRoyalties: m.royalties.toFixed(2),
        expenses: m.expenses.toFixed(2),
      }));
    return { baseCurrency, series };
  }

  @Get('profitability')
  @RequirePermission('finance:read')
  async profitability(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dateRangeQuery)) q: z.infer<typeof dateRangeQuery>) {
    const { baseCurrency, lines } = await this.ledger.build(user.organizationId, resolvePeriod(q));
    return { baseCurrency, ...computeContributions(lines) };
  }
}
