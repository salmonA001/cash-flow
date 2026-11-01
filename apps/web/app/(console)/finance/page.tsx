'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { DateRange, defaultRange } from '@/components/date-range';
import { ExpenseDialog, PayoutDialog, RateDialog } from '@/components/finance/forms';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApi } from '@/hooks/use-api';
import { useList } from '@/hooks/use-list';
import { qs } from '@/lib/api';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import type { FinanceSummary } from '@/types/api';

const ROWS: { key: keyof FinanceSummary['channels'][number]; label: string; sign: '+' | '−' | '=' }[] = [
  { key: 'grossSales', label: 'Gross sales', sign: '+' },
  { key: 'royalties', label: 'Royalties', sign: '+' },
  { key: 'refunds', label: 'Refunds', sign: '−' },
  { key: 'productionCosts', label: 'Production costs', sign: '−' },
  { key: 'shippingCosts', label: 'Shipping costs', sign: '−' },
  { key: 'paymentFees', label: 'Payment fees', sign: '−' },
  { key: 'platformFees', label: 'Platform fees', sign: '−' },
  { key: 'advertising', label: 'Advertising', sign: '−' },
  { key: 'allocatedOperating', label: 'Allocated operating costs', sign: '−' },
  { key: 'netContribution', label: 'Net contribution', sign: '=' },
];

type Expense = { id: string; category: string; description: string; vendor: string | null; amount: string; currency: string; incurredOn: string; channel: string | null };

export default function FinancePage() {
  const router = useRouter();
  const tab = useSearchParams().get('tab') ?? 'profitability';
  const [range, setRange] = useState(defaultRange);
  const summary = useApi<FinanceSummary>(`/finance/summary${qs(range)}`);
  const expenses = useList<Expense>('/finance/expenses');
  const payouts = useApi<{ id: string; source: string; externalId: string; amount: string; currency: string; periodStart: string; periodEnd: string; status: string }[]>('/finance/payouts');
  const rates = useApi<{ id: string; base: string; quote: string; rate: string; rateDate: string; source: string }[]>('/finance/exchange-rates');
  const s = summary.data;

  return (
    <>
      <PageHeader title="Finance" description="Revenue, costs and profitability per channel — reproducible from source records." actions={<DateRange {...range} onChange={setRange} />} />
      <Tabs value={tab} onValueChange={(t) => router.replace(`/finance?tab=${t}`)}>
        <TabsList>
          <TabsTrigger value="profitability">Profitability</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="rates">Exchange rates</TabsTrigger>
        </TabsList>

        <TabsContent value="profitability">
          <Card>
            <CardHeader><div><CardTitle>Channel profitability</CardTitle><CardDescription>{s ? `${s.from} – ${s.to} · converted to ${s.baseCurrency} at stored daily rates` : ' '}</CardDescription></div></CardHeader>
            <CardContent className="px-0 pb-2">
              {summary.error ? <ErrorState error={summary.error} action={<Link className="text-sm text-primary hover:underline" href="/finance?tab=rates">Add exchange rates</Link>} /> : !s ? <LoadingRows /> : (
                <Table>
                  <THead><tr><TH /><TH className="text-right">Shopify POD</TH><TH className="text-right">Amazon Merch</TH><TH className="text-right">Digital</TH></tr></THead>
                  <TBody>
                    {ROWS.map((r) => (
                      <TR key={r.key} className={r.sign === '=' ? 'font-semibold' : ''}>
                        <TD><span className="mr-2 inline-block w-3 text-muted-foreground">{r.sign}</span>{r.label}</TD>
                        {(['SHOPIFY_POD', 'AMAZON_MERCH', 'DIGITAL'] as const).map((c) => {
                          const ch = s.channels.find((x) => x.channel === c)!;
                          return <TD key={c} className="text-right tabular">{formatMoney(ch[r.key] as string, s.baseCurrency)}</TD>;
                        })}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
            {s && (
              <div className="flex flex-wrap justify-between gap-2 border-t px-5 py-3 text-sm">
                <span className="text-muted-foreground">Unallocated shared costs: <span className="tabular">{formatMoney(s.unallocatedSharedCosts, s.baseCurrency)}</span></span>
                <span>Estimated net profit <strong className="tabular">{formatMoney(s.estimatedNetProfit, s.baseCurrency)}</strong></span>
              </div>
            )}
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">Payouts are excluded: they move cash for revenue already recognized. Tax collected is a liability and is never counted as revenue.</p>
        </TabsContent>

        <TabsContent value="expenses">
          <Card>
            <CardHeader><CardTitle>Expenses</CardTitle><ExpenseDialog onSaved={() => { expenses.mutate(); summary.mutate(); }} /></CardHeader>
            <DataTable
              rows={expenses.data?.items}
              isLoading={expenses.isLoading}
              error={expenses.error}
              rowKey={(e) => e.id}
              pagination={expenses.pagination}
              empty={{ title: 'No expenses recorded' }}
              columns={[
                { header: 'Date', cell: (e) => formatDate(e.incurredOn) },
                { header: 'Category', cell: (e) => humanize(e.category) },
                { header: 'Description', cell: (e) => e.description },
                { header: 'Vendor', cell: (e) => e.vendor ?? '—' },
                { header: 'Channel', cell: (e) => (e.channel ? humanize(e.channel) : 'Shared') },
                { header: 'Amount', cell: (e) => formatMoney(e.amount, e.currency), className: 'text-right tabular' },
              ]}
            />
          </Card>
        </TabsContent>

        <TabsContent value="payouts">
          <Card>
            <CardHeader><CardTitle>Payouts</CardTitle><PayoutDialog onSaved={() => payouts.mutate()} /></CardHeader>
            <DataTable
              rows={payouts.data}
              isLoading={payouts.isLoading}
              error={payouts.error}
              rowKey={(p) => p.id}
              empty={{ title: 'No payouts recorded' }}
              columns={[
                { header: 'Source', cell: (p) => humanize(p.source) },
                { header: 'Reference', cell: (p) => p.externalId },
                { header: 'Period', cell: (p) => `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` },
                { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
                { header: 'Amount', cell: (p) => formatMoney(p.amount, p.currency), className: 'text-right tabular' },
              ]}
            />
          </Card>
        </TabsContent>

        <TabsContent value="rates">
          <Card>
            <CardHeader><div><CardTitle>Exchange rates</CardTitle><CardDescription>Every conversion uses the latest stored rate on or before the transaction date. Reports refuse to compute when a rate is missing.</CardDescription></div><RateDialog onSaved={() => { rates.mutate(); summary.mutate(); }} /></CardHeader>
            <DataTable
              rows={rates.data}
              isLoading={rates.isLoading}
              error={rates.error}
              rowKey={(r) => r.id}
              empty={{ title: 'No exchange rates', description: 'Only needed when you sell or spend in more than one currency.' }}
              columns={[
                { header: 'Date', cell: (r) => formatDate(r.rateDate) },
                { header: 'Pair', cell: (r) => `${r.base} → ${r.quote}` },
                { header: 'Rate', cell: (r) => r.rate, className: 'text-right tabular' },
                { header: 'Source', cell: (r) => r.source },
              ]}
            />
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
