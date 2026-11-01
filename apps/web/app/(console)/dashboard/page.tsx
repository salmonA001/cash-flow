'use client';
import { AlertTriangle, Banknote, CircleDollarSign, Download, Factory, Palette, ReceiptText, ShoppingBag, Store, Wallet } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';
import { GroupedBarChart, DonutChart } from '@/components/charts/charts';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/use-api';
import { API_URL } from '@/lib/api';
import { formatDateTime, formatMoney, humanize } from '@/lib/format';
import type { AutomationRun, FinanceSummary, MonthlyPoint, OrderSummary, Paginated } from '@/types/api';

const CHANNEL_LABEL: Record<string, string> = { SHOPIFY_POD: 'Shopify POD', AMAZON_MERCH: 'Amazon Merch', DIGITAL: 'Digital' };

export default function DashboardPage() {
  const summary = useApi<FinanceSummary>('/finance/summary');
  const revenue = useApi<{ baseCurrency: string; series: MonthlyPoint[] }>('/finance/revenue');
  const orders = useApi<Paginated<OrderSummary>>('/orders?pageSize=6');
  const designs = useApi<Paginated<unknown>>('/designs?status=APPROVED&pageSize=1');
  const fulfillment = useApi<{ statusCounts: Record<string, number> }>('/fulfillment?pageSize=1');
  const runs = useApi<Paginated<AutomationRun>>('/automation/runs?pageSize=6');
  const tasks = useApi<{ id: string; summary: string; kind: string; createdAt: string }[]>('/review-tasks');
  const { data: healthData, error: healthError } = useApiHealth();

  const s = summary.data;
  const cur = s?.baseCurrency ?? 'USD';
  const counts = fulfillment.data?.statusCounts ?? {};
  const pending = (counts.AWAITING_APPROVAL ?? 0) + (counts.APPROVED ?? 0);
  const issues = (counts.FAILED ?? 0) + (counts.NEEDS_REVIEW ?? 0);

  const costBreakdown = s
    ? [
        { name: 'Production', value: sumField(s, 'productionCosts') },
        { name: 'Shipping', value: sumField(s, 'shippingCosts') },
        { name: 'Fees', value: sumField(s, 'paymentFees') + sumField(s, 'platformFees') },
        { name: 'Advertising', value: sumField(s, 'advertising') },
        { name: 'Operating', value: sumField(s, 'allocatedOperating') + Number(s.unallocatedSharedCosts) },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <>
      <PageHeader title="Overview" description={s ? `${s.from} – ${s.to} · amounts in ${cur}` : 'Last 12 months'} />

      {summary.error ? (
        <Card className="mb-6"><ErrorState error={summary.error} action={<Button asChild variant="outline" size="sm"><Link href="/finance?tab=rates">Manage exchange rates</Link></Button>} /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Shopify sales" icon={<ShoppingBag />} loading={!s} value={formatMoney(s?.shopifySales, cur)} hint="Gross, POD store" />
          <StatCard label="Digital sales" icon={<Download />} loading={!s} value={formatMoney(s?.digitalSales, cur)} hint="Gross" />
          <StatCard label="Amazon royalties" icon={<Store />} loading={!s} value={formatMoney(s?.amazonRoyalties, cur)} hint="Net of Amazon costs" />
          <StatCard label="Expenses" icon={<ReceiptText />} loading={!s} value={formatMoney(s?.totalExpenses, cur)} hint={`Refunds ${formatMoney(s?.refunds, cur)}`} />
          <StatCard label="Est. net profit" icon={<CircleDollarSign />} loading={!s} value={formatMoney(s?.estimatedNetProfit, cur)} hint="All channels, after costs" />
          <StatCard label="Outstanding payouts" icon={<Wallet />} loading={!s} value={formatMoney(s?.outstandingPayouts, cur)} hint="Expected, not received" />
          <StatCard label="Active designs" icon={<Palette />} loading={!designs.data} value={designs.data?.total ?? 0} hint="Approved" />
          <StatCard label="Pending fulfillment" icon={<Factory />} loading={!fulfillment.data} value={pending} hint={<Link className="hover:underline" href="/fulfillment">Awaiting approval</Link>} />
          <StatCard label="Fulfillment issues" icon={<AlertTriangle />} loading={!fulfillment.data} value={issues} hint="Failed or needs review" />
          <StatCard label="Review queue" icon={<Banknote />} loading={!tasks.data} value={tasks.data?.length ?? 0} hint={<Link className="hover:underline" href="/settings?tab=inbox">Open tasks</Link>} />
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Revenue by month</CardTitle>
              <CardDescription>Store sales and Amazon royalties are shown side by side — they are different revenue stages.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {revenue.error ? <ErrorState error={revenue.error} /> : !revenue.data ? <LoadingRows rows={4} /> : revenue.data.series.length === 0 ? (
              <EmptyState title="No revenue recorded yet" description="Connect Shopify or import an Amazon Merch report to see revenue here." />
            ) : (
              <GroupedBarChart
                data={revenue.data.series as unknown as Record<string, string>[]}
                xKey="month"
                currency={revenue.data.baseCurrency}
                series={[{ key: 'shopifySales', label: 'Shopify' }, { key: 'amazonRoyalties', label: 'Amazon royalties' }, { key: 'digitalSales', label: 'Digital' }, { key: 'expenses', label: 'Expenses' }]}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Cost breakdown</CardTitle><CardDescription>Costs and expenses in the period</CardDescription></div></CardHeader>
          <CardContent>
            {!s ? <LoadingRows rows={3} /> : costBreakdown.length === 0 ? <EmptyState title="No costs recorded" /> : <DonutChart data={costBreakdown} currency={cur} />}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader><div><CardTitle>Channel comparison</CardTitle><CardDescription>Net contribution after channel costs and allocated operating costs</CardDescription></div></CardHeader>
          <CardContent>
            {!s ? <LoadingRows rows={3} /> : (
              <div className="grid gap-3 sm:grid-cols-3">
                {s.channels.map((c) => (
                  <div key={c.channel} className="rounded-xl border p-4">
                    <p className="text-xs text-muted-foreground">{CHANNEL_LABEL[c.channel]}</p>
                    <p className="mt-1 text-lg font-semibold tabular">{formatMoney(c.netContribution, cur)}</p>
                    <p className="text-xs text-muted-foreground tabular">on {formatMoney(c.netRevenue, cur)} net revenue</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>System health</CardTitle><CardDescription>Live dependency checks</CardDescription></div></CardHeader>
          <CardContent className="space-y-2">
            {healthError && !healthData ? <ErrorState error={healthError} /> : !healthData ? <LoadingRows rows={3} /> : Object.entries(healthData.checks).map(([name, status]) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="capitalize">{name}</span>
                {status === 'ok' ? <StatusBadge status="CONNECTED" /> : <span className="max-w-40 truncate text-xs text-destructive" title={status}>{status}</span>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
            <Button asChild variant="link" size="sm"><Link href="/orders">View all</Link></Button>
          </CardHeader>
          <CardContent className="pt-2">
            {orders.error ? <ErrorState error={orders.error} /> : !orders.data ? <LoadingRows rows={4} /> : orders.data.items.length === 0 ? (
              <EmptyState title="No orders yet" description="Shopify orders appear here once the store is connected." />
            ) : (
              <ul className="divide-y">
                {orders.data.items.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary">
                      <span className="font-medium">{o.orderNumber}</span>
                      <span className="hidden truncate text-muted-foreground sm:block">{o.customer?.email ?? '—'}</span>
                      <StatusBadge status={o.paymentStatus} />
                      <span className="tabular">{formatMoney(o.total, o.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automation activity</CardTitle>
            <Button asChild variant="link" size="sm"><Link href="/automation">History</Link></Button>
          </CardHeader>
          <CardContent className="pt-2">
            {!runs.data ? <LoadingRows rows={4} /> : runs.data.items.length === 0 ? <EmptyState title="No automation runs yet" /> : (
              <ul className="space-y-2.5">
                {runs.data.items.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{humanize(r.action)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function sumField(s: FinanceSummary, field: keyof FinanceSummary['channels'][number]) {
  return s.channels.reduce((acc, c) => acc + Number(c[field]), 0);
}

/** /health lives outside /api/v1 and answers 503 with the same body when degraded. */
function useApiHealth() {
  return useSWR<{ status: string; checks: Record<string, string> }>(
    `${API_URL}/health`,
    (url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json()),
    { refreshInterval: 30_000 },
  );
}
